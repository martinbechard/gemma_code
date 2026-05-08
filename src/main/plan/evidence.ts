export interface PlanStepEvidence {
  actionCount: number;
  readPaths: Set<string>;
  commandRuns: CommandRunEvidence[];
  toolFailures: string[];
  recoverableEditFailures: Map<string, string>;
  commandResults: string[];
  commandFailures: string[];
}

export interface CommandRunEvidence {
  command: string;
  failed: boolean;
  summary: string;
}

export interface RepeatedActionFailureInput {
  actionName: string;
  repeatedActionCount: number;
  criterion: string;
  evidence: PlanStepEvidence;
}

const MAX_REASON_CHARS = 160;
const REPEATED_FAILED_ACTION_THRESHOLD = 2;
const COMMAND_EXIT_RE = /\bexit=(?:0|[1-9]\d*|killed)\b/;
const FAILED_EXIT_RE = /\bexit=(?:[1-9]\d*|killed)\b/;
const FOCUSED_TEST_COMMAND_RE =
  /\b(?:pnpm|npm)\s+test\s+tests\/main\/[A-Za-z0-9_./-]+\.test\.ts\b/g;
const BUILD_COMMAND_RE = /\b(?:pnpm|npm)\s+run\s+build\b/g;
const PATH_RE =
  /\b(?:src|tests)\/[A-Za-z0-9_./-]+\b|\bGemma(?:\.[A-Za-z]+)?\.md\b|\bpackage\.json\b/g;
const TOOL_ERROR_RE =
  /^(Error editing|Error writing|Error deleting|Error fetching|Error:|old_string not found)\b/i;
const RECOVERABLE_EDIT_FAILURE_RE =
  /^Error editing\b[\s\S]*\bold_string\s+(?:not found|appears multiple times)\b/i;
const ALLOWS_FAILURE_RE = /\b(expected|acceptable|may fail|can fail|fails|failing)\b/i;
const REQUIRES_SUCCESS_RE =
  /\b(exit(?:ed)? 0|pass|passes|all ran|green|succeeds|successful|successfully)\b/i;
const READ_CRITERION_RE = /\b(?:has|have)\s+been\s+read\b/i;
const READ_ACTION_REQUIREMENT_RE =
  /\b(?:read|list|listed|retrieve|retrieved|contents?)\b/i;
const COMMAND_CRITERION_RE =
  /\b(?:command|pnpm|npm)\b|\b(?:build|built)\b[\s\S]*\b(?:exit(?:ed)?\s*0|pass|passes|passed|green|succeeds|successful|successfully|executed)\b|\b(?:test|tests|suite)\b[\s\S]*\b(?:exit(?:ed)?\s*0|pass|passes|passed|green|succeeds|successful|successfully|fail|fails|failed|failing)\b/i;

export function createPlanStepEvidence(): PlanStepEvidence {
  return {
    actionCount: 0,
    readPaths: new Set(),
    commandRuns: [],
    toolFailures: [],
    recoverableEditFailures: new Map(),
    commandResults: [],
    commandFailures: [],
  };
}

export function isRecoverableEditFailureResult(result: string): boolean {
  return RECOVERABLE_EDIT_FAILURE_RE.test(result.trimStart());
}

export function recordPlanToolEvidence(
  evidence: PlanStepEvidence,
  toolName: string,
  result: string,
  actionArgs: Record<string, unknown> = {},
): void {
  evidence.actionCount += 1;
  const trimmedResult = result.trimStart();
  const path = actionArgs.path;

  if (
    (toolName === "write_file" || toolName === "edit_file") &&
    typeof path === "string" &&
    path.length > 0 &&
    !TOOL_ERROR_RE.test(trimmedResult)
  ) {
    evidence.recoverableEditFailures.delete(path);
  }

  if (
    toolName === "edit_file" &&
    typeof path === "string" &&
    path.length > 0 &&
    isRecoverableEditFailureResult(result)
  ) {
    evidence.recoverableEditFailures.set(path, formatFailure(toolName, result));
    return;
  }

  if (TOOL_ERROR_RE.test(trimmedResult)) {
    evidence.toolFailures.push(formatFailure(toolName, result));
  }

  if (
    toolName === "read_file" &&
    typeof path === "string" &&
    path.length > 0 &&
    !TOOL_ERROR_RE.test(trimmedResult)
  ) {
    evidence.readPaths.add(path);
  }

  if (isCommandTool(toolName) && COMMAND_EXIT_RE.test(result)) {
    const command = commandFromAction(toolName, actionArgs, result);
    const failed = FAILED_EXIT_RE.test(result);
    const summary = formatFailure(toolName, result);
    evidence.commandRuns.push({
      command,
      failed,
      summary,
    });
    evidence.commandResults.push(summary);
    if (FAILED_EXIT_RE.test(result)) {
      evidence.commandFailures.push(summary);
    }
  }
}

export function forcedVerifyFailureReason(
  criterion: string,
  evidence: PlanStepEvidence,
): string | null {
  if (evidence.toolFailures.length > 0) {
    return `tool failure during step: ${last(evidence.toolFailures)}`;
  }

  if (evidence.recoverableEditFailures.size > 0) {
    return `tool failure during step: ${last([
      ...evidence.recoverableEditFailures.values(),
    ])}`;
  }

  if (evidence.actionCount === 0) {
    return "no tool evidence was gathered during this step attempt";
  }

  if (
    READ_CRITERION_RE.test(criterion) ||
    READ_ACTION_REQUIREMENT_RE.test(criterion)
  ) {
    const missingReadPaths = extractCriterionPaths(criterion).filter(
      (path) => !evidence.readPaths.has(path),
    );
    if (missingReadPaths.length > 0) {
      return `missing read_file evidence for: ${missingReadPaths.join(", ")}`;
    }
  }

  const allowsFailure = ALLOWS_FAILURE_RE.test(criterion);
  const requiresSuccess = REQUIRES_SUCCESS_RE.test(criterion);
  const requiresCommandEvidence = COMMAND_CRITERION_RE.test(criterion);
  const requiredCommands = extractRequiredCommands(criterion);

  if (requiredCommands.length > 0) {
    const missingSuccessfulCommands = requiredCommands.filter(
      (command) => !hasSuccessfulCommand(evidence, command),
    );
    if (missingSuccessfulCommands.length > 0) {
      const failedRequiredCommand = missingSuccessfulCommands.find((command) =>
        hasFailedCommand(evidence, command),
      );
      if (failedRequiredCommand) {
        return `command failure during step: ${failedRequiredCommand}`;
      }
      return `missing successful command evidence for: ${missingSuccessfulCommands.join(", ")}. Use run_bash with each exact command.`;
    }
    return null;
  }

  if (evidence.commandFailures.length === 0) {
    if (requiresCommandEvidence && evidence.commandResults.length === 0) {
      return "missing command evidence for verify criterion";
    }
    return null;
  }

  if (requiresSuccess || !allowsFailure) {
    return `command failure during step: ${last(evidence.commandFailures)}`;
  }

  return null;
}

export function buildIncompleteStepPrompt(reason: string): string {
  return [
    "The current plan step is not complete yet.",
    `Missing evidence: ${reason}.`,
    "Do not invent tool results, paste fake file contents, or wrap results in a result tag.",
    "Continue the current step now with the next required action tag, or write a blocker summary if you cannot proceed.",
  ].join("\n");
}

export function repeatedActionForcedFailureReason({
  actionName,
  repeatedActionCount,
  criterion,
  evidence,
}: RepeatedActionFailureInput): string | null {
  if (repeatedActionCount < REPEATED_FAILED_ACTION_THRESHOLD) return null;
  const reason = forcedVerifyFailureReason(criterion, evidence);
  if (!reason) return null;
  return `repeated ${actionName} action after unresolved failure: ${reason}`;
}

function extractCriterionPaths(criterion: string): string[] {
  const paths = new Set<string>();
  for (const match of criterion.matchAll(PATH_RE)) {
    paths.add(match[0]);
  }
  return [...paths];
}

function last(values: string[]): string {
  return values[values.length - 1] ?? "unknown";
}

function isCommandTool(toolName: string): boolean {
  return toolName === "run_bash" || toolName === "run_project_script";
}

function commandFromAction(
  toolName: string,
  actionArgs: Record<string, unknown>,
  result: string,
): string {
  if (toolName === "run_bash" && typeof actionArgs.command === "string") {
    return normalizeCommand(actionArgs.command);
  }
  const resultCommand = /^command=(.+)$/m.exec(result)?.[1];
  if (resultCommand) return normalizeCommand(resultCommand);
  return toolName;
}

function extractRequiredCommands(criterion: string): string[] {
  const commands = new Set<string>();
  for (const match of criterion.matchAll(FOCUSED_TEST_COMMAND_RE)) {
    commands.add(normalizeCommand(match[0]));
  }
  for (const match of criterion.matchAll(BUILD_COMMAND_RE)) {
    commands.add(normalizeCommand(match[0]));
  }
  return [...commands];
}

function hasSuccessfulCommand(
  evidence: PlanStepEvidence,
  requiredCommand: string,
): boolean {
  return evidence.commandRuns.some(
    (run) => !run.failed && commandsEquivalent(run.command, requiredCommand),
  );
}

function hasFailedCommand(
  evidence: PlanStepEvidence,
  requiredCommand: string,
): boolean {
  return evidence.commandRuns.some(
    (run) => run.failed && commandsEquivalent(run.command, requiredCommand),
  );
}

function commandsEquivalent(
  actualCommand: string,
  requiredCommand: string,
): boolean {
  if (actualCommand === requiredCommand) return true;
  return isBuildCommand(actualCommand) && isBuildCommand(requiredCommand);
}

function isBuildCommand(command: string): boolean {
  return /^(?:pnpm|npm) run build$/.test(command);
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function formatFailure(toolName: string, result: string): string {
  const oneLine = result.replace(/\s+/g, " ").trim();
  const preview =
    oneLine.length > MAX_REASON_CHARS
      ? `${oneLine.slice(0, MAX_REASON_CHARS - 1)}…`
      : oneLine;
  return `${toolName}: ${preview}`;
}
