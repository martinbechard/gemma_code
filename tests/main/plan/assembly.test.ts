import { describe, expect, it } from "vitest";
import {
  PLAN_ASSEMBLY_DONE_TEXT,
  PLAN_ASSEMBLY_NEXT_PROMPT,
  applyPlanAssemblyResponse,
  buildPlanAssemblyInitialPrompt,
  createPlanAssemblyState,
  finalizeExecutablePlanAssembly,
  finalizePlanAssembly,
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

describe("iterative plan assembly", () => {
  it("builds the initial expert prompt around the user's task", () => {
    const prompt = buildPlanAssemblyInitialPrompt(
      "create a new LLM tool to retrieve the current working directory",
    );

    expect(prompt).toBe(
      "As an expert in software development and AI-assisted coding, I need your help in instructing an AI coding agent. Our task: create a new LLM tool to retrieve the current working directory. What should I start by telling the agent? in YAML only no extra explanations, just the prompt?",
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
    expect(result.nextPrompt).toBe(PLAN_ASSEMBLY_NEXT_PROMPT);
    expect(result.nextPrompt).toBe(
      "What should I tell the agent next? If the plan is complete, reply exactly with plan: done. YAML only, no extra explanations.",
    );
    expect(result.nextPrompt).toContain(PLAN_ASSEMBLY_DONE_TEXT);
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
