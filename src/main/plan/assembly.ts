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
  const requestedToolNames = findRequestedToolNames(trimmedTask);
  const requestedToolGuidance = buildRequestedToolPlanningGuidance(
    requestedToolNames,
  );
  return (
    PLAN_ASSEMBLY_INITIAL_PROMPT_PREFIX +
    taskSentence +
    requestedToolGuidance +
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
  const targets = buildRequestedHostToolPlanTargets(toolNames);
  if (targets.length === 0) {
    return toolNames.length > 0
      ? " Use the exact tool name " +
          toolNames.join(", ") +
          " in every implementation, test, and verification step."
      : "";
  }
  const targetText = targets
    .map(
      (target) =>
        target.toolName +
        " -> " +
        target.testPath +
        "; focused test command " +
        target.focusedTestCommand +
        "; build command " +
        target.buildCommand,
    )
    .join("; ");
  return (
    " For requested get_current_* host tools, use this reusable plan convention: keep every requested get_current_* tool name exact; derive the test file as tests/main/current<PascalCase suffix>Tool.test.ts by dropping get_current_, PascalCasing the remaining underscore-separated words, prefixing current, and suffixing Tool.test.ts; use pnpm test <derived test file> as the focused test command; use pnpm run build as the build command; and do not return plan: done until the accepted plan has unique grounding, test, implementation, and verification steps. The grounding step must name the exact canonical paths " +
    HOST_TOOL_SOURCE_PATH +
    ", " +
    HOST_TOOL_DOC_PATH +
    ", " +
    HOST_TOOL_PACKAGE_PATH +
    ", and the derived tests/main/*.test.ts path, and its prompt must say to read or inspect those exact paths rather than list them as directories; avoid broad directory-list grounding such as List src/main. The accepted steps should be emitted in this order: grounding, test, implementation, verification. The test step prompt must say to read the derived test file, add or update coverage only if missing, then run the exact focused test command, and both prompt and verify must include that command. The implementation step must tell the agent to read " +
    HOST_TOOL_SOURCE_PATH +
    " and " +
    HOST_TOOL_DOC_PATH +
    ", add the requested tool only if missing, and avoid editing those files if the tool is already present. Requested host-tool targets: " +
    targetText +
    "."
  );
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

function invalidHostToolStepReason(
  step: ParsedStep,
  state: PlanAssemblyState,
  task: string,
): string | null {
  const targets = buildRequestedHostToolPlanTargets(findRequestedToolNames(task));
  if (targets.length === 0) return null;
  for (const target of targets) {
    if (isHostToolGroundingStep(step, target)) {
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
          `Use ${HOST_TOOL_SOURCE_PATH}, ${HOST_TOOL_DOC_PATH}, ` +
          `${HOST_TOOL_PACKAGE_PATH}, and ${target.testPath}.`
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
        !/\b(read|inspect|inspected)\b/i.test(step.verify)
      ) {
        return (
          `Host-tool grounding verify text for ${target.toolName} must say the ` +
          `exact files have been read or inspected, not that a listing was retrieved.`
        );
      }
    }
    if (
      isHostToolImplementationStep(step, target) &&
      !state.steps.some((accepted) => isHostToolTestStep(accepted, target))
    ) {
      return (
        `Host-tool implementation step for ${target.toolName} must come after ` +
        `the test step that names ${target.focusedTestCommand}.`
      );
    }
    if (
      isHostToolVerificationStep(step, target) &&
      !state.steps.some((accepted) =>
        isHostToolImplementationStep(accepted, target),
      )
    ) {
      return (
        `Host-tool verification step for ${target.toolName} must come after ` +
        `the implementation step.`
      );
    }
  }
  return null;
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
    text.includes(target.testPath) &&
    text.includes(target.focusedTestCommand)
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

function isHostToolVerificationStep(
  step: ParsedStep,
  target: HostToolPlanTarget,
): boolean {
  const text = `${step.name}\n${step.prompt}\n${step.verify}`;
  return (
    /\b(verify|build|run|pnpm|npm)\b/i.test(`${step.name}\n${step.prompt}`) &&
    text.includes(target.focusedTestCommand) &&
    text.includes(target.buildCommand)
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
  const requestedToolGuidance = buildRequestedToolPlanningGuidance(
    findRequestedToolNames(task),
  ).trim();
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
      ...(requestedToolGuidance.length > 0
        ? [requestedToolGuidance, ""]
        : []),
      ...progressGuidance,
      "Return exactly one YAML plan containing one step, with name, prompt, and verify string fields.",
      ...(acceptedStepNames.length > 0
        ? ["If the assembled plan is complete, return exactly " + PLAN_ASSEMBLY_DONE_TEXT + "."]
        : []),
    ].join("\n"),
  };
}

function buildPlanAssemblyNextPrompt(
  state: PlanAssemblyState,
  task: string,
): string {
  const requestedToolGuidance = buildRequestedToolPlanningGuidance(
    findRequestedToolNames(task),
  ).trim();
  const progressGuidance = buildTaskSpecificPlanProgressGuidance(state, task);
  const acceptedSteps =
    state.steps.length > 0
      ? `Accepted steps so far: ${state.steps.map((step) => step.name).join(", ")}.`
      : "";
  return [
    PLAN_ASSEMBLY_NEXT_PROMPT,
    ...(acceptedSteps.length > 0 ? ["", acceptedSteps] : []),
    ...(requestedToolGuidance.length > 0
      ? ["", requestedToolGuidance]
      : []),
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
      `Next missing requirement: emit the grounding step for ${toolName}.`,
      `That single step's prompt must tell the agent to read or inspect ${target.groundingPaths.join(", ")}.`,
      `That single step's verify field must say ${target.groundingPaths.join(", ")} have been read or inspected.`,
      "Do not return plan: done until this grounding step is accepted.",
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
      `Next missing requirement: emit the test step for ${toolName}.`,
      `That single step's prompt must tell the agent to read ${testPath}, add or update coverage only if missing, then run ${focusedCommand}.`,
      `That single step's verify field must say ${testPath} covers ${toolName}, and ${focusedCommand} passes.`,
      "Do not return plan: done until this test step is accepted.",
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
      `Next missing requirement: emit the implementation step for ${toolName}.`,
      `That single step must tell the agent to read src/main/tools.ts and Gemma.md, add ${toolName} only if missing, and avoid editing those files if ${toolName} is already present.`,
      "Do not return plan: done until this implementation step is accepted.",
    ];
  }
  if (!acceptedText.includes("pnpm run build")) {
    return [
      `Next missing requirement: emit the verification or build step for ${toolName}.`,
      `That single step's prompt and verify fields must both contain ${focusedCommand} and pnpm run build.`,
      "Do not return plan: done until this verification step is accepted.",
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
