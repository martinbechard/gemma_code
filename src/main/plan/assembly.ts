import { stringify } from "yaml";
import { findNextPlan, type ParsedPlan, type ParsedStep } from "./parser";
import { validatePlanForExecution, validatePlanStepText } from "./validation";

const MAX_PLAN_ASSEMBLY_STEPS = 16;

export const PLAN_ASSEMBLY_DONE_TEXT = "plan: done";
const PLAN_ASSEMBLY_INITIAL_PROMPT_PREFIX =
  "As an expert in software development and AI-assisted coding, I need your help in instructing an AI coding agent. Our task: ";
const PLAN_ASSEMBLY_INITIAL_PROMPT_SUFFIX =
  " What should I start by telling the agent? in YAML only no extra explanations, just the prompt?";
export const PLAN_ASSEMBLY_NEXT_PROMPT = [
  "What should I tell the agent next? If the plan is complete, reply exactly with plan: done. YAML only, no extra explanations.",
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

export function createPlanAssemblyState(): PlanAssemblyState {
  return { steps: [] };
}

export function buildPlanAssemblyInitialPrompt(task: string): string {
  const trimmedTask = task.trim();
  if (
    trimmedTask.startsWith(PLAN_ASSEMBLY_INITIAL_PROMPT_PREFIX) &&
    trimmedTask.endsWith(PLAN_ASSEMBLY_INITIAL_PROMPT_SUFFIX.trimStart())
  ) {
    return trimmedTask;
  }
  const taskSentence = /[.!?]$/.test(trimmedTask)
    ? trimmedTask
    : trimmedTask + ".";
  return (
    PLAN_ASSEMBLY_INITIAL_PROMPT_PREFIX +
    taskSentence +
    PLAN_ASSEMBLY_INITIAL_PROMPT_SUFFIX
  );
}

export function applyPlanAssemblyResponse(
  state: PlanAssemblyState,
  response: string,
): PlanAssemblyResult {
  const trimmed = response.trim();
  if (trimmed === PLAN_ASSEMBLY_DONE_TEXT) {
    const plan = finalizePlanAssembly(state);
    if (!plan) {
      return rejected(
        state,
        "The assembled plan needs at least one step before it can finish.",
      );
    }
    return { kind: "finished", state, plan };
  }

  const parsed = findNextPlan(response);
  if (parsed === "incomplete") {
    return rejected(state, "The response contains incomplete YAML.");
  }
  if (!parsed) {
    return rejected(
      state,
      state.steps.length > 0
        ? "The response must contain exactly one YAML plan step or plan: done."
        : "The response must contain exactly one YAML plan step.",
    );
  }
  if (parsed.steps.length !== 1) {
    return rejected(
      state,
      "The response must contain exactly one step; received " +
        parsed.steps.length +
        ".",
    );
  }
  if (state.steps.length >= MAX_PLAN_ASSEMBLY_STEPS) {
    return rejected(
      state,
      "The assembled plan reached the limit of " +
        MAX_PLAN_ASSEMBLY_STEPS +
        " steps.",
    );
  }

  const [step] = parsed.steps;
  const stepValidation = validatePlanStepText(step);
  if (!stepValidation.valid) {
    return rejected(state, stepValidation.reason);
  }
  if (state.steps.some((existing) => existing.name === step.name)) {
    return rejected(state, 'Duplicate step name "' + step.name + '".', {
      duplicateStepName: step.name,
    });
  }

  return {
    kind: "accepted",
    state: { steps: [...state.steps, step] },
    nextPrompt: PLAN_ASSEMBLY_NEXT_PROMPT,
  };
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

function rejected(
  state: PlanAssemblyState,
  reason: string,
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
    ].join("\n"),
  };
}
