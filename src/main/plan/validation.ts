import type { ParsedPlan } from "./parser";

export type PlanValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

interface PlaceholderPattern {
  label: string;
  pattern: RegExp;
}

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
];

export function validatePlanForExecution(
  plan: ParsedPlan,
): PlanValidationResult {
  if (plan.steps.length === 0) {
    return { valid: false, reason: "Plan has no executable steps." };
  }
  for (const step of plan.steps) {
    const text = `${step.prompt}\n${step.verify}`;
    const placeholder = PLACEHOLDER_PATTERNS.find(({ pattern }) =>
      pattern.test(text),
    );
    if (placeholder) {
      return {
        valid: false,
        reason:
          `Step "${step.name}" still uses placeholder wording "${placeholder.label}". ` +
          "Name exact files, test paths, and commands before the plan can run.",
      };
    }
  }

  if (plan.steps.length < 4) {
    return {
      valid: false,
      reason:
        "Plan must include grounding, test, implementation, and verification steps.",
    };
  }

  const wholePlan = plan.steps
    .map((step) => `${step.name}\n${step.prompt}\n${step.verify}`)
    .join("\n");
  if (
    !/\b(ground|read|inspect|list)\b/i.test(wholePlan) ||
    !/\b(test|spec)\b/i.test(wholePlan) ||
    !/\b(implement|edit|add|update)\b/i.test(wholePlan) ||
    !/\b(verify|build|pnpm|npm|run)\b/i.test(wholePlan)
  ) {
    return {
      valid: false,
      reason:
        "Plan must include grounding, test, implementation, and verification steps.",
    };
  }

  return { valid: true };
}
