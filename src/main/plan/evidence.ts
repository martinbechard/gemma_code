export interface PlanStepEvidence {
  actionCount: number;
  readPaths: Set<string>;
  listedPaths: Set<string>;
  readResults: Map<string, string>;
  readActions: ReadFileEvidence[];
  searchActions: SearchEvidence[];
  mutationActions: MutationEvidence[];
  commandRuns: CommandRunEvidence[];
  toolFailures: string[];
  recoverableEditFailures: Map<string, string>;
  commandResults: string[];
  commandFailures: string[];
}

export interface ReadFileEvidence {
  path: string;
  sequence: number;
  truncated: boolean;
  content: string;
}

export interface SearchEvidence {
  query: string;
  path: string;
  sequence: number;
  noMatches: boolean;
  truncated: boolean;
  summary: string;
}

export interface MutationEvidence {
  tool: string;
  path?: string;
  sequence: number;
  summary: string;
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
const TEST_COMMAND_RE =
  /\b(?:pnpm|npm)\s+test(?:\s+--)?(?:\s+[A-Za-z0-9_./-]+\.test\.[tj]sx?)?\b/g;
const PACKAGE_RUN_COMMAND_RE = /\b(?:pnpm|npm)\s+run\s+[A-Za-z0-9:_-]+\b/g;
const PATH_RE =
  /\b(?:src|tests)\/[A-Za-z0-9_./-]+\b|\bGemma(?:\.[A-Za-z]+)?\.md\b|\bpackage\.json\b/g;
const TOOL_ERROR_RE =
  /^(Error editing|Error writing|Error deleting|Error fetching|Error:|old_string not found)\b/i;
const RECOVERABLE_EDIT_FAILURE_RE =
  /^Error editing\b[\s\S]*\bold_string\s+(?:not found|appears multiple times)\b/i;
const LIST_FILE_SIZE_SUFFIX_RE = /\s+\(\d+B\)$/;
const ALLOWS_FAILURE_RE = /\b(expected|acceptable|may fail|can fail|fails|failing)\b/i;
const REQUIRES_SUCCESS_RE =
  /\b(exit(?:ed)? 0|pass|passes|all ran|green|succeeds|successful|successfully)\b/i;
const READ_CRITERION_RE = /\b(?:has|have)\s+been\s+read\b/i;
const READ_ACTION_REQUIREMENT_RE =
  /\b(?:read|reading|inspect|inspected|inspection|list|listed|retrieve|retrieved|contents?)\b/i;
const COMMAND_CRITERION_RE =
  /\b(?:command|pnpm|npm)\b|\b(?:build|built)\b[\s\S]*\b(?:exit(?:ed)?\s*0|pass|passes|passed|green|succeeds|successful|successfully|executed)\b|\b(?:test|tests|suite)\b[\s\S]*\b(?:exit(?:ed)?\s*0|pass|passes|passed|green|succeeds|successful|successfully|fail|fails|failed|failing)\b/i;
const MALFORMED_ACTION_SELF_REPORT_RE =
  /\bprevious\s+action\s+tag\b[\s\S]*\b(?:not\s+properly\s+closed|did\s+not\s+close|not\s+closed|malformed)\b/i;
const GUARDED_ALREADY_PRESENT_RE =
  /\b(?:only\s+if\s+missing|already\s+present|avoid\s+editing|do\s+not\s+edit)\b/i;
const GET_CURRENT_TOOL_RE = /\bget_current_[a-z0-9_]+\b/g;
const BLOCKED_RESPONSE_RE = /^\s*BLOCKED:\s*(.+?)\s*$/is;
const MUTATION_CRITERION_RE =
  /\b(?:add|added|create|created|edit|edited|change|changed|update|updated|replace|replaced|remove|removed|removal|delete|deleted|modify|modified|write|written)\b/i;
const REMOVAL_CRITERION_RE =
  /\b(?:remove|removed|removal|delete|deleted|no longer|not present|absent|gone)\b/i;
const MUTATION_TOOL_NAMES = ["edit_file", "write_file", "delete_file"] as const;
const MUTATING_COMMAND_RE =
  /\b(?:rm|mv|cp)\b|\b(?:sed|perl)\s+(?:-[A-Za-z]*i|[^\n]*\s-i\b)|(?:^|\s)>\s*\S+/i;
const TRUNCATED_OUTPUT_RE = /\[(?:…|\.\.\.)?(?:output )?truncated\]/i;
const NO_SEARCH_MATCHES_RE = /^No matches found for (.+?) in (.+?)\./;

export function createPlanStepEvidence(): PlanStepEvidence {
  return {
    actionCount: 0,
    readPaths: new Set(),
    listedPaths: new Set(),
    readResults: new Map(),
    readActions: [],
    searchActions: [],
    mutationActions: [],
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

export function isMalformedActionSelfReport(reason: string | undefined): boolean {
  return typeof reason === "string" && MALFORMED_ACTION_SELF_REPORT_RE.test(reason);
}

export function parseBlockedReason(response: string): string | null {
  const match = BLOCKED_RESPONSE_RE.exec(response);
  if (!match) return null;
  return match[1].replace(/\s+/g, " ").trim() || "blocked";
}

export function isContradictedBySuccessfulEvidence(
  reason: string | undefined,
  criterion: string,
  evidence: PlanStepEvidence,
): boolean {
  if (typeof reason !== "string" || reason.length === 0) return false;
  if (!/\b(?:did not|failed|failure|not return|not execute|could not)\b/i.test(reason)) {
    return false;
  }
  if (forcedVerifyFailureReason(criterion, evidence)) return false;
  if (
    /\b(?:run_bash|command|test|build|execution error|missing file evidence)\b/i.test(
      reason,
    ) &&
    hasSuccessfulRequiredCommandEvidence(criterion, evidence)
  ) {
    return true;
  }
  if (
    /\b(?:confirm|presence|present|contain|contains|missing|not found|could not)\b/i.test(
      reason,
    ) &&
    hasGuardedAlreadyPresentEvidence(criterion, evidence)
  ) {
    return true;
  }
  return extractRequiredCommands(criterion).some(
    (command) =>
      reason.includes(command) && hasSuccessfulCommand(evidence, command),
  );
}

export function hasSuccessfulRequiredCommandEvidence(
  criterion: string,
  evidence: PlanStepEvidence,
): boolean {
  const requiredCommands = extractRequiredCommands(criterion);
  return (
    requiredCommands.length > 0 &&
    requiredCommands.every((command) => hasSuccessfulCommand(evidence, command))
  );
}

export function hasGuardedAlreadyPresentEvidence(
  criterion: string,
  evidence: PlanStepEvidence,
): boolean {
  if (
    !GUARDED_ALREADY_PRESENT_RE.test(criterion) &&
    !/\b(?:contain|contains|present|presence)\b/i.test(criterion)
  ) {
    return false;
  }
  const toolNames = [
    ...new Set([...criterion.matchAll(GET_CURRENT_TOOL_RE)].map((match) => match[0])),
  ];
  if (toolNames.length === 0) return false;
  const paths = extractCriterionPaths(criterion).filter(
    (path) => path === "src/main/tools.ts" || path === "Gemma.md",
  );
  if (paths.length === 0) return false;
  return paths.every((path) => {
    const content = evidence.readResults.get(path);
    return (
      typeof content === "string" &&
      toolNames.every((toolName) => content.includes(toolName))
    );
  });
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
  const sequence = evidence.actionCount;

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
    evidence.readResults.set(path, result);
    evidence.readActions.push({
      path,
      sequence,
      truncated: TRUNCATED_OUTPUT_RE.test(result),
      content: result,
    });
  }

  if (
    toolName === "list_files" &&
    !TOOL_ERROR_RE.test(trimmedResult)
  ) {
    if (typeof path === "string" && path.length > 0) {
      evidence.listedPaths.add(normalizeListedPath(path));
    }
    for (const listedPath of extractListedPaths(result)) {
      evidence.listedPaths.add(listedPath);
    }
  }

  if (toolName === "search_files" && !TOOL_ERROR_RE.test(trimmedResult)) {
    evidence.searchActions.push({
      query: typeof actionArgs.query === "string" ? actionArgs.query : "",
      path: typeof actionArgs.path === "string" ? actionArgs.path : ".",
      sequence,
      noMatches: NO_SEARCH_MATCHES_RE.test(trimmedResult),
      truncated: TRUNCATED_OUTPUT_RE.test(result),
      summary: formatFailure(toolName, result),
    });
  }

  if (isSuccessfulMutationTool(toolName, trimmedResult)) {
    evidence.mutationActions.push({
      tool: toolName,
      path: typeof path === "string" ? path : undefined,
      sequence,
      summary: formatFailure(toolName, result),
    });
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
    if (!failed && isMutatingCommand(command)) {
      evidence.mutationActions.push({
        tool: toolName,
        sequence,
        summary,
      });
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

  if (hasGuardedAlreadyPresentEvidence(criterion, evidence)) {
    return null;
  }

  if (requiresMutationEvidence(criterion) && evidence.mutationActions.length === 0) {
    return "missing mutation evidence: no successful edit_file, write_file, delete_file, or modifying command ran during this step";
  }

  if (requiresRemovalEvidence(criterion)) {
    const absenceReason = missingRemovalAbsenceEvidenceReason(
      criterion,
      evidence,
    );
    if (absenceReason) return absenceReason;
  }

  if (
    READ_CRITERION_RE.test(criterion) ||
    READ_ACTION_REQUIREMENT_RE.test(criterion)
  ) {
    const missingReadPaths = extractCriterionPaths(criterion).filter(
      (path) => !evidence.readPaths.has(path) && !evidence.listedPaths.has(path),
    );
    if (missingReadPaths.length > 0) {
      return `missing file evidence for: ${missingReadPaths.join(", ")}`;
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

export function hasSatisfiedReadOnlyStepEvidence(
  criterion: string,
  evidence: PlanStepEvidence,
): boolean {
  if (evidence.actionCount === 0) return false;
  if (requiresMutationEvidence(criterion)) return false;
  if (!/\b(read|reading|inspect|inspected|inspection|list|listed|retrieve|retrieved)\b/i.test(criterion)) {
    return false;
  }
  if (
    /\b(get_current_|tool|cover|covers|contain|contains|add|added|verify|verified|implement|implemented|implementation|confirm|confirmed|present|pnpm|npm|build)\b/i.test(
      criterion,
    )
  ) {
    return false;
  }
  return forcedVerifyFailureReason(criterion, evidence) === null;
}

export interface PlanStepEvidenceSummary {
  actionCount: number;
  readPaths: string[];
  listedPaths: string[];
  searches: Array<{
    query: string;
    path: string;
    sequence: number;
    noMatches: boolean;
    truncated: boolean;
  }>;
  mutations: Array<{
    tool: string;
    path?: string;
    sequence: number;
  }>;
  commandRuns: Array<{
    command: string;
    failed: boolean;
  }>;
  toolFailures: string[];
  recoverableEditFailures: string[];
  commandFailures: string[];
}

export function summarizePlanStepEvidence(
  evidence: PlanStepEvidence,
): PlanStepEvidenceSummary {
  return {
    actionCount: evidence.actionCount,
    readPaths: [...evidence.readPaths],
    listedPaths: [...evidence.listedPaths],
    searches: evidence.searchActions.map((search) => ({
      query: search.query,
      path: search.path,
      sequence: search.sequence,
      noMatches: search.noMatches,
      truncated: search.truncated,
    })),
    mutations: evidence.mutationActions.map((mutation) => ({
      tool: mutation.tool,
      path: mutation.path,
      sequence: mutation.sequence,
    })),
    commandRuns: evidence.commandRuns.map((command) => ({
      command: command.command,
      failed: command.failed,
    })),
    toolFailures: [...evidence.toolFailures],
    recoverableEditFailures: [...evidence.recoverableEditFailures.values()],
    commandFailures: [...evidence.commandFailures],
  };
}

function requiresMutationEvidence(criterion: string): boolean {
  return MUTATION_CRITERION_RE.test(criterion);
}

function requiresRemovalEvidence(criterion: string): boolean {
  return REMOVAL_CRITERION_RE.test(criterion);
}

function missingRemovalAbsenceEvidenceReason(
  criterion: string,
  evidence: PlanStepEvidence,
): string | null {
  const lastMutationSequence = Math.max(
    ...evidence.mutationActions.map((mutation) => mutation.sequence),
  );
  const targetTerms = removalTargetTerms(criterion);
  const relevantReadPaths = removalReadPaths(criterion, evidence);
  if (targetTerms.length === 0) {
    const hasGenericPostMutationEvidence =
      evidence.searchActions.some(
        (search) =>
          search.sequence > lastMutationSequence &&
          search.noMatches &&
          !search.truncated,
      ) ||
      evidence.readActions.some(
        (read) =>
          read.sequence > lastMutationSequence &&
          !read.truncated &&
          isRelevantRemovalRead(read.path, relevantReadPaths),
      );
    return hasGenericPostMutationEvidence
      ? null
      : "missing post-mutation absence evidence: run search_files for the removed symbol or read the affected file after the mutation";
  }

  const missingTerms = targetTerms.filter(
    (term) =>
      !hasPostMutationNoMatchSearch(evidence, term, lastMutationSequence) &&
      !hasPostMutationReadAbsence(
        evidence,
        term,
        lastMutationSequence,
        relevantReadPaths,
      ),
  );
  if (missingTerms.length === 0) return null;
  return `missing post-mutation absence evidence for: ${missingTerms.join(", ")}. Run search_files after the mutation or read the affected file after the mutation`;
}

function removalTargetTerms(criterion: string): string[] {
  const terms = new Set<string>();
  for (const match of criterion.matchAll(GET_CURRENT_TOOL_RE)) {
    terms.add(match[0]);
  }
  if (/\bcurrent\s+working\s+directory\b/i.test(criterion)) {
    terms.add("get_current_working_directory");
    terms.add("getCurrentWorkingDirectory");
  }
  return [...terms];
}

function hasPostMutationNoMatchSearch(
  evidence: PlanStepEvidence,
  term: string,
  lastMutationSequence: number,
): boolean {
  return evidence.searchActions.some(
    (search) =>
      search.sequence > lastMutationSequence &&
      search.noMatches &&
      !search.truncated &&
      search.query === term,
  );
}

function hasPostMutationReadAbsence(
  evidence: PlanStepEvidence,
  term: string,
  lastMutationSequence: number,
  relevantReadPaths: Set<string>,
): boolean {
  return evidence.readActions.some(
    (read) =>
      read.sequence > lastMutationSequence &&
      !read.truncated &&
      isRelevantRemovalRead(read.path, relevantReadPaths) &&
      !read.content.includes(term),
  );
}

function removalReadPaths(
  criterion: string,
  evidence: PlanStepEvidence,
): Set<string> {
  const paths = new Set(extractCriterionPaths(criterion));
  for (const mutation of evidence.mutationActions) {
    if (mutation.path) paths.add(mutation.path);
  }
  return paths;
}

function isRelevantRemovalRead(
  path: string,
  relevantReadPaths: Set<string>,
): boolean {
  return relevantReadPaths.size === 0 || relevantReadPaths.has(path);
}

function isSuccessfulMutationTool(
  toolName: string,
  trimmedResult: string,
): boolean {
  return (
    MUTATION_TOOL_NAMES.includes(
      toolName as (typeof MUTATION_TOOL_NAMES)[number],
    ) && !TOOL_ERROR_RE.test(trimmedResult)
  );
}

function isMutatingCommand(command: string): boolean {
  return MUTATING_COMMAND_RE.test(command);
}

export function buildIncompleteStepPrompt(reason: string): string {
  return [
    "The current plan step is not complete yet.",
    `Missing evidence: ${reason}.`,
    "Do not invent tool results, paste fake file contents, or wrap results in a result tag.",
    "Continue the current step now with the next required action tag.",
    "If you cannot proceed, reply exactly BLOCKED: followed by one short reason, with no action tag, verify tag, or extra prose.",
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

function extractListedPaths(result: string): string[] {
  const paths = new Set<string>();
  for (const line of result.split(/\r?\n/)) {
    const path = normalizeListedPath(line);
    if (!path || path.startsWith("(") || path.startsWith("[")) continue;
    paths.add(path);
  }
  return [...paths];
}

function normalizeListedPath(path: string): string {
  return path.trim().replace(LIST_FILE_SIZE_SUFFIX_RE, "").replace(/\/$/, "");
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
  for (const match of criterion.matchAll(TEST_COMMAND_RE)) {
    commands.add(normalizeCommand(match[0]));
  }
  for (const match of criterion.matchAll(PACKAGE_RUN_COMMAND_RE)) {
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
  const actualParts = actualCommand
    .split(/\s*&&\s*/)
    .map((part) => normalizeCommand(part))
    .filter((part) => part.length > 0);
  if (actualParts.length > 1) {
    return actualParts.some((part) => commandsEquivalent(part, requiredCommand));
  }
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
