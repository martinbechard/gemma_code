import { describe, expect, it } from "vitest";
import { validatePlanForExecution } from "../../../src/main/plan/validation";
import type { ParsedPlan } from "../../../src/main/plan/parser";

const parsedPlan = (
  steps: Array<{ name: string; prompt: string; verify: string }>,
): ParsedPlan => ({
  steps,
  raw: "",
  start: 0,
  end: 0,
});

describe("validatePlanForExecution", () => {
  it("rejects plans with no executable steps", () => {
    const result = validatePlanForExecution(parsedPlan([]));

    expect(result).toEqual({
      valid: false,
      reason: "Plan has no executable steps.",
    });
  });

  it("rejects placeholder wording copied from the sample plan", () => {
    const result = validatePlanForExecution(
      parsedPlan([
        {
          name: "ground",
          prompt: "Read src/main/tools.ts and the relevant tests.",
          verify: "The relevant tests have been read.",
        },
      ]),
    );

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("ground");
    expect(result.reason).toContain("relevant tests");
  });

  it("rejects plans that do not cover the full feature workflow", () => {
    const result = validatePlanForExecution(
      parsedPlan([
        {
          name: "ground",
          prompt: "Read src/main/tools.ts and tests/main/projectScriptTool.test.ts.",
          verify: "The named files have been read.",
        },
      ]),
    );

    expect(result).toEqual({
      valid: false,
      reason:
        "Plan must include grounding, test, implementation, and verification steps.",
    });
  });

  it("accepts concrete source, test, and verification steps", () => {
    const result = validatePlanForExecution(
      parsedPlan([
        {
          name: "ground",
          prompt:
            "Read src/main/tools.ts, Gemma.md, and tests/main/projectScriptTool.test.ts.",
          verify:
            "The tool registry, prompt file, and tests/main/projectScriptTool.test.ts have been read.",
        },
        {
          name: "test",
          prompt:
            "Update tests/main/projectScriptTool.test.ts to cover get_current_datetime and run pnpm test tests/main/projectScriptTool.test.ts.",
          verify:
            "pnpm test tests/main/projectScriptTool.test.ts fails because get_current_datetime is missing.",
        },
        {
          name: "implement",
          prompt: "Edit src/main/tools.ts and Gemma.md to add get_current_datetime.",
          verify:
            "src/main/tools.ts and Gemma.md contain the get_current_datetime tool.",
        },
        {
          name: "verify",
          prompt:
            "Run pnpm test tests/main/projectScriptTool.test.ts, pnpm test, and pnpm run build.",
          verify: "All three commands pass.",
        },
      ]),
    );

    expect(result).toEqual({ valid: true });
  });
});
