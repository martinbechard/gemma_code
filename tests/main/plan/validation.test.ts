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

  it("rejects report-only final-answer steps", () => {
    const result = validatePlanForExecution(
      parsedPlan([
        {
          name: "read_package_json",
          prompt: "Read package.json.",
          verify: "package.json has been read.",
        },
        {
          name: "report_package_name",
          prompt:
            "Report the package name found in the previous step output.",
          verify: "The final output of the plan is the package name.",
        },
      ]),
    );

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("report_package_name");
    expect(result.reason).toContain("report-only");
  });

  it("rejects extraction steps that only reuse previous results", () => {
    const result = validatePlanStepText({
      name: "extract_package_name",
      prompt:
        "Extract the package name from the result of reading package.json and confirm it is the final output.",
      verify: "The final package name has been extracted and confirmed.",
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("extract_package_name");
    expect(result.reason).toContain("report-only");
  });

  it("accepts executable steps that report from their own evidence", () => {
    const result = validatePlanForExecution(
      parsedPlan([
        {
          name: "read_package_json",
          prompt:
            "Read package.json and report only the package name in the step summary.",
          verify: "package.json has been read.",
        },
      ]),
    );

    expect(result).toEqual({ valid: true });
  });

  it("accepts extraction wording when the step names a real action", () => {
    const result = validatePlanStepText({
      name: "extract_helper",
      prompt:
        "Extract the package-name parsing helper by editing src/cli/agent.ts.",
      verify: "src/cli/agent.ts contains the extracted helper.",
    });

    expect(result).toEqual({ valid: true });
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
