import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setRuntimePaths } from "../../src/main/runtimePaths";
import { loadProjectInstructions } from "../../src/main/tools";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gemma-md-"));
  setRuntimePaths({ userData: dir, appRoot: dir, packaged: false });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const writeGemma = (name: string, content: string) =>
  writeFileSync(join(dir, name), content, "utf8");

describe("loadProjectInstructions(mode)", () => {
  it("returns null when no Gemma.md and no mode file exist", () => {
    expect(loadProjectInstructions()).toBeNull();
    expect(loadProjectInstructions("chat")).toBeNull();
    expect(loadProjectInstructions("code")).toBeNull();
    expect(loadProjectInstructions("build")).toBeNull();
  });

  it("returns just Gemma.md when no mode is given", () => {
    writeGemma("Gemma.md", "# Common");
    expect(loadProjectInstructions()).toBe("# Common");
  });

  it("returns just Gemma.md when mode is given but mode file is missing", () => {
    writeGemma("Gemma.md", "# Common only");
    expect(loadProjectInstructions("code")).toBe("# Common only");
    expect(loadProjectInstructions("build")).toBe("# Common only");
    expect(loadProjectInstructions("chat")).toBe("# Common only");
  });

  it("concatenates Gemma.md and Gemma.code.md for code mode", () => {
    writeGemma("Gemma.md", "# Common");
    writeGemma("Gemma.code.md", "# Code mode addendum");
    const out = loadProjectInstructions("code");
    expect(out).toContain("# Common");
    expect(out).toContain("# Code mode addendum");
    expect(out!.indexOf("# Common")).toBeLessThan(
      out!.indexOf("# Code mode addendum"),
    );
  });

  it("concatenates Gemma.md and Gemma.build.md for build mode", () => {
    writeGemma("Gemma.md", "# Common");
    writeGemma("Gemma.build.md", "# Build mode addendum");
    const out = loadProjectInstructions("build");
    expect(out).toContain("# Common");
    expect(out).toContain("# Build mode addendum");
  });

  it("concatenates Gemma.md and Gemma.chat.md for chat mode", () => {
    writeGemma("Gemma.md", "# Common");
    writeGemma("Gemma.chat.md", "# Chat mode addendum");
    const out = loadProjectInstructions("chat");
    expect(out).toContain("# Common");
    expect(out).toContain("# Chat mode addendum");
  });

  it("does NOT include other mode files when a specific mode is requested", () => {
    writeGemma("Gemma.md", "# Common");
    writeGemma("Gemma.build.md", "BUILD_MARKER");
    writeGemma("Gemma.code.md", "CODE_MARKER");
    const out = loadProjectInstructions("code");
    expect(out).toContain("CODE_MARKER");
    expect(out).not.toContain("BUILD_MARKER");
  });

  it("returns just the mode file when Gemma.md is missing", () => {
    writeGemma("Gemma.code.md", "# Code only");
    expect(loadProjectInstructions("code")).toBe("# Code only");
  });

  it("trims whitespace from each file before concatenating", () => {
    writeGemma("Gemma.md", "  common  \n");
    writeGemma("Gemma.code.md", "\n  code  \n\n");
    const out = loadProjectInstructions("code");
    expect(out).toBe("common\n\ncode");
  });
});
