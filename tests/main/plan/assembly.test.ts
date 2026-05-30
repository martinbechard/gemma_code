import { describe, expect, it } from "vitest";
import {
  PLAN_ASSEMBLY_DONE_TEXT,
  PLAN_ASSEMBLY_NEXT_PROMPT,
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

const passingReview = [
  "review:",
  "  verdict: pass",
  "  summary: The plan has enough concrete steps for the request.",
  "  checklist:",
  "    - id: request_fit",
  "      question: Does the plan directly address the original request?",
  "      answer: yes",
  "      additional_info: The accepted steps inspect and test the plan assembly flow.",
  "    - id: grounding",
  "      question: Does the plan include enough project grounding before edits?",
  "      answer: yes",
  "      additional_info: The first step reads src/main/plan/parser.ts before changes.",
  "    - id: specificity",
  "      question: Are files, commands, artifacts, and verification evidence task-specific?",
  "      answer: yes",
  "      additional_info: The steps name src/main/plan/parser.ts and the focused assembly test command.",
  "    - id: placeholder_present",
  "      question: Does the plan contain placeholder wording or made-up examples?",
  "      answer: false",
  "      additional_info: No placeholder terms are present in the accepted steps.",
  "    - id: verification",
  "      question: Does the plan include appropriate verification for the request?",
  "      answer: yes",
  "      additional_info: The plan includes npm test tests/main/plan/assembly.test.ts.",
  "    - id: residual_risk",
  "      question: What residual risk remains if this plan is executed?",
  "      answer: low",
  "      additional_info: The change is scoped to plan assembly tests and parser inspection.",
].join("\n");

const compactPassingReview = [
  "review:",
  "  verdict: pass",
  "  summary: Plan covers inspection and verification.",
  "  checklist:",
  "    - id: request_fit",
  "      answer: yes",
  "      additional_info: Targets the requested flow.",
  "    - id: grounding",
  "      answer: yes",
  "      additional_info: Reads relevant files first.",
  "    - id: specificity",
  "      answer: yes",
  "      additional_info: Names files and commands.",
  "    - id: placeholder_present",
  "      answer: false",
  "      additional_info: No placeholders found.",
  "    - id: verification",
  "      answer: yes",
  "      additional_info: Includes focused test command.",
  "    - id: residual_risk",
  "      answer: low",
  "      additional_info: Scope is narrow.",
].join("\n");

const correctionReview = [
  "review:",
  "  verdict: needs_correction",
  "  summary: The plan must target the renderer shortcut request instead.",
  "  checklist:",
  "    - id: request_fit",
  "      question: Does the plan directly address the original request?",
  "      answer: no",
  "      additional_info: The accepted plan inspects plan assembly instead of renderer shortcuts.",
  "    - id: grounding",
  "      question: Does the plan include enough project grounding before edits?",
  "      answer: no",
  "      additional_info: It reads a project file but not the renderer composer.",
  "    - id: specificity",
  "      question: Are files, commands, artifacts, and verification evidence task-specific?",
  "      answer: partial",
  "      additional_info: The test command is exact but targets the wrong subsystem.",
  "    - id: placeholder_present",
  "      question: Does the plan contain placeholder wording or made-up examples?",
  "      answer: false",
  "      additional_info: The issue is task fit, not placeholder wording.",
  "    - id: verification",
  "      question: Does the plan include appropriate verification for the request?",
  "      answer: no",
  "      additional_info: It does not test the renderer shortcut behavior.",
  "    - id: residual_risk",
  "      question: What residual risk remains if this plan is executed?",
  "      answer: medium",
  "      additional_info: Executing the wrong subsystem plan would not satisfy the user request.",
  correctedPlan,
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
    expect(prompt).toContain(
      "Resolve the files and artifacts to change during planning",
    );
    expect(prompt).toContain(
      "do not add later execution steps whose only purpose is to locate, determine, or identify where changes should happen",
    );
    expect(prompt).toContain(
      "Mutation steps must name the exact files or artifacts they will change, create, or delete.",
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
    expect(result.nextPrompt).toContain(
      "Do not add a step whose only purpose is to locate, determine, or identify where changes should happen",
    );
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

  it("rejects report-only final-answer steps during assembly", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      [
        "plan:",
        "  steps:",
        "    - name: read_package_json",
        "      prompt: Read package.json.",
        "      verify: package.json has been read.",
      ].join("\n"),
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const reportOnly = applyPlanAssemblyResponse(
      first.state,
      [
        "plan:",
        "  steps:",
        "    - name: report_package_name",
        "      prompt: Report the package name found in the previous step output.",
        "      verify: The final output of the plan is the package name.",
      ].join("\n"),
    );

    expect(reportOnly.kind).toBe("rejected");
    if (reportOnly.kind !== "rejected") return;
    expect(reportOnly.state.steps.map((step) => step.name)).toEqual([
      "read_package_json",
    ]);
    expect(reportOnly.reason).toContain("report-only");
    expect(reportOnly.retryPrompt).toContain("report-only");
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
    expect(prompt).toContain("verdict: pass | needs_correction");
    expect(prompt).toContain("answer: true | false");
    expect(prompt).toContain("additional_info");
    expect(prompt).toContain("Do not include question fields");
    expect(prompt).toContain("top-level plan key named plan");
    expect(prompt).toContain("Do not use corrected_plan");
    expect(prompt).not.toContain("      question:");
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
    expect(messages[0].content).toContain("structured review checklist");
    expect(messages[0].content).toContain("old review: pass shorthand");
    expect(messages[0].content).toContain("top-level key named plan");
    expect(messages[0].content).toContain("Do not use corrected_plan");
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
      passingReview,
    );

    expect(result.kind).toBe("accepted");
    if (result.kind !== "accepted") return;
    expect(result.plan).toEqual(plan);
    expect(result.review.verdict).toBe("pass");
    expect(result.review.checklist.map((item) => item.id)).toEqual([
      "request_fit",
      "grounding",
      "specificity",
      "placeholder_present",
      "verification",
      "residual_risk",
    ]);
    expect(result.review.checklist[3].answer).toBe("false");
  });

  it("accepts compact semantic review checklist items without question fields", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const plan = finalizePlanAssembly(first.state);
    if (!plan) throw new Error("expected plan");

    const result = applyPlanSemanticReviewResponse(plan, compactPassingReview);

    expect(result.kind).toBe("accepted");
    if (result.kind !== "accepted") return;
    expect(result.review.verdict).toBe("pass");
    expect(result.review.checklist[0]).toMatchObject({
      id: "request_fit",
      question: "Does the plan directly address the original request?",
      answer: "yes",
      additionalInfo: "Targets the requested flow.",
    });
  });

  it("accepts semantic review free-text fields containing colons", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const plan = finalizePlanAssembly(first.state);
    if (!plan) throw new Error("expected plan");

    const colonReview = compactPassingReview.replace(
      "additional_info: Names files and commands.",
      "additional_info: The steps are concrete: read the file, then report the name found.",
    );

    const result = applyPlanSemanticReviewResponse(plan, colonReview);

    expect(result.kind).toBe("accepted");
    if (result.kind !== "accepted") return;
    expect(result.review.checklist[2].additionalInfo).toBe(
      "The steps are concrete: read the file, then report the name found.",
    );
  });

  it("accepts fenced semantic review YAML with colons in free-text fields", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const plan = finalizePlanAssembly(first.state);
    if (!plan) throw new Error("expected plan");

    const fencedReview = [
      "```yaml",
      compactPassingReview.replace(
        "additional_info: Names files and commands.",
        "additional_info: The steps are concrete: read the file, then report the name found.",
      ),
      "```",
    ].join("\n");

    const result = applyPlanSemanticReviewResponse(plan, fencedReview);

    expect(result.kind).toBe("accepted");
    if (result.kind !== "accepted") return;
    expect(result.review.checklist[2].additionalInfo).toBe(
      "The steps are concrete: read the file, then report the name found.",
    );
  });

  it("accepts a complete corrected plan from semantic review", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const plan = finalizePlanAssembly(first.state);
    if (!plan) throw new Error("expected plan");

    const result = applyPlanSemanticReviewResponse(plan, correctionReview);

    expect(result.kind).toBe("corrected");
    if (result.kind !== "corrected") return;
    expect(result.review.verdict).toBe("needs_correction");
    expect(result.plan.steps.map((step) => step.name)).toEqual([
      "inspect_renderer",
      "test_renderer",
    ]);
  });

  it("accepts corrected_plan nested under review as a corrected plan alias", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const plan = finalizePlanAssembly(first.state);
    if (!plan) throw new Error("expected plan");

    const nestedCorrection = [
      passingReview.replace("verdict: pass", "verdict: needs_correction"),
      "  corrected_plan:",
      "    plan:",
      "      steps:",
      "        - name: inspect_renderer",
      "          prompt: Read src/renderer/src/components/Composer.tsx.",
      "          verify: src/renderer/src/components/Composer.tsx has been read.",
      "        - name: test_renderer",
      "          prompt: Update tests/renderer/components/Message.test.ts and run npm test tests/renderer/components/Message.test.ts.",
      "          verify: npm test tests/renderer/components/Message.test.ts passes.",
    ].join("\n");

    const result = applyPlanSemanticReviewResponse(plan, nestedCorrection);

    expect(result.kind).toBe("corrected");
    if (result.kind !== "corrected") return;
    expect(result.plan.steps.map((step) => step.name)).toEqual([
      "inspect_renderer",
      "test_renderer",
    ]);
    expect(result.plan.raw).toContain("plan:");
    expect(result.plan.raw).not.toContain("corrected_plan");
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
        correctionReview.split("\nplan:")[0],
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
        correctionReview.split("\nplan:")[0],
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

  it("rejects semantic review responses without the structured checklist", () => {
    const first = applyPlanAssemblyResponse(
      createPlanAssemblyState(),
      exploreStep,
    );
    if (first.kind !== "accepted") throw new Error("expected first step");

    const plan = finalizePlanAssembly(first.state);
    if (!plan) throw new Error("expected plan");

    const result = applyPlanSemanticReviewResponse(
      plan,
      "review: pass",
    );

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.reason).toContain("review object");
    expect(result.retryPrompt).toContain("Start over from the top");
    expect(result.retryPrompt).toContain("only id, answer, and additional_info");
  });
});
