export interface PlanStepEvidence {
  actionCount: number;
  toolFailures: string[];
  commandFailures: string[];
}

const MAX_REASON_CHARS = 160;
const NONZERO_EXIT_RE = /\bexit=([1-9]\d*)\b/;
const TOOL_ERROR_RE =
  /\b(Error editing|Error writing|Error deleting|Error fetching|Error:|old_string not found)\b/i;
const ALLOWS_FAILURE_RE = /\b(expected|acceptable|may fail|can fail|fails|failing)\b/i;
const REQUIRES_SUCCESS_RE =
  /\b(exit(?:ed)? 0|pass|passes|all ran|green|succeeds|successful|successfully)\b/i;

export function createPlanStepEvidence(): PlanStepEvidence {
  return {
    actionCount: 0,
    toolFailures: [],
    commandFailures: [],
  };
}

export function recordPlanToolEvidence(
  evidence: PlanStepEvidence,
  toolName: string,
  result: string,
): void {
  evidence.actionCount += 1;

  if (TOOL_ERROR_RE.test(result)) {
    evidence.toolFailures.push(formatFailure(toolName, result));
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
