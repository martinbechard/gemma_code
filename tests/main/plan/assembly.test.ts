import { describe, expect, it } from "vitest";
import {
  PLAN_ASSEMBLY_DONE_TEXT,
  PLAN_ASSEMBLY_NEXT_PROMPT,
  PLAN_SEMANTIC_REVIEW_PASS_TEXT,
  PLAN_SEMANTIC_REVIEW_SYSTEM_PROMPT,
  applyPlanAssemblyResponse,
  applyPlanSemanticReviewResponse,
  buildPlanAssemblyInitialPrompt,
  buildPlanSemanticReviewMessages,
  buildPlanSemanticReviewPrompt,
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
  "      verify: src/main/plan has been listed and src/main/plan/parser.ts has been read.",
].join("\n");

const testStep = [
  "plan:",
  "  steps:",
  "    - name: test",
  "      prompt: Update tests/main/plan/assembly.test.ts, then run npm test tests/main/plan/assembly.test.ts.",
  "      verify: npm test tests/main/plan/assembly.test.ts has been run.",
].join("\n");

const correctedPlan = [
  "plan:",
  "  steps:",
  "    - name: inspect_renderer",
  "      prompt: Read src/renderer/src/components/Composer.tsx.",
  "      verify: src/renderer/src/components/Composer.tsx has been read.",
  "    - name: test_renderer",
  "      prompt: Update tests/renderer/components/Message.test.ts and run npm test tests/renderer/components/Message.test.ts.",
  "      verify: npm test tests/renderer/components/Message.test.ts passes.",
].join("\n");

describe("iterative plan assembly", () => {
  it("builds the initial planning prompt around only the user request", () => {
    const prompt = buildPlanAssemblyInitialPrompt(
      "add keyboard shortcuts to the composer",
    );

    expect(prompt).toContain(
      "Our task is to create clear, executable instructions for an AI coding agent.",
    );
    expect(prompt).toContain(
      "<UserRequest>add keyboard shortcuts to the composer.</UserRequest>",
    );
    expect(prompt).not.toMatch(/\bhost\b/i);
    expect(prompt).not.toContain("tests/main");
    expect(prompt).not.toContain("get_current");
    expect(prompt).not.toContain("pnpm run build");
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
        verify:
          "src/main/plan has been listed and src/main/plan/parser.ts has been read.",
      },
    ]);
    expect(result.nextPrompt).toContain(PLAN_ASSEMBLY_NEXT_PROMPT);
    expect(result.nextPrompt).not.toMatch(/\bhost\b/i);
    expect(result.nextPrompt).not.toContain("tests/main");
    expect(result.nextPrompt).not.toContain("get_current");
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

  it("rejects multiple steps in a single assembly response", () => {
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

  it("rejects malformed extra YAML steps instead of ignoring them", () => {
    const response = [
      "plan:",
      "  steps:",
      "    - name: explore",
      "      prompt: Read src/main/index.ts.",
      "      verify: src/main/index.ts has been read.",
      "    - name: malformed",
      "      prompt: Missing verify should not be ignored.",
    ].join("\n");

    const result = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      response,
    );

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.reason).toContain("must have name, prompt, and verify");
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
    expect(duplicate.retryPrompt).toContain(
      "Already accepted step names: explore.",
    );
  });

  it("finalizes an executable plan using only deterministic validation", () => {
    let result = applyPlanAssemblyResponse(createPlanAssemblyState(), exploreStep);
    if (result.kind !== "accepted") throw new Error("expected explore step");

    result = applyPlanAssemblyResponse(result.state, testStep);
    if (result.kind !== "accepted") throw new Error("expected test step");

    const plan = finalizeExecutablePlanAssembly(result.state);

    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(validatePlanForExecution(plan)).toEqual({ valid: true });
  });
});

describe("semantic plan review", () => {
  it("asks the model to review task fit without injecting fixed files or commands", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const plan = finalizePlanAssembly(first.state);
    if (!plan) throw new Error("expected plan");

    const prompt = buildPlanSemanticReviewPrompt(
      plan,
      "add keyboard shortcuts to the composer",
    );

    expect(prompt).toContain("Validate the assembled plan");
    expect(prompt).toContain(
      "<OriginalRequest>\nadd keyboard shortcuts to the composer\n</OriginalRequest>",
    );
    expect(prompt).toContain("<AssembledPlan>");
    expect(prompt).toContain("name: explore");
    expect(prompt).toContain("</AssembledPlan>");
    expect(prompt).toContain(PLAN_SEMANTIC_REVIEW_PASS_TEXT);
    expect(prompt).not.toMatch(/\bhost\b/i);
    expect(prompt).not.toContain("tests/main");
    expect(prompt).not.toContain("get_current");
  });

  it("builds semantic review messages with a fresh validation system prompt", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const plan = finalizePlanAssembly(first.state);
    if (!plan) throw new Error("expected plan");

    const messages = buildPlanSemanticReviewMessages(
      plan,
      "add keyboard shortcuts to the composer",
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: "system",
      content: PLAN_SEMANTIC_REVIEW_SYSTEM_PROMPT,
    });
    expect(messages[0].content).toContain("fresh review context");
    expect(messages[0].content).toContain("Do not continue plan construction");
    expect(messages[0].content).toContain("do not return plan: done");
    expect(messages[0].content).toContain(PLAN_SEMANTIC_REVIEW_PASS_TEXT);
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("<OriginalRequest>");
    expect(messages[1].content).toContain("add keyboard shortcuts to the composer");
    expect(messages[1].content).toContain("<AssembledPlan>");
    expect(messages[1].content).toContain("name: explore");
  });

  it("accepts a semantic review pass response", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const plan = finalizePlanAssembly(first.state);
    if (!plan) throw new Error("expected plan");

    const result = applyPlanSemanticReviewResponse(
      plan,
      PLAN_SEMANTIC_REVIEW_PASS_TEXT,
    );

    expect(result.kind).toBe("accepted");
    if (result.kind !== "accepted") return;
    expect(result.plan).toEqual(plan);
  });

  it("accepts a complete corrected plan from semantic review", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const plan = finalizePlanAssembly(first.state);
    if (!plan) throw new Error("expected plan");

    const result = applyPlanSemanticReviewResponse(plan, correctedPlan);

    expect(result.kind).toBe("corrected");
    if (result.kind !== "corrected") return;
    expect(result.plan.steps.map((step) => step.name)).toEqual([
      "inspect_renderer",
      "test_renderer",
    ]);
  });

  it("rejects semantic review corrections that fail deterministic validation", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const plan = finalizePlanAssembly(first.state);
    if (!plan) throw new Error("expected plan");

    const result = applyPlanSemanticReviewResponse(
      plan,
      [
        "plan:",
        "  steps:",
        "    - name: test",
        "      prompt: Run relevant tests.",
        "      verify: The relevant tests pass.",
      ].join("\n"),
    );

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.reason).toContain("placeholder");
  });

  it("rejects semantic review corrections with malformed step fields", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const plan = finalizePlanAssembly(first.state);
    if (!plan) throw new Error("expected plan");

    const result = applyPlanSemanticReviewResponse(
      plan,
      [
        "plan:",
        "  steps:",
        "    - name: inspect",
        "      prompt: Read src/main/index.ts.",
        "      verify: src/main/index.ts has been read.",
        "    - name: malformed",
        "      prompt: Missing verify should not be ignored.",
      ].join("\n"),
    );

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.reason).toContain("must have name, prompt, and verify");
  });
});
