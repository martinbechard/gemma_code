import { describe, expect, it } from "vitest";
import { buildPlanReviewPrompt } from "../../../src/main/plan/reviewPrompt";

describe("buildPlanReviewPrompt", () => {
  it("asks the model to justify, check requirements, and amend the plan", () => {
    const candidate = "plan:\n  steps:\n    - name: candidate";
    const prompt = buildPlanReviewPrompt(candidate);

    expect(prompt).toContain("Explain why you chose this plan");
    expect(prompt).toContain("meets all of the user's requirements");
    expect(prompt).toContain("emit an amended complete YAML plan");
    expect(prompt).toContain(candidate);
  });

  it("requires a complete final plan even when the candidate is acceptable", () => {
    const prompt = buildPlanReviewPrompt("plan:\n  steps:\n    - name: candidate");

    expect(prompt).toContain("repeat the complete final YAML plan");
  });

  it("rejects placeholder plans and asks for concrete files and commands", () => {
    const prompt = buildPlanReviewPrompt("plan:\n  steps:\n    - name: candidate");

    expect(prompt).toContain("Reject placeholder wording");
    expect(prompt).toContain("exact source files");
    expect(prompt).toContain("exact commands");
  });
});
