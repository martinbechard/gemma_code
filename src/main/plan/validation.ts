import type { ParsedPlan, ParsedStep } from "./parser";

export type PlanValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

interface PlaceholderPattern {
  label: string;
  pattern: RegExp;
}

export const EXECUTABLE_PLAN_VALIDATION_GUIDANCE_LINES = [
  "At least four accepted steps are required before execution: grounding, test, implementation, and verification.",
  "Step names are not fixed, but the step name, prompt, or verify text must include the words the validator looks for. The assembled plan must contain a grounding word such as ground, read, inspect, or list; a testing word such as test or spec; an implementation word such as implement, edit, add, or update; and a verification word such as verify, build, pnpm, npm, or run.",
  "The assembled plan must name one exact tests/main test file path that ends in .test.ts.",
  "The assembled plan must name the exact focused test command it will run, such as pnpm test tests/main/currentDatetimeTool.test.ts.",
  "The assembled plan must name the exact build command it will run: pnpm run build or npm run build.",
  "Keep requested get_current_ tool names exactly.",
  "Do not use placeholder names such as exampleTool.test.ts or requested_tool_name.",
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
];

export function validatePlanForExecution(
  plan: ParsedPlan,
): PlanValidationResult {
  if (plan.steps.length === 0) {
    return { valid: false, reason: "Plan has no executable steps." };
  }
  for (const step of plan.steps) {
    const stepValidation = validatePlanStepText(step);
    if (!stepValidation.valid) return stepValidation;
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

  if (!/\btests\/main\/[^\s<>]+\.test\.ts\b/.test(wholePlan)) {
    return {
      valid: false,
      reason:
        "Plan must name the exact tests/main test file path it will create or update.",
    };
  }

  if (!/\b(?:pnpm|npm) test\b/.test(wholePlan)) {
    return {
      valid: false,
      reason: "Plan must name the exact test command it will run.",
    };
  }

  if (!/\b(?:pnpm|npm) run build\b/.test(wholePlan)) {
    return {
      valid: false,
      reason: "Plan must name the exact build command it will run.",
    };
  }

  return { valid: true };
}

export function validatePlanStepText(
  step: ParsedStep,
): PlanValidationResult {
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
  return { valid: true };
}
