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

  it("rejects target discovery passed to the execution agent", () => {
    const result = validatePlanStepText({
      name: "identify_cwd_tool",
      prompt:
        "Search through the codebase to find the file or module that implements getting the current working directory.",
      verify:
        "The file path or module name containing the current working directory retrieval logic is identified.",
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("search through the codebase");
  });

  it("rejects scoped search instructions that still defer locating files", () => {
    const result = validatePlanStepText({
      name: "identify_cwd_module",
      prompt:
        "Search in `src/main/tools/` for the file that handles retrieving the current working directory.",
      verify:
        "The file `src/main/tools/getCurrentWorkingDirectory.ts` is confirmed to exist and be related to the functionality.",
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("find the file or module");
  });

  it("rejects inspection steps that only identify and locate already known files", () => {
    const result = validatePlanStepText({
      name:
        "Identify and locate the code responsible for getting the current working directory.",
      prompt:
        "Examine src/main/tools/getCurrentWorkingDirectory.ts and src/main/tools/index.ts to confirm which module handles the functionality.",
      verify:
        "The file paths and module structure clearly indicate the purpose of getCurrentWorkingDirectory.ts.",
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("identify and locate");
  });

  it("rejects confirmation-only target steps after planning discovery", () => {
    const result = validatePlanStepText({
      name: "Confirm the module to be removed.",
      prompt:
        "Based on the search result, the module is in src/main/tools/getCurrentWorkingDirectory.ts. Confirm this file is the correct target for removal.",
      verify:
        "The file src/main/tools/getCurrentWorkingDirectory.ts is confirmed as the module to be removed.",
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("confirm target");
  });

  it("rejects vague related-code removal steps", () => {
    const result = validatePlanStepText({
      name: "remove_related_cwd_code",
      prompt:
        "Remove the code related to the get current working directory tool from the application.",
      verify:
        "The code paths related to current working directory retrieval are removed or neutralized.",
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("related code");
  });

  it("rejects partial removal instructions that start from one file without naming the full mutation set", () => {
    const result = validatePlanStepText({
      name: "remove_unused_functionality",
      prompt:
        "Remove all references to the current working directory retrieval in the application code, starting with deleting or disabling src/main/tools/getCurrentWorkingDirectory.ts.",
      verify:
        "src/main/tools/getCurrentWorkingDirectory.ts is removed or commented out in a non-functional state.",
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("disable");
  });

  it("rejects removal plans that allow commenting out obsolete code", () => {
    const result = validatePlanStepText({
      name: "remove_cwd_tool",
      prompt:
        "Delete or comment out src/main/tools/getCurrentWorkingDirectory.ts and remove its usage from src/main/tools/index.ts.",
      verify:
        "src/main/tools/getCurrentWorkingDirectory.ts is deleted or commented out.",
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("commented out");
  });

  it("rejects removal plans that empty files instead of deleting obsolete modules", () => {
    const result = validatePlanStepText({
      name: "remove_cwd_tool",
      prompt:
        "Remove src/main/tools/getCurrentWorkingDirectory.ts by emptying the file and update src/main/tools/index.ts.",
      verify:
        "src/main/tools/getCurrentWorkingDirectory.ts is deleted or emptied of its functionality.",
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("empty the file");
  });

  it("rejects removal plans that allow disabling instead of deleting references", () => {
    const result = validatePlanStepText({
      name: "remove_cwd_tool",
      prompt:
        "Remove or disable the functionality exposed in src/main/tools/getCurrentWorkingDirectory.ts and src/main/tools/index.ts.",
      verify:
        "The current working directory functionality is removed or commented out in a non-functional state.",
    });

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("disable");
  });

  it("rejects tool module removal plans that omit the tools registry", () => {
    const result = validatePlanForExecution(
      parsedPlan([
        {
          name: "remove_cwd_module",
          prompt:
            "Delete the file src/main/tools/getCurrentWorkingDirectory.ts.",
          verify:
            "src/main/tools/getCurrentWorkingDirectory.ts no longer exists.",
        },
      ]),
    );

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("src/main/tools/index.ts");
  });

  it("rejects tool module removal plans that do not delete the obsolete module file", () => {
    const result = validatePlanForExecution(
      parsedPlan([
        {
          name: "remove_cwd_tool",
          prompt:
            "Remove references to getCurrentWorkingDirectoryTool in src/main/tools/getCurrentWorkingDirectory.ts and update src/main/tools/index.ts.",
          verify:
            "src/main/tools/index.ts no longer references getCurrentWorkingDirectoryTool.",
        },
      ]),
    );

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("must delete");
  });

  it("rejects tool module removal plans with only compile verification", () => {
    const result = validatePlanForExecution(
      parsedPlan([
        {
          name: "remove_cwd_tool",
          prompt:
            "Delete src/main/tools/getCurrentWorkingDirectory.ts and update src/main/tools/index.ts.",
          verify: "The code compiles and runs without errors.",
        },
      ]),
    );

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("must verify absence");
  });

  it("accepts tool module removal plans that name the tools registry update", () => {
    const result = validatePlanForExecution(
      parsedPlan([
        {
          name: "remove_cwd_tool",
          prompt:
            "Delete src/main/tools/getCurrentWorkingDirectory.ts and edit src/main/tools/index.ts to remove the import and TOOLS entry for getCurrentWorkingDirectoryTool.",
          verify:
            "src/main/tools/getCurrentWorkingDirectory.ts does not exist and src/main/tools/index.ts no longer references getCurrentWorkingDirectoryTool.",
        },
      ]),
    );

    expect(result).toEqual({ valid: true });
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
