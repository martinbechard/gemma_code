import { describe, expect, it } from "vitest";
import {
  PLAN_ASSEMBLY_DONE_TEXT,
  PLAN_ASSEMBLY_NEXT_PROMPT,
  applyPlanAssemblyResponse,
  buildPlanAssemblyInitialPrompt,
  buildFallbackPlanForTask,
  createPlanAssemblyState,
  finalizeExecutablePlanAssembly,
  finalizePlanAssembly,
  findRequestedToolNames,
  missingKnownHostToolGroundingReason,
  unsafeKnownHostToolImplementationReason,
} from "../../../src/main/plan/assembly";
import { validatePlanForExecution } from "../../../src/main/plan/validation";

const exploreStep = [
  "plan:",
  "  steps:",
  "    - name: explore",
  "      prompt: List src/main/plan and read src/main/plan/parser.ts.",
  "      verify: src/main/plan has been listed and parser.ts has been read.",
].join("\n");

const testStep = [
  "plan:",
  "  steps:",
  "    - name: test",
  "      prompt: Update tests/main/plan/assembly.test.ts, then run npm test tests/main/plan/assembly.test.ts.",
  "      verify: npm test tests/main/plan/assembly.test.ts reports the expected failing assertion before implementation.",
].join("\n");

const implementStep = [
  "plan:",
  "  steps:",
  "    - name: implement",
  "      prompt: Edit src/main/index.ts and src/main/plan/assembly.ts to wire iterative plan assembly.",
  "      verify: src/main/index.ts calls applyPlanAssemblyResponse and src/main/plan/assembly.ts contains the assembly state machine.",
].join("\n");

const verifyStep = [
  "plan:",
  "  steps:",
  "    - name: verify",
  "      prompt: Run npm test tests/main/plan/assembly.test.ts, npm test, and npm run build, then report exact results.",
  "      verify: npm test tests/main/plan/assembly.test.ts, npm test, and npm run build pass.",
].join("\n");

const currentWorkingDirectoryTestStep = [
  "plan:",
  "  steps:",
  "    - name: test",
  "      prompt: Read tests/main/currentWorkingDirectoryTool.test.ts, add or update coverage only if missing, then run pnpm test tests/main/currentWorkingDirectoryTool.test.ts.",
  "      verify: tests/main/currentWorkingDirectoryTool.test.ts covers get_current_working_directory, and pnpm test tests/main/currentWorkingDirectoryTool.test.ts passes.",
].join("\n");

describe("iterative plan assembly", () => {
  it("builds the initial expert prompt around the user's task", () => {
    const prompt = buildPlanAssemblyInitialPrompt(
      "create a new LLM tool to retrieve the current working directory",
    );

    expect(prompt).toContain(
      "Our task: create a new LLM tool to retrieve the current working directory.",
    );
    expect(prompt).toContain("get_current_working_directory");
    expect(prompt).toContain("tests/main/currentWorkingDirectoryTool.test.ts");
    expect(prompt).toContain(
      "pnpm test tests/main/currentWorkingDirectoryTool.test.ts",
    );
    expect(prompt).toContain("pnpm run build");
    expect(prompt).toContain(
      "Do not return plan: done until the accepted plan has unique grounding, test, implementation, and verification steps.",
    );
  });

  it("infers requested get_current tool names from plain-language tasks", () => {
    expect(
      findRequestedToolNames(
        "create a new LLM tool to retrieve the current working directory",
      ),
    ).toEqual(["get_current_working_directory"]);
  });

  it("builds a concrete fallback plan for a known host tool request", () => {
    const plan = buildFallbackPlanForTask(
      "create a new LLM tool to retrieve the current working directory",
    );

    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.raw).toContain("get_current_working_directory");
    expect(plan.raw).toContain("tests/main/currentWorkingDirectoryTool.test.ts");
    expect(plan.steps[1]?.prompt).toContain(
      "do not edit tests/main/currentWorkingDirectoryTool.test.ts if that coverage is already present",
    );
    expect(plan.steps[2]?.name).toBe("confirm_implementation");
    expect(plan.steps[2]?.prompt).toContain(
      "confirm the get_current_working_directory implementation",
    );
    expect(plan.steps[2]?.prompt).toContain("do not edit either file");
    expect(plan.steps[3]?.prompt).toContain(
      "First use run_bash with exactly pnpm test tests/main/currentWorkingDirectoryTool.test.ts",
    );
    expect(validatePlanForExecution(plan)).toEqual({ valid: true });
  });

  it("flags unsafe known host-tool implementation steps", () => {
    const reason = unsafeKnownHostToolImplementationReason(
      {
        steps: [
          {
            name: "implement",
            prompt:
              "Implement get_current_working_directory in src/main/tools.ts.",
            verify:
              "src/main/tools.ts contains get_current_working_directory.",
          },
        ],
        raw: "",
        start: 0,
        end: 0,
      },
      ["get_current_working_directory"],
    );

    expect(reason).toContain(
      "Implementation step for get_current_working_directory must tell the agent to read src/main/tools.ts",
    );
  });

  it("flags known host-tool plans missing exact grounding files", () => {
    const reason = missingKnownHostToolGroundingReason(
      {
        steps: [
          {
            name: "explore",
            prompt: "List src/main and src/cli, then read agent.ts.",
            verify: "src/main and src/cli have been listed.",
          },
        ],
        raw: "List src/main and src/cli, then read agent.ts.",
        start: 0,
        end: 0,
      },
      ["get_current_working_directory"],
    );

    expect(reason).toContain(
      "Known host-tool plan for get_current_working_directory must ground on exact files",
    );
    expect(reason).toContain("src/main/tools.ts");
    expect(reason).toContain("tests/main/currentWorkingDirectoryTool.test.ts");
  });

  it("allows guarded known host-tool implementation steps", () => {
    const reason = unsafeKnownHostToolImplementationReason(
      {
        steps: [
          {
            name: "confirm_implementation",
            prompt:
              "Read src/main/tools.ts and Gemma.md, add get_current_working_directory only if missing, and avoid editing those files if get_current_working_directory is already present.",
            verify:
              "src/main/tools.ts and Gemma.md contain get_current_working_directory.",
          },
        ],
        raw: "",
        start: 0,
        end: 0,
      },
      ["get_current_working_directory"],
    );

    expect(reason).toBeNull();
  });

  it("flags known host-tool implementation steps after build verification", () => {
    const reason = unsafeKnownHostToolImplementationReason(
      {
        steps: [
          {
            name: "verify",
            prompt: "Run pnpm run build.",
            verify: "pnpm run build passes.",
          },
          {
            name: "implement",
            prompt:
              "Read src/main/tools.ts and Gemma.md, add get_current_working_directory only if missing, and avoid editing those files if get_current_working_directory is already present.",
            verify:
              "src/main/tools.ts and Gemma.md contain get_current_working_directory.",
          },
        ],
        raw: "",
        start: 0,
        end: 0,
      },
      ["get_current_working_directory"],
    );

    expect(reason).toContain(
      "Implementation step for get_current_working_directory must come before final verification",
    );
  });

  it("does not wrap an already formatted expert prompt", () => {
    const prompt = buildPlanAssemblyInitialPrompt(
      "As an expert in software development and AI-assisted coding, I need your help in instructing an AI coding agent. Our task: create a new LLM tool to retrieve the current working directory in this project. What should I start by telling the agent? in YAML only no extra explanations, just the prompt?",
    );

    expect(prompt).toBe(
      "As an expert in software development and AI-assisted coding, I need your help in instructing an AI coding agent. Our task: create a new LLM tool to retrieve the current working directory in this project. What should I start by telling the agent? in YAML only no extra explanations, just the prompt?",
    );
  });

  it("accepts one step and asks for the next prompt", () => {
    const state = createPlanAssemblyState();
    const result = applyPlanAssemblyResponse(state, exploreStep);

    expect(result.kind).toBe("accepted");
    if (result.kind !== "accepted") return;
    expect(result.state.steps).toEqual([
      {
        name: "explore",
        prompt: "List src/main/plan and read src/main/plan/parser.ts.",
        verify: "src/main/plan has been listed and parser.ts has been read.",
      },
    ]);
    expect(result.nextPrompt).toContain(PLAN_ASSEMBLY_NEXT_PROMPT);
    expect(result.nextPrompt).toContain(
      "Continue the same plan with exactly one additional YAML step.",
    );
    expect(result.nextPrompt).toContain(
      "Return plan: done only after the accepted steps visibly include grounding, test, implementation, the exact focused test command, and the exact build command.",
    );
    expect(result.nextPrompt).toContain(PLAN_ASSEMBLY_DONE_TEXT);
  });

  it("keeps known host-tool facts in the next-step prompt", () => {
    const result = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
      "create a new LLM tool to retrieve the current working directory in this project",
    );

    expect(result.kind).toBe("accepted");
    if (result.kind !== "accepted") return;
    expect(result.nextPrompt).toContain("Accepted steps so far: explore.");
    expect(result.nextPrompt).toContain("get_current_working_directory");
    expect(result.nextPrompt).toContain("tests/main/currentWorkingDirectoryTool.test.ts");
    expect(result.nextPrompt).toContain(
      "pnpm test tests/main/currentWorkingDirectoryTool.test.ts",
    );
    expect(result.nextPrompt).toContain("pnpm run build");
    expect(result.nextPrompt).toContain(
      "Next missing requirement: emit the test step for get_current_working_directory.",
    );
  });

  it("does not mistake host-tool test coverage work for implementation", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
      "create a new LLM tool to retrieve the current working directory in this project",
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const second = applyPlanAssemblyResponse(
      first.state,
      currentWorkingDirectoryTestStep,
      "create a new LLM tool to retrieve the current working directory in this project",
    );

    expect(second.kind).toBe("accepted");
    if (second.kind !== "accepted") return;
    expect(second.nextPrompt).toContain(
      "Next missing requirement: emit the implementation step for get_current_working_directory.",
    );
    expect(second.nextPrompt).not.toContain(
      "Next missing requirement: emit the verification or build step for get_current_working_directory.",
    );
  });

  it("assembles accepted steps when the model returns plan done", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const second = applyPlanAssemblyResponse(first.state, testStep);
    if (second.kind !== "accepted") throw new Error("expected second step");

    const done = applyPlanAssemblyResponse(
      second.state,
      PLAN_ASSEMBLY_DONE_TEXT,
    );

    expect(done.kind).toBe("finished");
    if (done.kind !== "finished") return;
    expect(done.plan.steps.map((step) => step.name)).toEqual([
      "explore",
      "test",
    ]);
    expect(done.plan.raw).toContain("plan:");
    expect(done.plan.raw).toContain("name: explore");
    expect(done.plan.raw).toContain("name: test");
    expect(done.plan.start).toBe(0);
    expect(done.plan.end).toBe(done.plan.raw.length);
  });

  it("assembles accepted steps when the model returns fenced YAML plan done", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const done = applyPlanAssemblyResponse(
      first.state,
      ["```yaml", PLAN_ASSEMBLY_DONE_TEXT, "```"].join("\n"),
    );

    expect(done.kind).toBe("finished");
    if (done.kind !== "finished") return;
    expect(done.plan.steps.map((step) => step.name)).toEqual(["explore"]);
  });

  it("rejects conversational done text after accepted steps", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const done = applyPlanAssemblyResponse(
      first.state,
      "That is all the agent needs.",
    );

    expect(done.kind).toBe("rejected");
    if (done.kind !== "rejected") return;
    expect(done.reason).toContain("exactly one YAML plan step");
    expect(done.retryPrompt).toContain(PLAN_ASSEMBLY_DONE_TEXT);
  });

  it("rejects multiple steps in a single response", () => {
    const response = [
      "plan:",
      "  steps:",
      "    - name: explore",
      "      prompt: Read src/main/index.ts.",
      "      verify: src/main/index.ts has been read.",
      "    - name: implement",
      "      prompt: Edit src/main/index.ts.",
      "      verify: src/main/index.ts has been edited.",
    ].join("\n");

    const result = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      response,
    );

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.reason).toContain("exactly one step");
    expect(result.retryPrompt).toContain("exactly one YAML plan");
  });

  it("rejects the done sentinel before any steps were accepted", () => {
    const result = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      PLAN_ASSEMBLY_DONE_TEXT,
    );

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.reason).toContain("at least one step");
  });

  it("rejects a non-plan response before any steps were accepted", () => {
    const result = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      "I need more context first.",
    );

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.reason).toContain("exactly one YAML plan step");
  });

  it("rejects duplicate step names", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const duplicate = applyPlanAssemblyResponse(first.state, exploreStep);

    expect(duplicate.kind).toBe("rejected");
    if (duplicate.kind !== "rejected") return;
    expect(duplicate.reason).toContain("Duplicate step name");
  });

  it("tells the model how to recover from a duplicate step name", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      implementStep,
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const duplicate = applyPlanAssemblyResponse(first.state, implementStep);

    expect(duplicate.kind).toBe("rejected");
    if (duplicate.kind !== "rejected") return;
    expect(duplicate.retryPrompt).toContain(
      "Already accepted step names: implement.",
    );
    expect(duplicate.retryPrompt).toContain(
      "The new step name must be unique and must not reuse any accepted step name.",
    );
    expect(duplicate.retryPrompt).toContain(
      'The rejected name "implement" is already used.',
    );
  });

  it("keeps known host-tool facts in rejected-step retry prompts", () => {
    const rejected = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      [
        "plan:",
        "  steps:",
        "    - name: test",
        "      prompt: Write tests/main/currentWorkingDirectoryTool.test.ts for get_current_working_directory.",
        "      verify: tests/main/currentWorkingDirectoryTool.test.ts covers get_current_working_directory.",
      ].join("\n"),
      "create a new LLM tool to retrieve the current working directory in this project",
    );

    expect(rejected.kind).toBe("rejected");
    if (rejected.kind !== "rejected") return;
    expect(rejected.retryPrompt).toContain("get_current_working_directory");
    expect(rejected.retryPrompt).toContain(
      "pnpm test tests/main/currentWorkingDirectoryTool.test.ts",
    );
    expect(rejected.retryPrompt).toContain("pnpm run build");
    expect(rejected.retryPrompt).toContain(
      "Next missing requirement: emit the test step for get_current_working_directory.",
    );
  });

  it("finalizes to null until at least one step exists", () => {
    expect(finalizePlanAssembly(createPlanAssemblyState())).toBeNull();
  });

  it("produces a final plan compatible with existing execution validation", () => {
    let result = applyPlanAssemblyResponse(createPlanAssemblyState(), exploreStep);
    if (result.kind !== "accepted") throw new Error("expected explore step");

    result = applyPlanAssemblyResponse(result.state, testStep);
    if (result.kind !== "accepted") throw new Error("expected test step");

    result = applyPlanAssemblyResponse(result.state, implementStep);
    if (result.kind !== "accepted") throw new Error("expected implement step");

    result = applyPlanAssemblyResponse(result.state, verifyStep);
    if (result.kind !== "accepted") throw new Error("expected verify step");

    const done = applyPlanAssemblyResponse(result.state, PLAN_ASSEMBLY_DONE_TEXT);
    if (done.kind !== "finished") throw new Error("expected finished plan");

    expect(validatePlanForExecution(done.plan)).toEqual({ valid: true });
  });

  it("finalizes an executable plan as soon as accepted fragments validate", () => {
    let result = applyPlanAssemblyResponse(createPlanAssemblyState(), exploreStep);
    if (result.kind !== "accepted") throw new Error("expected explore step");
    expect(finalizeExecutablePlanAssembly(result.state)).toBeNull();

    result = applyPlanAssemblyResponse(result.state, testStep);
    if (result.kind !== "accepted") throw new Error("expected test step");
    expect(finalizeExecutablePlanAssembly(result.state)).toBeNull();

    result = applyPlanAssemblyResponse(result.state, implementStep);
    if (result.kind !== "accepted") throw new Error("expected implement step");
    expect(finalizeExecutablePlanAssembly(result.state)).toBeNull();

    result = applyPlanAssemblyResponse(result.state, verifyStep);
    if (result.kind !== "accepted") throw new Error("expected verify step");

    const executablePlan = finalizeExecutablePlanAssembly(result.state);
    expect(executablePlan?.steps.map((step) => step.name)).toEqual([
      "explore",
      "test",
      "implement",
      "verify",
    ]);
  });

  it("rejects placeholder wording before it can be saved", () => {
    const placeholderStep = [
      "plan:",
      "  steps:",
      "    - name: test",
      "      prompt: Run relevant tests.",
      "      verify: The relevant tests pass.",
    ].join("\n");

    const result = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      placeholderStep,
    );

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.reason).toContain("placeholder");
  });
});
