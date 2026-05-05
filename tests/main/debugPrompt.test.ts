import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setRuntimePaths } from "../../src/main/runtimePaths";
import {
  saveLastPrompt,
  debugPromptPath,
} from "../../src/main/debugPrompt";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "debug-prompt-"));
  setRuntimePaths({ userData: dir, appRoot: dir, packaged: false });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("debugPrompt", () => {
  it("writes the file under <userData>/debug/last-system-prompt.txt", () => {
    const path = saveLastPrompt(
      [
        { role: "system", content: "You are Gemma." },
        { role: "user", content: "Hi" },
      ],
      { mode: "chat", model: "gemma-3" },
    );
    expect(path).toBe(debugPromptPath());
    expect(path.startsWith(join(dir, "debug"))).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("You are Gemma.");
  });

  it("includes header metadata: timestamp, mode, model, message count", () => {
    saveLastPrompt(
      [
        { role: "system", content: "sys" },
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1" },
      ],
      { mode: "code", model: "gemma-test" },
    );
    const text = readFileSync(debugPromptPath(), "utf8");
    expect(text).toMatch(/Mode: code/);
    expect(text).toMatch(/Model: gemma-test/);
    expect(text).toMatch(/Messages: 3/);
    // ISO timestamp shape (year-month-day…)
    expect(text).toMatch(/Generated: \d{4}-\d{2}-\d{2}T/);
  });

  it("annotates whether PROJECT INSTRUCTIONS (Gemma.md) is present", () => {
    saveLastPrompt(
      [
        {
          role: "system",
          content:
            "intro\n\nPROJECT INSTRUCTIONS\n====================\n# Gemma — Project Instructions\n",
        },
      ],
      { mode: "chat", model: "m" },
    );
    expect(readFileSync(debugPromptPath(), "utf8")).toMatch(
      /Includes Gemma\.md: yes/,
    );
  });

  it("annotates Gemma.md absence as NO when PROJECT INSTRUCTIONS missing", () => {
    saveLastPrompt(
      [{ role: "system", content: "no project block here" }],
      { mode: "chat", model: "m" },
    );
    expect(readFileSync(debugPromptPath(), "utf8")).toMatch(
      /Includes Gemma\.md: NO/,
    );
  });

  it("renders each message with role label and content", () => {
    saveLastPrompt(
      [
        { role: "system", content: "S" },
        { role: "user", content: "U" },
        { role: "assistant", content: "A" },
      ],
      { mode: "chat", model: "m" },
    );
    const text = readFileSync(debugPromptPath(), "utf8");
    expect(text).toMatch(/role: system/);
    expect(text).toMatch(/role: user/);
    expect(text).toMatch(/role: assistant/);
    expect(text).toContain("S");
    expect(text).toContain("U");
    expect(text).toContain("A");
  });

  it("subsequent calls overwrite the file", () => {
    saveLastPrompt(
      [{ role: "system", content: "first" }],
      { mode: "chat", model: "m" },
    );
    saveLastPrompt(
      [{ role: "system", content: "second" }],
      { mode: "chat", model: "m" },
    );
    const text = readFileSync(debugPromptPath(), "utf8");
    expect(text).toContain("second");
    expect(text).not.toContain("first");
  });

  it("creates the debug directory if it doesn't exist", () => {
    // Fresh tmpdir — debug/ has not been created yet.
    saveLastPrompt(
      [{ role: "system", content: "x" }],
      { mode: "chat", model: "m" },
    );
    // No throw → directory creation worked.
    expect(readFileSync(debugPromptPath(), "utf8")).toContain("x");
  });
});
