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
  "The focused test command must use the same exact tests/main test file path that the test step creates or updates.",
  "A step that creates or updates a test must name the exact focused test command for that same test file in the step prompt and verify text.",
  "Every step that runs a focused test command or build command must repeat the exact command in the step verify text.",
  "The assembled plan must name the exact build command it will run: pnpm run build or npm run build.",
  "Keep requested get_current_ tool names exactly.",
  "Do not use placeholder names such as exampleTool.test.ts, newToolName.test.ts, or requested_tool_name.",
  "Do not use placeholder wording such as relevant tests, relevant files, needed files, files needed, implementation files, documentation files needed, runtime files needed, and prompt files needed.",
] as const;

const TEST_FILE_PATH_RE = /\btests\/main\/[^\s<>"']+\.test\.ts\b/g;
const FOCUSED_TEST_COMMAND_RE =
  /\b(?:pnpm|npm) test\s+(?:--\s+)?(tests\/main\/[^\s<>"']+\.test\.ts)\b/g;
const FOCUSED_TEST_COMMAND_TEXT_RE =
  /\b((?:pnpm|npm) test\s+(?:--\s+)?tests\/main\/[^\s<>"']+\.test\.ts)\b/g;
const BUILD_COMMAND_TEXT_RE = /\b((?:pnpm|npm) run build)\b/g;
const TEST_ARTIFACT_STEP_RE = /\b(?:test|spec)\b/i;
const TEST_ARTIFACT_CHANGE_RE = /\b(?:write|create|update|add|extend|edit)\b/i;
const TEST_PATH_MISMATCH_REASON =
  "Plan focused test command must use the same exact tests/main test file path that the test step creates or updates.";
const TEST_ARTIFACT_COMMAND_REASON =
  "Plan test step must name the exact focused test command for the same tests/main test file it creates or updates.";
const FOCUSED_TEST_VERIFY_REASON =
  "Every step that runs a focused test command must repeat the exact command in its verify field.";
const BUILD_VERIFY_REASON =
  "Every step that runs the build command must repeat the exact command in its verify field.";

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

  const planTestPaths = extractTestFilePaths(wholePlan);
  if (planTestPaths.length === 0) {
    return {
      valid: false,
      reason:
        "Plan must name the exact tests/main test file path it will create or update.",
    };
  }

  const focusedTestCommandPaths = extractFocusedTestCommandPaths(wholePlan);
  if (focusedTestCommandPaths.length === 0) {
    return {
      valid: false,
      reason: "Plan must name the exact test command it will run.",
    };
  }

  const testArtifactPaths = extractTestArtifactPaths(plan.steps);
  if (
    testArtifactPaths.length === 0 ||
    !sameStringSet(testArtifactPaths, focusedTestCommandPaths)
  ) {
    return {
      valid: false,
      reason: TEST_PATH_MISMATCH_REASON,
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
  const commandValidation = validateStepCommandText(step);
  if (!commandValidation.valid) return commandValidation;
  return { valid: true };
}

function validateStepCommandText(step: ParsedStep): PlanValidationResult {
  const stepText = `${step.name}\n${step.prompt}\n${step.verify}`;
  if (
    TEST_ARTIFACT_STEP_RE.test(stepText) &&
    TEST_ARTIFACT_CHANGE_RE.test(stepText)
  ) {
    const testPaths = extractTestFilePaths(stepText);
    if (testPaths.length > 0) {
      if (
        !sameStringSet(testPaths, extractFocusedTestCommandPaths(step.prompt)) ||
        !sameStringSet(testPaths, extractFocusedTestCommandPaths(step.verify))
      ) {
        return { valid: false, reason: TEST_ARTIFACT_COMMAND_REASON };
      }
    }
  }

  const promptFocusedTestCommands = extractFocusedTestCommandTexts(step.prompt);
  if (
    promptFocusedTestCommands.some(
      (command) => !extractFocusedTestCommandTexts(step.verify).includes(command),
    )
  ) {
    return { valid: false, reason: FOCUSED_TEST_VERIFY_REASON };
  }

  const promptBuildCommands = extractBuildCommandTexts(step.prompt);
  if (
    promptBuildCommands.some(
      (command) => !extractBuildCommandTexts(step.verify).includes(command),
    )
  ) {
    return { valid: false, reason: BUILD_VERIFY_REASON };
  }

  return { valid: true };
}

function extractTestFilePaths(text: string): string[] {
  return uniqueMatches(text, TEST_FILE_PATH_RE, 0);
}

function extractFocusedTestCommandPaths(text: string): string[] {
  return uniqueMatches(text, FOCUSED_TEST_COMMAND_RE, 1);
}

function extractFocusedTestCommandTexts(text: string): string[] {
  return uniqueMatches(text, FOCUSED_TEST_COMMAND_TEXT_RE, 1);
}

function extractBuildCommandTexts(text: string): string[] {
  return uniqueMatches(text, BUILD_COMMAND_TEXT_RE, 1);
}

function extractTestArtifactPaths(steps: ParsedStep[]): string[] {
  const paths = new Set<string>();
  for (const step of steps) {
    const text = `${step.name}\n${step.prompt}\n${step.verify}`;
    if (
      !TEST_ARTIFACT_STEP_RE.test(text) ||
      !TEST_ARTIFACT_CHANGE_RE.test(text)
    ) {
      continue;
    }
    for (const path of extractTestFilePaths(text)) {
      paths.add(path);
    }
  }
  return [...paths];
}

function uniqueMatches(text: string, pattern: RegExp, groupIndex: number): string[] {
  const values = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const value = match[groupIndex];
    if (value) values.add(value);
  }
  return [...values];
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}
