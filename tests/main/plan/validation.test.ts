import { describe, expect, it } from "vitest";
import {
  validatePlanForExecution,
  validatePlanStepText,
} from "../../../src/main/plan/validation";
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
  it("rejects placeholder wording in a single step", () => {
    const result = validatePlanStepText({
      name: "test",
      prompt: "Run relevant tests.",
      verify: "The relevant tests pass.",
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("test");
    expect(result.reason).toContain("relevant tests");
  });

  it("rejects plans with no executable steps", () => {
    const result = validatePlanForExecution(parsedPlan([]));

    expect(result).toEqual({
      valid: false,
      reason: "Plan has no executable steps.",
    });
  });

  it("rejects duplicate step names", () => {
    const result = validatePlanForExecution(
      parsedPlan([
        {
          name: "ground",
          prompt: "Read package.json.",
          verify: "package.json has been read.",
        },
        {
          name: "ground",
          prompt: "Read README.md.",
          verify: "README.md has been read.",
        },
      ]),
    );

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("Duplicate step name");
  });

  it("rejects empty step fields", () => {
    const result = validatePlanForExecution(
      parsedPlan([
        {
          name: "ground",
          prompt: "   ",
          verify: "package.json has been read.",
        },
      ]),
    );

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("prompt");
  });

  it("accepts concrete plans that use project-specific paths outside tests/main", () => {
    const result = validatePlanForExecution(
      parsedPlan([
        {
          name: "ground_extension",
          prompt:
            "Read src/renderer/src/components/Composer.tsx and tests/renderer/components/Message.test.ts.",
          verify:
            "src/renderer/src/components/Composer.tsx and tests/renderer/components/Message.test.ts have been read.",
        },
        {
          name: "cover_extension",
          prompt:
            "Update tests/renderer/components/Message.test.ts to cover composer-visible message rendering, then run npm test tests/renderer/components/Message.test.ts.",
          verify:
            "npm test tests/renderer/components/Message.test.ts passes for composer-visible message rendering.",
        },
        {
          name: "implement_extension",
          prompt:
            "Edit src/renderer/src/components/Composer.tsx to render the message state selected by the test.",
          verify:
            "src/renderer/src/components/Composer.tsx renders the message state selected by the test.",
        },
        {
          name: "verify_extension",
          prompt:
            "Run npm test tests/renderer/components/Message.test.ts and npm run typecheck:web.",
          verify:
            "npm test tests/renderer/components/Message.test.ts and npm run typecheck:web pass.",
        },
      ]),
    );

    expect(result).toEqual({ valid: true });
  });

  it("does not require a fixed four step workflow", () => {
    const result = validatePlanForExecution(
      parsedPlan([
        {
          name: "document_decision",
          prompt:
            "Create design/general-purpose-plan-harness.md describing deterministic syntax validation and model semantic review.",
          verify:
            "design/general-purpose-plan-harness.md describes deterministic syntax validation and model semantic review.",
        },
      ]),
    );

    expect(result).toEqual({ valid: true });
  });
});
