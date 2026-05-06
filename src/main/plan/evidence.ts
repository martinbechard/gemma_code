export interface PlanStepEvidence {
  actionCount: number;
  readPaths: Set<string>;
  toolFailures: string[];
  commandFailures: string[];
}

const MAX_REASON_CHARS = 160;
const NONZERO_EXIT_RE = /\bexit=([1-9]\d*)\b/;
const PATH_RE =
  /\b(?:src|tests)\/[A-Za-z0-9_./-]+\b|\bGemma(?:\.[A-Za-z]+)?\.md\b|\bpackage\.json\b/g;
const TOOL_ERROR_RE =
  /^(Error editing|Error writing|Error deleting|Error fetching|Error:|old_string not found)\b/i;
const ALLOWS_FAILURE_RE = /\b(expected|acceptable|may fail|can fail|fails|failing)\b/i;
const REQUIRES_SUCCESS_RE =
  /\b(exit(?:ed)? 0|pass|passes|all ran|green|succeeds|successful|successfully)\b/i;
const READ_CRITERION_RE = /\b(?:has|have)\s+been\s+read\b/i;

export function createPlanStepEvidence(): PlanStepEvidence {
  return {
    actionCount: 0,
    readPaths: new Set(),
    toolFailures: [],
    commandFailures: [],
  };
}

export function recordPlanToolEvidence(
  evidence: PlanStepEvidence,
  toolName: string,
  result: string,
  actionArgs: Record<string, unknown> = {},
): void {
  evidence.actionCount += 1;

  if (TOOL_ERROR_RE.test(result.trimStart())) {
    evidence.toolFailures.push(formatFailure(toolName, result));
  }

  const path = actionArgs.path;
  if (
    toolName === "read_file" &&
    typeof path === "string" &&
    path.length > 0 &&
    !TOOL_ERROR_RE.test(result.trimStart())
  ) {
    evidence.readPaths.add(path);
  }

  const exitMatch = NONZERO_EXIT_RE.exec(result);
  if (toolName === "run_bash" && exitMatch) {
    evidence.commandFailures.push(formatFailure(toolName, result));
  }
}

export function forcedVerifyFailureReason(
  criterion: string,
  evidence: PlanStepEvidence,
): string | null {
  if (evidence.toolFailures.length > 0) {
    return `tool failure during step: ${last(evidence.toolFailures)}`;
  }

  if (evidence.actionCount === 0) {
    return "no tool evidence was gathered during this step attempt";
  }

  if (READ_CRITERION_RE.test(criterion)) {
    const missingReadPaths = extractCriterionPaths(criterion).filter(
      (path) => !evidence.readPaths.has(path),
    );
    if (missingReadPaths.length > 0) {
      return `missing read_file evidence for: ${missingReadPaths.join(", ")}`;
    }
  }

  if (evidence.commandFailures.length === 0) {
    return null;
  }

  const allowsFailure = ALLOWS_FAILURE_RE.test(criterion);
  const requiresSuccess = REQUIRES_SUCCESS_RE.test(criterion);
  if (requiresSuccess || !allowsFailure) {
    return `command failure during step: ${last(evidence.commandFailures)}`;
  }

  return null;
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

function formatFailure(toolName: string, result: string): string {
  const oneLine = result.replace(/\s+/g, " ").trim();
  const preview =
    oneLine.length > MAX_REASON_CHARS
      ? `${oneLine.slice(0, MAX_REASON_CHARS - 1)}…`
      : oneLine;
  return `${toolName}: ${preview}`;
}
