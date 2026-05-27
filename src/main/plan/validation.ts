import type { ParsedPlan, ParsedStep } from "./parser";

export type PlanValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

interface PlaceholderPattern {
  label: string;
  pattern: RegExp;
}

export const EXECUTABLE_PLAN_VALIDATION_GUIDANCE_LINES = [
  "The plan must contain at least one executable step.",
  "Every step must have non-empty string name, prompt, and verify fields.",
  "Every step name must be unique.",
  "The deterministic validator only checks plan document shape and obvious placeholders; task-specific completeness is reviewed semantically by the model.",
  "Do not use placeholder wording such as relevant tests, relevant files, needed files, files needed, implementation files, documentation files needed, runtime files needed, and prompt files needed.",
] as const;

const PLACEHOLDER_PATTERNS: PlaceholderPattern[] = [
  { label: "relevant tests", pattern: /\brelevant tests?\b/i },
  { label: "relevant files", pattern: /\brelevant files?\b/i },
  { label: "needed files", pattern: /\bneeded files?\b/i },
  { label: "files needed", pattern: /\bfiles needed\b/i },
  { label: "implementation files", pattern: /\bimplementation files?\b/i },
  {
    label: "documentation files needed",
    pattern: /\bdocumentation files? needed\b/i,
  },
  {
    label: "runtime files needed",
    pattern: /\bruntime files? needed\b/i,
  },
  {
    label: "prompt files needed",
    pattern: /\bprompt files? needed\b/i,
  },
  {
    label: "exampleTool.test.ts",
    pattern: /\bexampleTool\.test\.ts\b/,
  },
  {
    label: "requested_tool_name",
    pattern: /\brequested_tool_name\b/,
  },
  {
    label: "newToolName.test.ts",
    pattern: /\bnewToolName\.test\.ts\b/,
  },
  {
    label: "TODO",
    pattern: /\bTODO\b/i,
  },
  {
    label: "TBD",
    pattern: /\bTBD\b/i,
  },
];

export function validatePlanForExecution(
  plan: ParsedPlan,
): PlanValidationResult {
  if (plan.steps.length === 0) {
    return { valid: false, reason: "Plan has no executable steps." };
  }

  const names = new Set<string>();
  for (const step of plan.steps) {
    const stepValidation = validatePlanStepText(step);
    if (!stepValidation.valid) return stepValidation;
    const name = step.name.trim();
    if (names.has(name)) {
      return {
        valid: false,
        reason: `Duplicate step name "${name}".`,
      };
    }
    names.add(name);
  }

  return { valid: true };
}

export function validatePlanStepText(
  step: ParsedStep,
): PlanValidationResult {
  const fieldValidation = validateStepFields(step);
  if (!fieldValidation.valid) return fieldValidation;

  const text = `${step.prompt}\n${step.verify}`;
  const placeholder = PLACEHOLDER_PATTERNS.find(({ pattern }) =>
    pattern.test(text),
  );
  if (placeholder) {
    return {
      valid: false,
      reason:
        `Step "${step.name}" still uses placeholder wording "${placeholder.label}". ` +
        "Name exact files, artifacts, commands, or verification evidence before the plan can run.",
    };
  }
  return { valid: true };
}

function validateStepFields(step: ParsedStep): PlanValidationResult {
  if (step.name.trim().length === 0) {
    return { valid: false, reason: "Plan step name must be a non-empty string." };
  }
  if (step.prompt.trim().length === 0) {
    return {
      valid: false,
      reason: `Step "${step.name}" prompt must be a non-empty string.`,
    };
  }
  if (step.verify.trim().length === 0) {
    return {
      valid: false,
      reason: `Step "${step.name}" verify must be a non-empty string.`,
    };
  }
  return { valid: true };
}
