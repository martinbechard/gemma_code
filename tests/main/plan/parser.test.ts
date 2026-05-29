import { describe, expect, it } from "vitest";
import {
  containsCompletePlan,
  findNextPlan,
  parsedPlanFromSteps,
} from "../../../src/main/plan/parser";

const yamlPlan = [
  "plan:",
  "  steps:",
  "    - name: explore",
  "      prompt: List files in src/cli",
  "      verify: The file list contains agent.ts",
].join("\n");

describe("findNextPlan - null / incomplete", () => {
  it("returns null when there is no YAML plan", () => {
    expect(findNextPlan("just some prose, no plan here")).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(findNextPlan("")).toBeNull();
  });

  it("returns incomplete when a plan key is present but YAML is not parseable yet", () => {
    expect(findNextPlan("plan:\n  steps:\n    - name: explore\n      prompt: [")).toBe(
      "incomplete",
    );
  });
});

describe("findNextPlan - YAML plans", () => {
  it("parses a single step with name, prompt, verify", () => {
    const text = `Here is the plan:\n${yamlPlan}`;
    const r = findNextPlan(text);
    expect(r).not.toBeNull();
    expect(r).not.toBe("incomplete");
    if (r === null || r === "incomplete") return;
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toEqual({
      name: "explore",
      prompt: "List files in src/cli",
      verify: "The file list contains agent.ts",
    });
    expect(text.slice(r.start, r.end)).toBe(yamlPlan);
  });

  it("parses multiple steps in order", () => {
    const text = [
      "plan:",
      "  steps:",
      "    - name: ground",
      "      prompt: Read src/main/tools.ts.",
      "      verify: src/main/tools.ts has been read.",
      "    - name: test",
      "      prompt: Run pnpm test tests/main/projectScriptTool.test.ts.",
      "      verify: The focused test command ran.",
      "    - name: implement",
      "      prompt: Edit src/main/tools.ts.",
      "      verify: src/main/tools.ts has been updated.",
    ].join("\n");
    const r = findNextPlan(text);
    if (r === null || r === "incomplete") throw new Error("expected plan");
    expect(r.steps.map((s) => s.name)).toEqual([
      "ground",
      "test",
      "implement",
    ]);
    expect(r.steps[2].prompt).toBe("Edit src/main/tools.ts.");
  });

  it("accepts block scalar prompt and verify fields", () => {
    const text = [
      "plan:",
      "  steps:",
      "    - name: verify",
      "      prompt: |",
      "        Run pnpm test tests/main/projectScriptTool.test.ts.",
      "        Then run pnpm run build.",
      "      verify: |",
      "        The focused test and build commands pass.",
    ].join("\n");
    const r = findNextPlan(text);
    if (r === null || r === "incomplete") throw new Error("expected plan");
    expect(r.steps[0].prompt).toBe(
      "Run pnpm test tests/main/projectScriptTool.test.ts.\nThen run pnpm run build.\n",
    );
    expect(r.steps[0].verify).toBe(
      "The focused test and build commands pass.\n",
    );
  });

  it("returns a plan with empty steps when the YAML shape is not executable", () => {
    const r = findNextPlan("plan:\n  steps:\n    - prompt: Missing name");
    if (r === null || r === "incomplete") throw new Error("expected plan");
    expect(r.steps).toEqual([]);
  });
});

describe("findNextPlan - from offset", () => {
  it("respects the from index and finds the second YAML plan", () => {
    const firstPlan = yamlPlan;
    const secondPlan = [
      "plan:",
      "  steps:",
      "    - name: second",
      "      prompt: Read Gemma.md.",
      "      verify: Gemma.md has been read.",
    ].join("\n");
    const text = `${firstPlan}\n\n${secondPlan}`;
    const first = findNextPlan(text);
    if (first === null || first === "incomplete") throw new Error("expected plan");
    const second = findNextPlan(text, first.end);
    if (second === null || second === "incomplete") throw new Error("expected plan");
    expect(second.steps[0].name).toBe("second");
  });
});

describe("containsCompletePlan", () => {
  it("returns true when a message contains a complete YAML plan", () => {
    expect(containsCompletePlan(yamlPlan)).toBe(true);
  });

  it("returns false when there is no complete YAML plan", () => {
    expect(containsCompletePlan("plain response")).toBe(false);
    expect(containsCompletePlan("plan:\n  steps:\n    - name:")).toBe(false);
  });
});

describe("parsedPlanFromSteps", () => {
  it("builds a parsed plan from proposed UI steps", () => {
    const plan = parsedPlanFromSteps([
      {
        name: "remove_tool",
        prompt: "Read src/main/tools.ts and remove the CWD tool.",
        verify: "src/main/tools.ts no longer contains the CWD tool.",
      },
    ]);

    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.steps).toEqual([
      {
        name: "remove_tool",
        prompt: "Read src/main/tools.ts and remove the CWD tool.",
        verify: "src/main/tools.ts no longer contains the CWD tool.",
      },
    ]);
    expect(findNextPlan(plan.raw)).toMatchObject({
      steps: plan.steps,
    });
  });
});
