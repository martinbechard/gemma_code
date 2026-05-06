import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
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
  it("loads code and plan instructions for code planning mode", () => {
    writeGemma("Gemma.md", "COMMON_MARKER");
    writeGemma("Gemma.code.md", "CODE_MARKER");
    writeGemma("Gemma.plan.md", "PLAN_MARKER");
    writeGemma("Gemma.execute.md", "EXECUTE_MARKER");

    const prompt = codeSystemPrompt("/workspace", "http://preview", "plan");

    expect(prompt).toContain("COMMON_MARKER");
    expect(prompt).toContain("CODE_MARKER");
    expect(prompt).toContain("PLAN_MARKER");
    expect(prompt).not.toContain("EXECUTE_MARKER");
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
});
