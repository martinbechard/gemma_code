import { stringify } from "yaml";
import { findNextPlan, type ParsedPlan, type ParsedStep } from "./parser";
import { validatePlanStepText } from "./validation";

const MAX_PLAN_ASSEMBLY_STEPS = 16;

export const PLAN_ASSEMBLY_DONE_TEXT = "no plan + no action";
export const PLAN_ASSEMBLY_NEXT_PROMPT = [
  "What should I tell the agent next? in YAML only no extra explanations, just the prompt?",
  "",
  "If there is no next prompt, reply exactly: " + PLAN_ASSEMBLY_DONE_TEXT,
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
      "The response must contain exactly one YAML plan step or exactly " +
        PLAN_ASSEMBLY_DONE_TEXT +
        ".",
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
    return rejected(state, 'Duplicate step name "' + step.name + '".');
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

function rejected(
  state: PlanAssemblyState,
  reason: string,
): PlanAssemblyResult {
  return {
    kind: "rejected",
    state,
    reason,
    retryPrompt: [
      "The previous planning response was rejected: " + reason,
      "",
      "Return exactly one YAML plan containing one step, with name, prompt, and verify string fields.",
      "If the plan is complete, reply exactly: " + PLAN_ASSEMBLY_DONE_TEXT,
    ].join("\n"),
  };
}
