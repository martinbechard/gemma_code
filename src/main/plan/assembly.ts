import { parse, stringify } from "yaml";
import { findNextPlan, type ParsedPlan, type ParsedStep } from "./parser";
import { validatePlanForExecution, validatePlanStepText } from "./validation";

const MAX_PLAN_ASSEMBLY_STEPS = 16;
const WHOLE_RESPONSE_YAML_FENCE_RE =
  /^```(?:yaml|yml)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i;

export const PLAN_ASSEMBLY_DONE_TEXT = "plan: done";
export const PLAN_SEMANTIC_REVIEW_PASS_TEXT = "review: pass";
const PLAN_ASSEMBLY_USER_REQUEST_OPEN = "<UserRequest>";
const PLAN_ASSEMBLY_USER_REQUEST_CLOSE = "</UserRequest>";
const LEGACY_PLAN_ASSEMBLY_INITIAL_PROMPT_PREFIX =
  "As an expert in software development and AI-assisted coding, I need your help in instructing an AI coding agent. Our task: ";
const LEGACY_PLAN_ASSEMBLY_INITIAL_PROMPT_SUFFIX =
  " What should I start by telling the agent? in YAML only no extra explanations, just the prompt?";
const PLAN_ASSEMBLY_INITIAL_PROMPT_PREFIX =
  "Our task is to create clear, executable instructions for an AI coding agent.";
const PLAN_ASSEMBLY_INITIAL_PROMPT_SUFFIX =
  "What should I tell the AI coding agent first? YAML only, no extra explanations, just the prompt.";

export const PLAN_ASSEMBLY_NEXT_PROMPT = [
  "What should I tell the agent next? Continue the same plan with exactly one additional YAML step.",
  "Return plan: done only when the accepted steps form a complete executable plan for the user request.",
  "Do not return plan: done if grounding, implementation, testing, documentation, or verification work is still needed for this specific request.",
  "YAML only, no extra explanations.",
].join("\n");

export interface PlanAssemblyState {
  steps: ParsedStep[];
}

export type PlanAssemblyResult =
  | {
      kind: "accepted";
      state: PlanAssemblyState;
      nextPrompt: string;
    }
  | {
      kind: "finished";
      state: PlanAssemblyState;
      plan: ParsedPlan;
    }
  | {
      kind: "rejected";
      state: PlanAssemblyState;
      reason: string;
      retryPrompt: string;
    };

export type PlanSemanticReviewResult =
  | {
      kind: "accepted";
      plan: ParsedPlan;
    }
  | {
      kind: "corrected";
      plan: ParsedPlan;
    }
  | {
      kind: "rejected";
      reason: string;
      retryPrompt: string;
    };

export function createPlanAssemblyState(): PlanAssemblyState {
  return { steps: [] };
}

export function buildPlanAssemblyInitialPrompt(task: string): string {
  const trimmedTask = task.trim();
  const existingUserRequest = extractPlanAssemblyUserRequest(trimmedTask);
  if (existingUserRequest && isStructuredPlanAssemblyPrompt(trimmedTask)) {
    return trimmedTask;
  }
  const userRequest =
    existingUserRequest ?? extractLegacyPlanAssemblyTask(trimmedTask) ?? trimmedTask;
  const trimmedUserRequest = userRequest.trim();
  const taskSentence = /[.!?]$/.test(trimmedUserRequest)
    ? trimmedUserRequest
    : trimmedUserRequest + ".";
  return [
    PLAN_ASSEMBLY_INITIAL_PROMPT_PREFIX,
    "",
    "Here is the user request to be realized by the AI agent: " +
      PLAN_ASSEMBLY_USER_REQUEST_OPEN +
      taskSentence +
      PLAN_ASSEMBLY_USER_REQUEST_CLOSE,
    "",
    "Build the plan one step at a time. I will accumulate the steps that you produce and save the final plan file after review.",
    "Choose exact files, tests, commands, and documentation steps from the request and project evidence; I will not provide request-specific paths or commands.",
    "",
    PLAN_ASSEMBLY_INITIAL_PROMPT_SUFFIX,
  ].join("\n");
}

export function applyPlanAssemblyResponse(
  state: PlanAssemblyState,
  response: string,
  task = "",
): PlanAssemblyResult {
  if (isPlanAssemblyDoneResponse(response)) {
    const plan = finalizePlanAssembly(state);
    if (!plan) {
      return rejected(
        state,
        "The assembled plan needs at least one step before it can finish.",
        task,
      );
    }
    return { kind: "finished", state, plan };
  }

  const parsed = findNextPlan(response);
  if (parsed === "incomplete") {
    return rejected(state, "The response contains incomplete YAML.", task);
  }
  if (!parsed) {
    return rejected(
      state,
      state.steps.length > 0
        ? "The response must contain exactly one YAML plan step or plan: done."
        : "The response must contain exactly one YAML plan step.",
      task,
    );
  }
  const planShapeReason = validateRawPlanDocumentShape(parsed.raw);
  if (planShapeReason) {
    return rejected(state, planShapeReason, task);
  }
  const rawStepCount = countRawPlanSteps(parsed.raw);
  if (rawStepCount !== 1) {
    return rejected(
      state,
      "The response must contain exactly one step; received " +
        (rawStepCount ?? parsed.steps.length) +
        ".",
      task,
    );
  }
  if (parsed.steps.length !== 1) {
    return rejected(
      state,
      "The response must contain exactly one step; received " +
        parsed.steps.length +
        ".",
      task,
    );
  }
  if (state.steps.length >= MAX_PLAN_ASSEMBLY_STEPS) {
    return rejected(
      state,
      "The assembled plan reached the limit of " +
        MAX_PLAN_ASSEMBLY_STEPS +
        " steps.",
      task,
    );
  }

  const [step] = parsed.steps;
  const stepValidation = validatePlanStepText(step);
  if (!stepValidation.valid) {
    return rejected(state, stepValidation.reason, task);
  }
  if (state.steps.some((existing) => existing.name === step.name)) {
    return rejected(state, 'Duplicate step name "' + step.name + '".', task, {
      duplicateStepName: step.name,
    });
  }

  const nextState = { steps: [...state.steps, step] };
  return {
    kind: "accepted",
    state: nextState,
    nextPrompt: buildPlanAssemblyNextPrompt(nextState),
  };
}

export function buildPlanSemanticReviewPrompt(
  plan: ParsedPlan,
  task: string,
): string {
  return [
    "Review the assembled plan for semantic fit to the user request.",
    "",
    "User request:",
    task.trim(),
    "",
    "Assembled plan:",
    plan.raw,
    "",
    "Deterministic syntax validation has already passed. Do not critique YAML formatting unless the corrected plan you return would fail the documented shape.",
    "Check whether the plan has enough concrete grounding, implementation, test, documentation, and verification work for this specific request. Some requests may not need every category.",
    "Check that files, folders, commands, and artifacts are task-specific choices made by the plan, not placeholders.",
    "",
    "If the plan is semantically complete, return exactly:",
    PLAN_SEMANTIC_REVIEW_PASS_TEXT,
    "",
    "If the plan needs correction, return one complete corrected YAML plan with all steps, not just an added step.",
    "Return no prose.",
  ].join("\n");
}

export function applyPlanSemanticReviewResponse(
  currentPlan: ParsedPlan,
  response: string,
): PlanSemanticReviewResult {
  if (isPlanSemanticReviewPassResponse(response)) {
    return { kind: "accepted", plan: currentPlan };
  }

  const correctedPlan = findNextPlan(response);
  if (correctedPlan === "incomplete") {
    return semanticReviewRejected("The corrected plan contains incomplete YAML.");
  }
  if (!correctedPlan || correctedPlan.steps.length === 0) {
    return semanticReviewRejected(
      "Semantic review must return review: pass or one complete corrected YAML plan.",
    );
  }
  const planShapeReason = validateRawPlanDocumentShape(correctedPlan.raw);
  if (planShapeReason) {
    return semanticReviewRejected(planShapeReason);
  }

  const validation = validatePlanForExecution(correctedPlan);
  if (!validation.valid) {
    return semanticReviewRejected(validation.reason);
  }

  return { kind: "corrected", plan: correctedPlan };
}

export function isPlanAssemblyDoneResponse(response: string): boolean {
  const text = normalizeWholeResponseYaml(response);
  if (text === PLAN_ASSEMBLY_DONE_TEXT) return true;

  let doc: unknown;
  try {
    doc = parse(text);
  } catch {
    return false;
  }
  if (!isRecord(doc)) return false;
  const keys = Object.keys(doc);
  return keys.length === 1 && doc.plan === "done";
}

export function isPlanSemanticReviewPassResponse(response: string): boolean {
  const text = normalizeWholeResponseYaml(response);
  if (text === PLAN_SEMANTIC_REVIEW_PASS_TEXT) return true;

  let doc: unknown;
  try {
    doc = parse(text);
  } catch {
    return false;
  }
  if (!isRecord(doc)) return false;
  const keys = Object.keys(doc);
  return keys.length === 1 && doc.review === "pass";
}

export function finalizePlanAssembly(
  state: PlanAssemblyState,
): ParsedPlan | null {
  if (state.steps.length === 0) return null;
  const raw = stringify({ plan: { steps: state.steps } }).trimEnd();
  return {
    steps: [...state.steps],
    raw,
    start: 0,
    end: raw.length,
  };
}

export function finalizeExecutablePlanAssembly(
  state: PlanAssemblyState,
): ParsedPlan | null {
  const plan = finalizePlanAssembly(state);
  if (!plan) return null;
  const validation = validatePlanForExecution(plan);
  return validation.valid ? plan : null;
}

function isStructuredPlanAssemblyPrompt(text: string): boolean {
  return (
    text.startsWith(PLAN_ASSEMBLY_INITIAL_PROMPT_PREFIX) &&
    text.endsWith(PLAN_ASSEMBLY_INITIAL_PROMPT_SUFFIX)
  );
}

function extractPlanAssemblyUserRequest(text: string): string | null {
  const start = text.indexOf(PLAN_ASSEMBLY_USER_REQUEST_OPEN);
  if (start < 0) return null;
  const contentStart = start + PLAN_ASSEMBLY_USER_REQUEST_OPEN.length;
  const end = text.indexOf(PLAN_ASSEMBLY_USER_REQUEST_CLOSE, contentStart);
  if (end < 0) return null;
  const userRequest = text.slice(contentStart, end).trim();
  return userRequest.length > 0 ? userRequest : null;
}

function extractLegacyPlanAssemblyTask(text: string): string | null {
  if (
    !text.startsWith(LEGACY_PLAN_ASSEMBLY_INITIAL_PROMPT_PREFIX) ||
    !text.endsWith(LEGACY_PLAN_ASSEMBLY_INITIAL_PROMPT_SUFFIX.trimStart())
  ) {
    return null;
  }
  const userRequest = text.slice(
    LEGACY_PLAN_ASSEMBLY_INITIAL_PROMPT_PREFIX.length,
    text.length - LEGACY_PLAN_ASSEMBLY_INITIAL_PROMPT_SUFFIX.trimStart().length,
  ).trim();
  return userRequest.length > 0 ? userRequest : null;
}

function rejected(
  state: PlanAssemblyState,
  reason: string,
  _task = "",
  options: { duplicateStepName?: string } = {},
): PlanAssemblyResult {
  const acceptedStepNames = state.steps.map((step) => step.name);
  const acceptedNameGuidance =
    acceptedStepNames.length > 0
      ? [
          "",
          `Already accepted step names: ${acceptedStepNames.join(", ")}.`,
          "The new step name must be unique and must not reuse any accepted step name.",
        ]
      : [];
  const duplicateNameGuidance = options.duplicateStepName
    ? [
        `The rejected name "${options.duplicateStepName}" is already used.`,
        `Do not return another step named "${options.duplicateStepName}".`,
        "Use a task-specific name that has not appeared in the accepted plan.",
      ]
    : [];
  return {
    kind: "rejected",
    state,
    reason,
    retryPrompt: [
      "The previous planning response was rejected: " + reason,
      ...acceptedNameGuidance,
      ...duplicateNameGuidance,
      "",
      "Return exactly one YAML plan containing one step, with name, prompt, and verify string fields.",
      ...(acceptedStepNames.length > 0
        ? ["If the assembled plan is complete, return exactly " + PLAN_ASSEMBLY_DONE_TEXT + "."]
        : []),
      "Use exact task-specific files, artifacts, commands, and verification evidence; do not use placeholders.",
    ].join("\n"),
  };
}

function buildPlanAssemblyNextPrompt(state: PlanAssemblyState): string {
  const acceptedSteps =
    state.steps.length > 0
      ? `Accepted steps so far: ${state.steps.map((step) => step.name).join(", ")}.`
      : "";
  return [
    PLAN_ASSEMBLY_NEXT_PROMPT,
    ...(acceptedSteps.length > 0 ? ["", acceptedSteps] : []),
  ].join("\n");
}

function semanticReviewRejected(reason: string): PlanSemanticReviewResult {
  return {
    kind: "rejected",
    reason,
    retryPrompt: [
      "The semantic review response was rejected: " + reason,
      "Return exactly " + PLAN_SEMANTIC_REVIEW_PASS_TEXT + " if the current plan is semantically complete.",
      "Otherwise return one complete corrected YAML plan with all steps.",
      "Return no prose.",
    ].join("\n"),
  };
}

function validateRawPlanDocumentShape(raw: string): string | null {
  let doc: unknown;
  try {
    doc = parse(raw);
  } catch {
    return "The response contains incomplete YAML.";
  }
  if (!isRecord(doc) || !isRecord(doc.plan)) {
    return "The YAML must contain a plan object.";
  }
  if (!Array.isArray(doc.plan.steps)) {
    return "The YAML must contain a plan.steps array.";
  }
  for (const [index, step] of doc.plan.steps.entries()) {
    if (!isRecord(step)) {
      return `Plan step ${index + 1} must be an object.`;
    }
    if (
      typeof step.name !== "string" ||
      step.name.trim().length === 0 ||
      typeof step.prompt !== "string" ||
      step.prompt.trim().length === 0 ||
      typeof step.verify !== "string" ||
      step.verify.trim().length === 0
    ) {
      return `Plan step ${index + 1} must have name, prompt, and verify string fields.`;
    }
  }
  return null;
}

function countRawPlanSteps(raw: string): number | null {
  let doc: unknown;
  try {
    doc = parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(doc) || !isRecord(doc.plan)) return null;
  return Array.isArray(doc.plan.steps) ? doc.plan.steps.length : null;
}

function normalizeWholeResponseYaml(response: string): string {
  const raw = response.trim();
  const fenced = WHOLE_RESPONSE_YAML_FENCE_RE.exec(raw);
  return (fenced?.[1] ?? raw).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
