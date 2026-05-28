import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setRuntimePaths } from "../../src/main/runtimePaths";
import { EXECUTABLE_PLAN_VALIDATION_GUIDANCE_LINES } from "../../src/main/plan/validation";
import { codeSystemPrompt } from "../../src/main/tools";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "code-system-prompt-"));
  setRuntimePaths({ userData: dir, appRoot: dir, packaged: false });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeGemma(name: string, content: string): void {
  writeFileSync(join(dir, name), content, "utf8");
}

describe("codeSystemPrompt", () => {
  it("does not instruct the model to emit a diagnostic Loaded line", () => {
    const commonInstructions = readFileSync(
      join(process.cwd(), "Gemma.md"),
      "utf8",
    );

    expect(commonInstructions).not.toContain("Self-check on first turn");
    expect(commonInstructions).not.toContain("Loaded: Gemma project instructions");
  });

  it("instructs code discuss mode to answer prompt-advice questions directly", () => {
    const codeInstructions = readFileSync(
      join(process.cwd(), "Gemma.code.md"),
      "utf8",
    );

    expect(codeInstructions).toContain("When the active prompt mode is code");
    expect(codeInstructions).toContain("provide the exact first prompt");
    expect(codeInstructions).toContain("Do not emit a YAML plan");
  });

  it("teaches plan mode to emit one step at a time", () => {
    const planPrompt = readFileSync(
      join(process.cwd(), "Gemma.plan.md"),
      "utf8",
    );

    expect(planPrompt).toContain(
      "exactly one YAML plan containing exactly one step",
    );
    expect(planPrompt).toContain("This phase is only for planning");
    expect(planPrompt).toContain("fresh model context");
    expect(planPrompt).toContain("Do not emit action tags");
    expect(planPrompt).toContain("Do not add stop, conclude, cleanup");
    expect(planPrompt).toContain("plan: done");
    expect(planPrompt).not.toContain("no plan + no action");
    expect(planPrompt).not.toContain(
      "Emit one complete YAML plan covering the work end to end",
    );
  });

  it("teaches execute mode that ambiguous old_string failures require a different edit path", () => {
    const executePrompt = readFileSync(
      join(process.cwd(), "Gemma.execute.md"),
      "utf8",
    );

    expect(executePrompt).toContain(
      "old_string was not found or appears multiple times",
    );
    expect(executePrompt).toContain("do not retry the same old_string");
    expect(executePrompt).toContain("Do not invent tool results");
    expect(executePrompt).toContain("Execution starts with a fresh model context");
    expect(executePrompt).toContain(
      "use run_bash with that exact command",
    );
    expect(executePrompt).toContain(
      "including pnpm test, pnpm test tests/main/someTool.test.ts, or pnpm run build",
    );
    expect(executePrompt).toContain(
      "Do not replace exact commands with run_project_script",
    );
    expect(executePrompt).toContain("preserve the current file content");
  });

  it("states the generic executable-plan validation and review gates in plan mode", () => {
    const planPrompt = readFileSync(
      join(process.cwd(), "Gemma.plan.md"),
      "utf8",
    );

    expect(planPrompt).toContain("I perform deterministic validation of plan shape only");
    expect(planPrompt).toContain(
      "The plan must contain at least one executable step.",
    );
    expect(planPrompt).toContain("Every step name must be unique.");
    expect(planPrompt).toContain(
      "After the assembled plan passes deterministic validation, I start a fresh validation context",
    );
    expect(planPrompt).toContain(
      "I pass the original request in an OriginalRequest XML block",
    );
    expect(planPrompt).toContain(
      "return one complete corrected YAML plan with all steps",
    );
    expect(planPrompt).toContain(
      "Do not use placeholder names such as exampleTool.test.ts, newToolName.test.ts, or requested_tool_name.",
    );
    expect(planPrompt).toContain(
      "relevant tests, relevant files, needed files, files needed, implementation files, documentation files needed, runtime files needed, and prompt files needed",
    );
    expect(planPrompt).not.toContain("tests/main/currentDatetimeTool.test.ts");
    expect(planPrompt).not.toContain("get_current_hostname");
    expect(planPrompt).not.toContain("pnpm run build or npm run build");
    for (const line of EXECUTABLE_PLAN_VALIDATION_GUIDANCE_LINES) {
      expect(planPrompt).toContain(line);
    }
  });

  it("keeps common plan instructions aligned with iterative assembly", () => {
    const commonPrompt = readFileSync(join(process.cwd(), "Gemma.md"), "utf8");

    expect(commonPrompt).toContain("you do not write the whole plan at once");
    expect(commonPrompt).toContain("I accumulate accepted steps");
    expect(commonPrompt).toContain("response contains no YAML plan and no action");
    expect(commonPrompt).not.toContain("reply exactly");
  });

  it("does not introduce an undefined platform persona in prompt files", () => {
    for (const promptFile of [
      "Gemma.md",
      "Gemma.code.md",
      "Gemma.plan.md",
      "Gemma.execute.md",
    ]) {
      const prompt = readFileSync(join(process.cwd(), promptFile), "utf8");

      expect(prompt).not.toMatch(/\bhost\b/i);
    }
  });

  it("loads only plan instructions for code planning mode", () => {
    writeGemma("Gemma.md", "COMMON_MARKER");
    writeGemma("Gemma.code.md", "CODE_MARKER");
    writeGemma("Gemma.plan.md", "PLAN_MARKER");
    writeGemma("Gemma.execute.md", "EXECUTE_MARKER");

    const prompt = codeSystemPrompt("/workspace", "http://preview", "plan");

    expect(prompt).not.toContain("COMMON_MARKER");
    expect(prompt).not.toContain("CODE_MARKER");
    expect(prompt).toContain("PLAN_MARKER");
    expect(prompt).not.toContain("EXECUTE_MARKER");
    expect(prompt.indexOf("MODE AND PROJECT INSTRUCTIONS")).toBeLessThan(
      prompt.indexOf("PLAN_MARKER"),
    );
    expect(prompt).not.toContain("ACTION FORMAT");
    expect(prompt).not.toContain("AVAILABLE TOOLS");
  });

  it("loads only execute instructions for plan execution mode", () => {
    writeGemma("Gemma.md", "COMMON_MARKER");
    writeGemma("Gemma.code.md", "CODE_MARKER");
    writeGemma("Gemma.plan.md", "PLAN_MARKER");
    writeGemma("Gemma.execute.md", "EXECUTE_MARKER");

    const prompt = codeSystemPrompt("/workspace", "http://preview", "execute");

    expect(prompt).not.toContain("COMMON_MARKER");
    expect(prompt).not.toContain("CODE_MARKER");
    expect(prompt).toContain("EXECUTE_MARKER");
    expect(prompt).not.toContain("PLAN_MARKER");
  });

  it("starts code prompts with structured session context", () => {
    writeGemma("Gemma.code.md", "CODE_MARKER");

    const prompt = codeSystemPrompt("/workspace", "http://preview", "code");

    expect(prompt).toContain("SESSION CONTEXT");
    expect(prompt).toContain("- Current date/time (UTC):");
    expect(prompt).toContain("- Local timezone:");
    expect(prompt).toContain("- Workspace root: /workspace");
    expect(prompt).toContain("- Preview URL: http://preview");
    expect(prompt).toContain("- Active prompt mode: code");
    expect(prompt.indexOf("SESSION CONTEXT")).toBeLessThan(
      prompt.indexOf("CODE_MARKER"),
    );
  });
});
