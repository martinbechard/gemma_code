import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setRuntimePaths } from "../../src/main/runtimePaths";
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

  it("teaches plan mode to inspect read-only and emit one step at a time", () => {
    const planPrompt = readFileSync(
      join(process.cwd(), "Gemma.plan.md"),
      "utf8",
    );

    expect(planPrompt).toContain(
      "preparing a plan for another AI coding agent",
    );
    expect(planPrompt).toContain("read-only inspection actions");
    expect(planPrompt).toContain("Mutation steps must name exact files");
    expect(planPrompt).toContain("Emit plan steps one at a time");
    expect(planPrompt).toContain("<Step>");
    expect(planPrompt).toContain("</Step>");
    expect(planPrompt).toContain("<Question>One focused question.</Question>");
    expect(planPrompt).toContain("plan: done");
    expect(planPrompt).toContain("Do not wrap it in Step tags");
    expect(planPrompt).not.toContain("Do not inspect files");
    expect(planPrompt).not.toContain("Do not emit action tags");
    expect(planPrompt).not.toContain("no plan + no action");
    expect(planPrompt).not.toContain(
      "Emit one complete YAML plan covering the work end to end",
    );
  });

  it("teaches execute mode to use write_file for file changes", () => {
    const executePrompt = readFileSync(
      join(process.cwd(), "Gemma.execute.md"),
      "utf8",
    );

    expect(executePrompt).toContain("Use write_file for file changes");
    expect(executePrompt).toContain("Do not invent tool results");
    expect(executePrompt).toContain("A visible tool result that begins with [ok] is usable output");
    expect(executePrompt).toContain('reply exactly with <error reason="short reason"/>');
    expect(executePrompt).toContain("no more than 3 non-empty lines");
    expect(executePrompt).toContain("Do not write waiting prose");
    expect(executePrompt).toContain("list_files returns the workspace tree");
    expect(executePrompt).toContain("search_files searches file contents");
    expect(executePrompt).toContain(
      "use search_files before list_files or run_bash",
    );
    expect(executePrompt).toContain(
      "a read-only action is not enough",
    );
    expect(executePrompt).toContain("post-edit absence evidence");
    expect(executePrompt).toContain(
      "The content must preserve the current file content",
    );
    expect(executePrompt).toContain("Execution starts with a fresh model context");
    const prompt = codeSystemPrompt("/workspace", "http://preview", "execute");
    expect(prompt).toContain('<action name="tool_name"/> is also valid');
    expect(prompt).toContain("### write_file");
    expect(prompt).not.toContain("### edit_file");
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

  it("keeps plan mode prompt focused on planning instructions", () => {
    const planPrompt = readFileSync(
      join(process.cwd(), "Gemma.plan.md"),
      "utf8",
    );

    expect(planPrompt).toContain(
      "Do not use placeholders such as relevant files",
    );
    expect(planPrompt).toContain(
      "Choose verification from the user request and project rules.",
    );
    expect(planPrompt).toContain(
      "Do not pass target discovery to the coding agent.",
    );
    expect(planPrompt).not.toContain("I perform deterministic validation");
    expect(planPrompt).not.toContain("OriginalRequest XML block");
    expect(planPrompt).not.toContain("structured checklist");
    expect(planPrompt).not.toContain("tests/main/currentDatetimeTool.test.ts");
    expect(planPrompt).not.toContain("get_current_hostname");
    expect(planPrompt).not.toContain("pnpm run build or npm run build");
  });

  it("exposes only read-only inspection tools in code planning mode", () => {
    const prompt = codeSystemPrompt("/workspace", "http://preview", "plan");

    expect(prompt).toContain("READ-ONLY INSPECTION ACTION FORMAT");
    expect(prompt).toContain("Allowed inspection tools");
    expect(prompt).toContain("- Current task: prepare an implementation plan");
    expect(prompt).not.toContain("- Active prompt mode: plan");
    expect(prompt).not.toContain("Plan mode may");
    expect(prompt).toContain("### read_file");
    expect(prompt).toContain("### search_files");
    expect(prompt).toContain("### list_files");
    expect(prompt).toContain("### run_bash");
    expect(prompt).not.toContain("### write_file");
    expect(prompt).not.toContain("### edit_file");
    expect(prompt).not.toContain("### delete_file");
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
    expect(prompt).toContain("READ-ONLY INSPECTION ACTION FORMAT");
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

  it("describes list_files as a full workspace tree tool", () => {
    const prompt = codeSystemPrompt("/workspace", "http://preview", "execute");

    expect(prompt).toContain("List the workspace tree only");
    expect(prompt).toContain("it does not search file contents");
    expect(prompt).toContain("This tool has no path parameter");
    expect(prompt).toContain("Use search_files for references or text");
    expect(prompt).toContain("use run_bash for narrower directory listings");
  });

  it("advertises search_files as the first choice for reference searches", () => {
    const prompt = codeSystemPrompt("/workspace", "http://preview", "execute");

    expect(prompt).toContain("### search_files");
    expect(prompt).toContain("Search workspace files for a literal query");
    expect(prompt).toContain(
      "Use this before run_bash for finding references, usages, symbols, or text.",
    );
    expect(prompt).not.toContain("using rg");
    expect(prompt.indexOf("### search_files")).toBeLessThan(
      prompt.indexOf("### list_files"),
    );
  });
});
