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
    expect(planPrompt).toContain("Do not emit action tags");
    expect(planPrompt).toContain("Do not add stop, conclude, cleanup");
    expect(planPrompt).not.toContain("no plan + no action");
    expect(planPrompt).not.toContain(
      "Emit one complete YAML plan covering the work end to end",
    );
  });

  it("states the concrete executable-plan validation gates in plan mode", () => {
    const planPrompt = readFileSync(
      join(process.cwd(), "Gemma.plan.md"),
      "utf8",
    );

    expect(planPrompt).toContain(
      "At least four accepted steps are required before execution: grounding, test, implementation, and verification.",
    );
    expect(planPrompt).toContain(
      "Step names are not fixed, but the step name, prompt, or verify text must include the words the validator looks for.",
    );
    expect(planPrompt).toContain("ground, read, inspect, or list");
    expect(planPrompt).toContain("test or spec");
    expect(planPrompt).toContain("implement, edit, add, or update");
    expect(planPrompt).toContain("verify, build, pnpm, npm, or run");
    expect(planPrompt).toContain(
      "The assembled plan must name one exact tests/main test file path that ends in .test.ts.",
    );
    expect(planPrompt).toContain(
      "The assembled plan must name the exact focused test command it will run, such as pnpm test tests/main/currentDatetimeTool.test.ts.",
    );
    expect(planPrompt).toContain(
      "The assembled plan must name the exact build command it will run: pnpm run build or npm run build.",
    );
    expect(planPrompt).toContain(
      "Do not use placeholder names such as exampleTool.test.ts or requested_tool_name.",
    );
    expect(planPrompt).toContain(
      "relevant tests, relevant files, needed files, files needed, implementation files, documentation files needed, runtime files needed, and prompt files needed",
    );
    expect(planPrompt).toContain("Keep requested get_current_ tool names exactly.");
    for (const line of EXECUTABLE_PLAN_VALIDATION_GUIDANCE_LINES) {
      expect(planPrompt).toContain(line);
    }
  });

  it("keeps common plan instructions aligned with iterative assembly", () => {
    const commonPrompt = readFileSync(join(process.cwd(), "Gemma.md"), "utf8");

    expect(commonPrompt).toContain("you do not write the whole plan at once");
    expect(commonPrompt).toContain("host accumulates accepted steps");
    expect(commonPrompt).toContain("response contains no YAML plan and no action");
    expect(commonPrompt).not.toContain("reply exactly");
  });

  it("loads code and plan instructions for code planning mode", () => {
    writeGemma("Gemma.md", "COMMON_MARKER");
    writeGemma("Gemma.code.md", "CODE_MARKER");
    writeGemma("Gemma.plan.md", "PLAN_MARKER");
    writeGemma("Gemma.execute.md", "EXECUTE_MARKER");

    const prompt = codeSystemPrompt("/workspace", "http://preview", "plan");

    expect(prompt).not.toContain("COMMON_MARKER");
    expect(prompt).toContain("CODE_MARKER");
    expect(prompt).toContain("PLAN_MARKER");
    expect(prompt).not.toContain("EXECUTE_MARKER");
    expect(prompt.indexOf("MODE AND PROJECT INSTRUCTIONS")).toBeLessThan(
      prompt.indexOf("PLAN_MARKER"),
    );
    expect(prompt).not.toContain("ACTION FORMAT");
    expect(prompt).not.toContain("AVAILABLE TOOLS");
  });

  it("loads code and execute instructions for plan execution mode", () => {
    writeGemma("Gemma.md", "COMMON_MARKER");
    writeGemma("Gemma.code.md", "CODE_MARKER");
    writeGemma("Gemma.plan.md", "PLAN_MARKER");
    writeGemma("Gemma.execute.md", "EXECUTE_MARKER");

    const prompt = codeSystemPrompt("/workspace", "http://preview", "execute");

    expect(prompt).not.toContain("COMMON_MARKER");
    expect(prompt).toContain("CODE_MARKER");
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
