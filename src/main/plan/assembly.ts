import { parse, stringify } from "yaml";
import { findNextPlan, type ParsedPlan, type ParsedStep } from "./parser";
import { validatePlanForExecution, validatePlanStepText } from "./validation";

const MAX_PLAN_ASSEMBLY_STEPS = 16;
const WHOLE_RESPONSE_YAML_FENCE_RE =
  /^```(?:yaml|yml)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i;

export const PLAN_ASSEMBLY_DONE_TEXT = "plan: done";
const PLAN_ASSEMBLY_INITIAL_PROMPT_PREFIX =
  "As an expert in software development and AI-assisted coding, I need your help in instructing an AI coding agent. Our task: ";
const PLAN_ASSEMBLY_INITIAL_PROMPT_SUFFIX =
  " What should I start by telling the agent? in YAML only no extra explanations, just the prompt?";
export const PLAN_ASSEMBLY_NEXT_PROMPT = [
  "What should I tell the agent next? Continue the same plan with exactly one additional YAML step.",
  "Return plan: done only after the accepted steps visibly include grounding, test, implementation, the exact focused test command, and the exact build command.",
  "If any of those are missing, do not return plan: done. YAML only, no extra explanations.",
].join("\n");
const HOST_TOOL_SOURCE_PATH = "src/main/tools.ts";
const HOST_TOOL_DOC_PATH = "Gemma.md";
const HOST_TOOL_PACKAGE_PATH = "package.json";
const HOST_TOOL_BUILD_COMMAND = "pnpm run build";
const HOST_TOOL_NAME_RE = /^get_current_[a-z0-9_]+$/;
const HOST_TOOL_NAME_GLOBAL_RE = /\bget_current_[a-z0-9_]+\b/g;
const TEST_FILE_PATH_RE = /\btests\/main\/[^\s<>"']+\.test\.ts\b/g;
const FOCUSED_TEST_COMMAND_TEXT_RE =
  /\b((?:pnpm|npm) test\s+(?:--\s+)?tests\/main\/[^\s<>"']+\.test\.ts)\b/g;

export interface HostToolPlanTarget {
  toolName: string;
  testPath: string;
  focusedTestCommand: string;
  buildCommand: string;
  groundingPaths: string[];
}

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

export function findRequestedToolNames(text: string): string[] {
  const names = new Set(text.match(HOST_TOOL_NAME_GLOBAL_RE) ?? []);
  if (
    /\bcurrent\s+working\s+directory\b/i.test(text) ||
    /\bprocess\s+current\s+working\s+directory\b/i.test(text)
  ) {
    names.add("get_current_working_directory");
  }
  if (
    /\bcurrent\s+date\s+time\b/i.test(text) ||
    /\bcurrent\s+datetime\b/i.test(text)
  ) {
    names.add("get_current_datetime");
  }
  return [...names];
}

export function deriveHostToolPlanTarget(
  toolName: string,
): HostToolPlanTarget | null {
  if (!HOST_TOOL_NAME_RE.test(toolName)) return null;
  const suffix = toolName.slice("get_current_".length);
  const words = suffix.split("_").filter((word) => word.length > 0);
  if (words.length === 0) return null;
  const testPath =
    "tests/main/current" +
    words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join("") +
    "Tool.test.ts";
  const focusedTestCommand = `pnpm test ${testPath}`;
  return {
    toolName,
    testPath,
    focusedTestCommand,
    buildCommand: HOST_TOOL_BUILD_COMMAND,
    groundingPaths: [
      HOST_TOOL_SOURCE_PATH,
      HOST_TOOL_DOC_PATH,
      HOST_TOOL_PACKAGE_PATH,
      testPath,
    ],
  };
}

export function buildRequestedHostToolPlanTargets(
  toolNames: string[],
): HostToolPlanTarget[] {
  return toolNames.flatMap((toolName) => {
    const target = deriveHostToolPlanTarget(toolName);
    return target ? [target] : [];
  });
}

export function buildRequestedToolPlanningGuidance(
  toolNames: string[],
): string {
  return toolNames.length > 0
    ? " Keep the requested tool name exactly: " +
        toolNames.join(", ") +
        ". Use project instructions and grounded file evidence to derive placement, tests, and commands."
    : "";
}

export function buildFallbackPlanForTask(task: string): ParsedPlan | null {
  const requestedToolNames = findRequestedToolNames(task);
  if (requestedToolNames.length !== 1) return null;
  const toolName = requestedToolNames[0];
  const target = deriveHostToolPlanTarget(toolName);
  if (!target) return null;

  const steps: ParsedStep[] = [
    {
      name: "ground_tool",
      prompt:
        `Read ${HOST_TOOL_SOURCE_PATH}, ${HOST_TOOL_DOC_PATH}, and ${HOST_TOOL_PACKAGE_PATH}, then inspect whether ${target.testPath} exists with rg --files tests/main | rg "${testFileNamePattern(target.testPath)}".`,
      verify:
        `${HOST_TOOL_SOURCE_PATH}, ${HOST_TOOL_DOC_PATH}, ${HOST_TOOL_PACKAGE_PATH}, and ${target.testPath} have been inspected.`,
    },
    {
      name: "test_tool",
      prompt:
        `Read ${target.testPath}, confirm whether it already covers ${toolName}, add or update coverage only if missing, do not edit ${target.testPath} if that coverage is already present, then run ${target.focusedTestCommand}.`,
      verify:
        `${target.testPath} covers ${toolName}, and ${target.focusedTestCommand} has been run.`,
    },
    {
      name: "implement_tool",
      prompt:
        `Read ${HOST_TOOL_SOURCE_PATH} and ${HOST_TOOL_DOC_PATH}, add ${toolName} only if missing, and avoid editing those files if ${toolName} is already present.`,
      verify: `${HOST_TOOL_SOURCE_PATH} and ${HOST_TOOL_DOC_PATH} contain ${toolName}.`,
    },
    {
      name: "verify_tool",
      prompt:
        `First use run_bash with exactly ${target.focusedTestCommand}. Then run pnpm test and ${target.buildCommand}.`,
      verify:
        `${target.focusedTestCommand}, pnpm test, and ${target.buildCommand} pass.`,
    },
  ];
  const raw = stringify({ plan: { steps } }).trimEnd();
  return {
    steps,
    raw,
    start: 0,
    end: raw.length,
  };
}

export function unsafeKnownHostToolImplementationReason(
  plan: ParsedPlan,
  toolNames: string[],
): string | null {
  for (const toolName of toolNames) {
    if (!deriveHostToolPlanTarget(toolName)) continue;
    const firstBuildOrVerifyIndex = plan.steps.findIndex((step) =>
      /\bpnpm\s+run\s+build\b|\bnpm\s+run\s+build\b/i.test(
        `${step.name}\n${step.prompt}\n${step.verify}`,
      ),
    );
    for (const [stepIndex, step] of plan.steps.entries()) {
      const stepText = `${step.name}\n${step.prompt}\n${step.verify}`;
      const implementationStep =
        /\b(implement|edit|add|update)\b/i.test(`${step.name}\n${step.prompt}`) &&
        stepText.includes(toolName) &&
        stepText.includes("src/main/tools.ts");
      if (!implementationStep) continue;
      if (
        firstBuildOrVerifyIndex >= 0 &&
        stepIndex > firstBuildOrVerifyIndex
      ) {
        return (
          `Implementation step for ${toolName} must come before final ` +
          `verification or build steps.`
        );
      }
      if (
        /\b(read|inspect)\b[\s\S]*\bsrc\/main\/tools\.ts\b/i.test(
          step.prompt,
        ) &&
        /\b(already present|already contain|do not edit|avoid editing|only if missing|if missing)\b/i.test(
          step.prompt,
        )
      ) {
        continue;
      }
      return (
        `Implementation step for ${toolName} must tell the agent to read ` +
        `${HOST_TOOL_SOURCE_PATH} and ${HOST_TOOL_DOC_PATH}, add ${toolName} only if missing, ` +
        `and avoid editing those files if ${toolName} is already present.`
      );
    }
  }
  return null;
}

export function missingKnownHostToolGroundingReason(
  plan: ParsedPlan,
  toolNames: string[],
): string | null {
  for (const toolName of toolNames) {
    const target = deriveHostToolPlanTarget(toolName);
    if (!target) continue;
    const requiredPaths = target.groundingPaths;
    const missingPaths = requiredPaths.filter((path) => !plan.raw.includes(path));
    if (missingPaths.length > 0) {
      return (
        `Host-tool plan for ${toolName} must ground on exact files by convention: ` +
        `${requiredPaths.join(", ")}. Missing: ${missingPaths.join(", ")}.`
      );
    }
  }
  return null;
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

  let [step] = parsed.steps;
  const stepValidation = validatePlanStepText(step);
  if (!stepValidation.valid) {
    const repairedStep = repairPlanAssemblyStep(step, stepValidation.reason);
    if (!repairedStep) {
      return rejected(state, stepValidation.reason, task);
    }
    const repairedStepValidation = validatePlanStepText(repairedStep);
    if (!repairedStepValidation.valid) {
      return rejected(state, repairedStepValidation.reason, task);
    }
    step = repairedStep;
  }
  if (state.steps.some((existing) => existing.name === step.name)) {
    return rejected(state, 'Duplicate step name "' + step.name + '".', task, {
      duplicateStepName: step.name,
    });
  }
  const taskSpecificReason = invalidHostToolStepReason(step, state, task);
  if (taskSpecificReason) {
    return rejected(state, taskSpecificReason, task);
  }

  return {
    kind: "accepted",
    state: { steps: [...state.steps, step] },
    nextPrompt: buildPlanAssemblyNextPrompt(
      { steps: [...state.steps, step] },
      task,
    ),
  };
}

function repairPlanAssemblyStep(
  step: ParsedStep,
  reason: string,
): ParsedStep | null {
  if (
    !reason.includes(
      "Plan test step must name the exact focused test command",
    ) &&
    !reason.includes(
      "Every step that runs a focused test command must repeat the exact command",
    )
  ) {
    return null;
  }
  const text = `${step.prompt}\n${step.verify}`;
  const focusedCommands = uniqueMatches(text, FOCUSED_TEST_COMMAND_TEXT_RE, 1);
  if (focusedCommands.length !== 1) return null;
  const [focusedCommand] = focusedCommands;
  const commandPath = focusedCommand.replace(/^(?:pnpm|npm) test\s+(?:--\s+)?/, "");
  const testPaths = uniqueMatches(text, TEST_FILE_PATH_RE, 0);
  if (!testPaths.includes(commandPath)) return null;

  return {
    ...step,
    prompt: step.prompt.includes(focusedCommand)
      ? step.prompt
      : appendSentence(step.prompt, `Then run ${focusedCommand}.`),
    verify: step.verify.includes(focusedCommand)
      ? step.verify
      : appendSentence(step.verify, `${focusedCommand} has been run.`),
  };
}

function appendSentence(text: string, sentence: string): string {
  const trimmedText = text.trim();
  const separator = /[.!?]$/.test(trimmedText) ? " " : ", ";
  return trimmedText + separator + sentence;
}

function uniqueMatches(text: string, pattern: RegExp, groupIndex: number): string[] {
  const values = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const value = match[groupIndex];
    if (value) values.add(value);
  }
  return [...values];
}

function invalidHostToolStepReason(
  step: ParsedStep,
  state: PlanAssemblyState,
  task: string,
): string | null {
  const targets = buildRequestedHostToolPlanTargets(findRequestedToolNames(task));
  if (targets.length === 0) return null;
  for (const target of targets) {
    const stepText = `${step.name}\n${step.prompt}\n${step.verify}`;
    if (isHostToolGroundingStep(step, target)) {
      const missingGroundingPaths = target.groundingPaths.filter(
        (path) => !stepText.includes(path),
      );
      if (missingGroundingPaths.length > 0) {
        return (
          `Host-tool grounding step for ${target.toolName} must name exact ` +
          `canonical paths: ${target.groundingPaths.join(", ")}. ` +
          `Missing: ${missingGroundingPaths.join(", ")}. ` +
          `Use prompt: Read or inspect ${target.groundingPaths.join(", ")}. ` +
          `Use verify: ${target.groundingPaths.join(", ")} have been read or inspected.`
        );
      }
      if (state.steps.some((accepted) => isHostToolGroundingStep(accepted, target))) {
        return (
          `Host-tool grounding step for ${target.toolName} is already accepted. ` +
          `Emit the test step that names ${target.focusedTestCommand} next.`
        );
      }
      if (!/\b(read|inspect)\b/i.test(step.prompt)) {
        return (
          `Host-tool grounding step for ${target.toolName} must tell the agent ` +
          `to read or inspect exact files, not list file paths as directories. ` +
          `Use prompt: Read or inspect ${target.groundingPaths.join(", ")}. ` +
          `Use verify: ${target.groundingPaths.join(", ")} have been read or inspected.`
        );
      }
      if (/\blist\s+src\/main\b/i.test(step.prompt)) {
        return (
          `Host-tool grounding step for ${target.toolName} must not use broad ` +
          `directory-list grounding such as List src/main.`
        );
      }
      if (
        /\blisting\b/i.test(step.verify) ||
        !/\b(read|reading|inspect|inspected|inspection)\b/i.test(step.verify)
      ) {
        return (
          `Host-tool grounding verify text for ${target.toolName} must say the ` +
          `exact files have been read or inspected, not that a listing was retrieved.`
        );
      }
      continue;
    }
    if (isHostToolTestIntent(step, state, target)) {
      const hasGroundingStep = state.steps.some((accepted) =>
        isHostToolGroundingStep(accepted, target),
      );
      if (!hasGroundingStep) {
        return (
          `Host-tool test step for ${target.toolName} must come after the ` +
          `grounding step that reads or inspects ${target.groundingPaths.join(", ")}.`
        );
      }
      if (!isHostToolTestStep(step, target)) {
        return (
          `Host-tool test step for ${target.toolName} must name ` +
          `${target.testPath} and ${target.focusedTestCommand} in both ` +
          `prompt and verify. Use prompt: Read ${target.testPath}, confirm ` +
          `whether it already covers ${target.toolName}, add or update ` +
          `coverage only if missing, then run ${target.focusedTestCommand}. ` +
          `Use verify: ${target.testPath} covers ${target.toolName}, and ` +
          `${target.focusedTestCommand} has been run.`
        );
      }
      continue;
    }
    if (
      isHostToolImplementationIntent(step, state, target)
    ) {
      if (!state.steps.some((accepted) => isHostToolTestStep(accepted, target))) {
        return (
          `Host-tool implementation step for ${target.toolName} must come after ` +
          `the test step that names ${target.focusedTestCommand}.`
        );
      }
      if (!isGuardedHostToolImplementationStep(step, target)) {
        return (
          guardedHostToolImplementationReason(target.toolName) +
          ` Use prompt: Read ${HOST_TOOL_SOURCE_PATH} and ${HOST_TOOL_DOC_PATH}, ` +
          `add ${target.toolName} only if missing, and avoid editing those files ` +
          `if ${target.toolName} is already present.`
        );
      }
    }
    if (
      isHostToolVerificationIntent(step, state, target)
    ) {
      if (
        !state.steps.some((accepted) =>
          isHostToolImplementationStep(accepted, target),
        )
      ) {
        return (
          `Host-tool verification step for ${target.toolName} must come after ` +
          `the implementation step.`
        );
      }
      if (!isHostToolVerificationStep(step, target)) {
        return (
          `Host-tool verification step for ${target.toolName} must include ` +
          `${target.focusedTestCommand} and ${target.buildCommand} in both ` +
          `prompt and verify. Use prompt: Run ${target.focusedTestCommand} ` +
          `and ${target.buildCommand}. Use verify: ${target.focusedTestCommand} ` +
          `and ${target.buildCommand} pass.`
        );
      }
    }
  }
  return null;
}

function guardedHostToolImplementationReason(toolName: string): string {
  return (
    `Host-tool implementation step for ${toolName} must tell the agent to ` +
    `read ${HOST_TOOL_SOURCE_PATH} and ${HOST_TOOL_DOC_PATH}, add ${toolName} ` +
    `only if missing, and avoid editing those files if ${toolName} is already present.`
  );
}

function isHostToolGroundingStep(
  step: ParsedStep,
  target: HostToolPlanTarget,
): boolean {
  const text = `${step.name}\n${step.prompt}\n${step.verify}`;
  const intentText = `${step.name}\n${step.prompt}`;
  const hasNonGroundingIntent =
    /\b(implement|edit|add|update)\b/i.test(intentText) ||
    /\b(test|spec)\b/i.test(step.name) ||
    /\b(?:pnpm|npm)\s+test\b/i.test(step.prompt);
  const hasGroundingIntent =
    /\b(ground|explore)\b/i.test(intentText) ||
    (/\b(read|inspect|list)\b/i.test(intentText) &&
      !hasNonGroundingIntent);
  return (
    hasGroundingIntent &&
    (target.groundingPaths.some((path) => text.includes(path)) ||
      text.includes(target.toolName))
  );
}

function isHostToolTestStep(
  step: ParsedStep,
  target: HostToolPlanTarget,
): boolean {
  const text = `${step.name}\n${step.prompt}\n${step.verify}`;
  return (
    /\b(test|spec)\b/i.test(text) &&
    /\b(read|inspect)\b/i.test(step.prompt) &&
    /\b(write|create|update|add|extend|edit|cover|confirm)\b/i.test(
      step.prompt,
    ) &&
    step.prompt.includes(target.testPath) &&
    step.prompt.includes(target.focusedTestCommand) &&
    step.verify.includes(target.testPath) &&
    step.verify.includes(target.focusedTestCommand)
  );
}

function isHostToolTestIntent(
  step: ParsedStep,
  state: PlanAssemblyState,
  target: HostToolPlanTarget,
): boolean {
  const text = `${step.name}\n${step.prompt}\n${step.verify}`;
  const hasTestArtifactIntent =
    /\b(test|spec)\b/i.test(step.name) ||
    /\b(unit test|test coverage|coverage|spec)\b/i.test(step.prompt) ||
    (step.prompt.includes(target.testPath) &&
      /\b(read|write|create|update|add|extend|edit|cover|confirm)\b/i.test(
        step.prompt,
      ));
  return (
    hasTestArtifactIntent &&
    (text.includes(target.toolName) ||
      text.includes(target.testPath) ||
      text.includes(target.focusedTestCommand) ||
      state.steps.some((accepted) => isHostToolGroundingStep(accepted, target)))
  );
}

function isHostToolImplementationStep(
  step: ParsedStep,
  target: HostToolPlanTarget,
): boolean {
  const text = `${step.name}\n${step.prompt}\n${step.verify}`;
  return (
    /\b(implement|edit|add|update)\b/i.test(`${step.name}\n${step.prompt}`) &&
    text.includes(target.toolName) &&
    text.includes(HOST_TOOL_SOURCE_PATH)
  );
}

function isHostToolImplementationIntent(
  step: ParsedStep,
  state: PlanAssemblyState,
  target: HostToolPlanTarget,
): boolean {
  const text = `${step.name}\n${step.prompt}\n${step.verify}`;
  return (
    /\b(implement|edit|add|update)\b/i.test(`${step.name}\n${step.prompt}`) &&
    (text.includes(target.toolName) ||
      text.includes(HOST_TOOL_SOURCE_PATH) ||
      state.steps.some((accepted) => isHostToolTestStep(accepted, target)))
  );
}

function isGuardedHostToolImplementationStep(
  step: ParsedStep,
  target: HostToolPlanTarget,
): boolean {
  return (
    isHostToolImplementationStep(step, target) &&
    step.prompt.includes(HOST_TOOL_DOC_PATH) &&
    /\b(read|inspect)\b[\s\S]*\bsrc\/main\/tools\.ts\b/i.test(step.prompt) &&
    /\b(already present|already contain|do not edit|avoid editing|only if missing|if missing)\b/i.test(
      step.prompt,
    )
  );
}

function isHostToolVerificationStep(
  step: ParsedStep,
  target: HostToolPlanTarget,
): boolean {
  return (
    /\b(verify|build|run|pnpm|npm)\b/i.test(`${step.name}\n${step.prompt}`) &&
    step.prompt.includes(target.focusedTestCommand) &&
    step.prompt.includes(target.buildCommand) &&
    step.verify.includes(target.focusedTestCommand) &&
    step.verify.includes(target.buildCommand)
  );
}

function isHostToolVerificationIntent(
  step: ParsedStep,
  state: PlanAssemblyState,
  target: HostToolPlanTarget,
): boolean {
  const text = `${step.name}\n${step.prompt}\n${step.verify}`;
  return (
    /\b(verify|build|run|pnpm|npm)\b/i.test(`${step.name}\n${step.prompt}`) &&
    (text.includes(target.toolName) ||
      text.includes(target.testPath) ||
      text.includes(target.focusedTestCommand) ||
      text.includes(target.buildCommand) ||
      state.steps.some((accepted) => isHostToolImplementationStep(accepted, target)))
  );
}

export function isPlanAssemblyDoneResponse(response: string): boolean {
  const raw = response.trim();
  const fenced = WHOLE_RESPONSE_YAML_FENCE_RE.exec(raw);
  const text = (fenced?.[1] ?? raw).trim();
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
  task = "",
  options: { duplicateStepName?: string } = {},
): PlanAssemblyResult {
  const acceptedStepNames = state.steps.map((step) => step.name);
  const progressGuidance = buildTaskSpecificPlanProgressGuidance(state, task);
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
      ...progressGuidance,
      "Return exactly one YAML plan containing one step, with name, prompt, and verify string fields.",
      ...(acceptedStepNames.length > 0
        ? ["If the assembled plan is complete, return exactly " + PLAN_ASSEMBLY_DONE_TEXT + "."]
        : []),
      "Use exact file paths and commands named in the rejection reason; do not substitute broad labels such as existing tests, derived test file, or focused test command.",
    ].join("\n"),
  };
}

function buildPlanAssemblyNextPrompt(
  state: PlanAssemblyState,
  task: string,
): string {
  const progressGuidance = buildTaskSpecificPlanProgressGuidance(state, task);
  const acceptedSteps =
    state.steps.length > 0
      ? `Accepted steps so far: ${state.steps.map((step) => step.name).join(", ")}.`
      : "";
  return [
    PLAN_ASSEMBLY_NEXT_PROMPT,
    ...(acceptedSteps.length > 0 ? ["", acceptedSteps] : []),
    ...(progressGuidance.length > 0 ? ["", ...progressGuidance] : []),
  ].join("\n");
}

function buildTaskSpecificPlanProgressGuidance(
  state: PlanAssemblyState,
  task: string,
): string[] {
  const [toolName] = findRequestedToolNames(task);
  if (!toolName) return [];
  const target = deriveHostToolPlanTarget(toolName);
  if (!target) return [];
  const testPath = target.testPath;
  const focusedCommand = target.focusedTestCommand;
  const acceptedText = state.steps
    .map((step) => `${step.name}\n${step.prompt}\n${step.verify}`)
    .join("\n");
  const hasGroundingStep = state.steps.some((step) =>
    isHostToolGroundingStep(step, target),
  );
  if (!hasGroundingStep) {
    return [
      "Next required step: grounding. Return a YAML step whose prompt says exactly: Read or inspect " +
        target.groundingPaths.join(", ") +
        ". The verify field must say exactly: " +
        target.groundingPaths.join(", ") +
        " have been read or inspected.",
    ];
  }
  const hasTestArtifactStep = state.steps.some((step) => {
    const stepText = `${step.name}\n${step.prompt}\n${step.verify}`;
    return (
      /\b(test|spec)\b/i.test(stepText) &&
      /\b(write|create|update|add|extend|edit|cover)\b/i.test(stepText) &&
      stepText.includes(testPath) &&
      stepText.includes(focusedCommand)
    );
  });
  if (!hasTestArtifactStep) {
    return [
      "Next required step: test. Return a YAML step whose prompt says exactly: Read " +
        testPath +
        ", confirm whether it already covers " +
        toolName +
        ", add or update coverage only if missing, then run " +
        focusedCommand +
        ". The verify field must say exactly: " +
        testPath +
        " covers " +
        toolName +
        ", and " +
        focusedCommand +
        " has been run.",
    ];
  }
  const hasImplementationStep = state.steps.some((step) => {
    const stepText = `${step.name}\n${step.prompt}\n${step.verify}`;
    return (
      /\b(implement|edit|add|update)\b/i.test(`${step.name}\n${step.prompt}`) &&
      stepText.includes(toolName) &&
      stepText.includes("src/main/tools.ts")
    );
  });
  if (!hasImplementationStep) {
    return [
      "Next required step: implementation. Return a YAML step whose prompt says exactly: Read " +
        HOST_TOOL_SOURCE_PATH +
        " and " +
        HOST_TOOL_DOC_PATH +
        ", add " +
        toolName +
        " only if missing, and avoid editing those files if " +
        toolName +
        " is already present. The verify field must say exactly: " +
        HOST_TOOL_SOURCE_PATH +
        " and " +
        HOST_TOOL_DOC_PATH +
        " contain " +
        toolName +
        ".",
    ];
  }
  if (!acceptedText.includes("pnpm run build")) {
    return [
      "Next required step: verification. Return a YAML step whose prompt says exactly: Run " +
        focusedCommand +
        " and " +
        target.buildCommand +
        ". The verify field must say exactly: " +
        focusedCommand +
        " and " +
        target.buildCommand +
        " pass.",
    ];
  }
  return [];
}

function testFileNamePattern(testPath: string): string {
  return testPath.split("/").at(-1) ?? testPath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
