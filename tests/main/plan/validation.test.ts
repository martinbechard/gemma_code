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

  it("rejects sample placeholder filenames and tool names", () => {
    const result = validatePlanForExecution(
      parsedPlan([
        {
          name: "ground",
          prompt:
            "Read src/main/tools.ts, Gemma.md, package.json, and tests/main/exampleTool.test.ts.",
          verify:
            "src/main/tools.ts, Gemma.md, package.json, and tests/main/exampleTool.test.ts have been read.",
        },
        {
          name: "test",
          prompt:
            "Update tests/main/exampleTool.test.ts so it proves requested_tool_name, then run pnpm test tests/main/exampleTool.test.ts.",
          verify:
            "pnpm test tests/main/exampleTool.test.ts fails for requested_tool_name.",
        },
        {
          name: "implement",
          prompt:
            "Edit src/main/tools.ts and Gemma.md to add requested_tool_name.",
          verify: "src/main/tools.ts and Gemma.md contain requested_tool_name.",
        },
        {
          name: "verify",
          prompt:
            "Run pnpm test tests/main/exampleTool.test.ts, pnpm test, and pnpm run build.",
          verify: "All three commands pass.",
        },
      ]),
    );

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("exampleTool.test.ts");
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

  it("rejects plans that do not name an exact test file", () => {
    const result = validatePlanForExecution(
      parsedPlan([
        {
          name: "ground",
          prompt: "Read src/main/tools.ts and Gemma.md.",
          verify: "src/main/tools.ts and Gemma.md have been read.",
        },
        {
          name: "test",
          prompt: "Add a failing test for get_current_datetime and run pnpm test.",
          verify: "pnpm test fails for the missing behavior.",
        },
        {
          name: "implement",
          prompt: "Edit src/main/tools.ts and Gemma.md to add get_current_datetime.",
          verify: "src/main/tools.ts and Gemma.md contain get_current_datetime.",
        },
        {
          name: "verify",
          prompt: "Run pnpm test and pnpm run build.",
          verify: "Both commands pass.",
        },
      ]),
    );

    expect(result).toEqual({
      valid: false,
      reason:
        "Plan must name the exact tests/main test file path it will create or update.",
    });
  });

  it("rejects host-project test paths outside tests/main", () => {
    const result = validatePlanForExecution(
      parsedPlan([
        {
          name: "ground",
          prompt:
            "Read src/main/tools.ts, Gemma.md, and tests/currentWorkingDirectoryTool.test.ts.",
          verify:
            "src/main/tools.ts, Gemma.md, and tests/currentWorkingDirectoryTool.test.ts have been read.",
        },
        {
          name: "test",
          prompt:
            "Update tests/currentWorkingDirectoryTool.test.ts and run pnpm test tests/currentWorkingDirectoryTool.test.ts.",
          verify:
            "pnpm test tests/currentWorkingDirectoryTool.test.ts fails because get_current_working_directory is missing.",
        },
        {
          name: "implement",
          prompt:
            "Edit src/main/tools.ts and Gemma.md to add get_current_working_directory.",
          verify:
            "src/main/tools.ts and Gemma.md contain get_current_working_directory.",
        },
        {
          name: "verify",
          prompt:
            "Run pnpm test tests/currentWorkingDirectoryTool.test.ts, pnpm test, and pnpm run build.",
          verify: "All three commands pass.",
        },
      ]),
    );

    expect(result).toEqual({
      valid: false,
      reason:
        "Plan must name the exact tests/main test file path it will create or update.",
    });
  });

  it("rejects plans that do not name exact verification commands", () => {
    const result = validatePlanForExecution(
      parsedPlan([
        {
          name: "ground",
          prompt: "Read src/main/tools.ts and tests/main/currentDatetimeTool.test.ts.",
          verify: "The named files have been read.",
        },
        {
          name: "test",
          prompt:
            "Update tests/main/currentDatetimeTool.test.ts to cover get_current_datetime.",
          verify: "The focused test fails for the missing behavior.",
        },
        {
          name: "implement",
          prompt: "Edit src/main/tools.ts and Gemma.md to add get_current_datetime.",
          verify: "src/main/tools.ts and Gemma.md contain get_current_datetime.",
        },
        {
          name: "verify",
          prompt: "Run the focused tests and the build.",
          verify: "The commands pass.",
        },
      ]),
    );

    expect(result).toEqual({
      valid: false,
      reason: "Plan must name the exact test command it will run.",
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
