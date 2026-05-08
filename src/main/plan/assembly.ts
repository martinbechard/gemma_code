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
  const names = new Set(text.match(/\bget_current_[a-z_]+\b/g) ?? []);
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

export function buildRequestedToolPlanningGuidance(
  toolNames: string[],
): string {
  const details = toolNames.flatMap((toolName) => {
    const testPath = testPathForRequestedTool(toolName);
    return testPath ? [{ toolName, testPath }] : [];
  });
  if (details.length === 0) {
    return toolNames.length > 0
      ? " Use the exact tool name " +
          toolNames.join(", ") +
          " in every implementation, test, and verification step."
      : "";
  }
  return details
    .map(
      ({ toolName, testPath }) =>
        " For " +
        toolName +
        ", use the exact test file " +
        testPath +
        ", the exact focused test command pnpm test " +
        testPath +
        ", and the exact build command pnpm run build. The grounding step must read src/main/tools.ts, Gemma.md, package.json, and " +
        testPath +
        " exactly; do not use broad directory-list grounding such as List src/main. Keep the tool name " +
        toolName +
        " exactly in every implementation, test, and verification step. The test step is invalid unless its prompt and verify fields both include pnpm test " +
        testPath +
        ". The test step prompt must say to read " +
        testPath +
        ", add or update coverage only if missing, then run pnpm test " +
        testPath +
        ", not only name that command in verify. The implementation step prompt must tell the agent to read src/main/tools.ts and Gemma.md, add " +
        toolName +
        " only if missing, and avoid editing those files if " +
        toolName +
        " is already present. Do not return plan: done until the accepted plan has unique grounding, test, implementation, and verification steps.",
    )
    .join("");
}

export function buildFallbackPlanForTask(task: string): ParsedPlan | null {
  const requestedToolNames = findRequestedToolNames(task);
  if (requestedToolNames.length !== 1) return null;
  const toolName = requestedToolNames[0];
  const testPath = testPathForRequestedTool(toolName);
  if (!testPath) return null;

  const steps: ParsedStep[] = [
    {
      name: "ground_tool",
      prompt:
        `Read src/main/tools.ts, Gemma.md, package.json, and ${testPath}.`,
      verify:
        `src/main/tools.ts, Gemma.md, package.json, and ${testPath} have been read.`,
    },
    {
      name: "test_tool",
      prompt:
        `Read ${testPath}, confirm whether it already covers ${toolName}, do not edit ${testPath} if that coverage is already present, then run pnpm test ${testPath}.`,
      verify:
        `${testPath} covers ${toolName}, and pnpm test ${testPath} has been run.`,
    },
    {
      name: "confirm_implementation",
      prompt:
        `Read src/main/tools.ts and Gemma.md to confirm the ${toolName} implementation and documentation are present. If both files already contain ${toolName}, do not edit either file; summarize the existing implementation evidence instead.`,
      verify: `src/main/tools.ts and Gemma.md contain ${toolName}.`,
    },
    {
      name: "verify_tool",
      prompt:
        `First use run_bash with exactly pnpm test ${testPath}. Then run pnpm test and pnpm run build.`,
      verify:
        `pnpm test ${testPath}, pnpm test, and pnpm run build pass.`,
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
    if (!testPathForRequestedTool(toolName)) continue;
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
        `src/main/tools.ts and Gemma.md, add ${toolName} only if missing, ` +
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
    const testPath = testPathForRequestedTool(toolName);
    if (!testPath) continue;
    const requiredPaths = [
      "src/main/tools.ts",
      "Gemma.md",
      "package.json",
      testPath,
    ];
    const missingPaths = requiredPaths.filter((path) => !plan.raw.includes(path));
    if (missingPaths.length > 0) {
      return (
        `Known host-tool plan for ${toolName} must ground on exact files: ` +
        `${requiredPaths.join(", ")}. Missing: ${missingPaths.join(", ")}.`
      );
    }
  }
  return null;
}

function testPathForRequestedTool(toolName: string): string | null {
  if (toolName === "get_current_working_directory") {
    return "tests/main/currentWorkingDirectoryTool.test.ts";
  }
  if (toolName === "get_current_datetime") {
    return "tests/main/currentDatetimeTool.test.ts";
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

  return {
    kind: "accepted",
    state: { steps: [...state.steps, step] },
    nextPrompt: buildPlanAssemblyNextPrompt(
      { steps: [...state.steps, step] },
      task,
    ),
  };
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
  const testPath = testPathForRequestedTool(toolName);
  if (!testPath) return [];
  const focusedCommand = `pnpm test ${testPath}`;
  const acceptedText = state.steps
    .map((step) => `${step.name}\n${step.prompt}\n${step.verify}`)
    .join("\n");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
