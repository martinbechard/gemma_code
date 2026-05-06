import { describe, it, expect } from "vitest";
import { stripPlanArtifacts } from "../../../src/main/plan/stripPlanArtifacts";

describe("stripPlanArtifacts", () => {
  it("returns text unchanged when no plan YAML or verify tags are present", () => {
    expect(stripPlanArtifacts("hello world")).toBe("hello world");
    expect(stripPlanArtifacts("")).toBe("");
  });

  it("removes a YAML plan block", () => {
    const input = [
      "intro",
      "plan:",
      "  steps:",
      "    - name: a",
      "      prompt: do x",
      "      verify: x is done",
    ].join("\n");
    expect(stripPlanArtifacts(input)).toBe("intro");
  });

  it("removes a response that is only a YAML plan", () => {
    const input = [
      "plan:",
      "  steps:",
      "    - name: a",
      "      prompt: p",
      "      verify: v",
    ].join("\n");
    expect(stripPlanArtifacts(input)).toBe("");
  });

  it("removes self-closing <verify .../> tags", () => {
    const input = 'before <verify result="pass"/> after';
    expect(stripPlanArtifacts(input)).toBe("before  after");
  });

  it("removes paired <verify>...</verify> tags outside a plan", () => {
    const input = 'pre <verify result="fail">bad</verify> post';
    expect(stripPlanArtifacts(input)).toBe("pre  post");
  });

  it("leaves malformed plan YAML in place", () => {
    const input = "narrative\nplan:\n  steps:\n    - name:";
    expect(stripPlanArtifacts(input)).toBe(input);
  });
});
