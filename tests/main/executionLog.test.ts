import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setRuntimePaths } from "../../src/main/runtimePaths";
import {
  createExecutionLogger,
  ensureExecutionLogFile,
  executionLogPath,
} from "../../src/main/executionLog";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "execution-log-"));
  setRuntimePaths({ userData: dir, appRoot: dir, packaged: false });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("executionLog", () => {
  it("appends JSON lines when logging is enabled", () => {
    const log = createExecutionLogger(true, {
      conversationId: "c1",
      mode: "code",
      model: "gemma-test",
    });

    log("tool_call", { id: "call-1", name: "write_file" });
    log("tool_result", { id: "call-1", result: "Wrote src/main/tools.ts" });

    const lines = readFileSync(executionLogPath(), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({
      conversationId: "c1",
      mode: "code",
      model: "gemma-test",
      event: "tool_call",
      data: { id: "call-1", name: "write_file" },
    });
    expect(JSON.parse(lines[1])).toMatchObject({
      event: "tool_result",
      data: { id: "call-1", result: "Wrote src/main/tools.ts" },
    });
  });

  it("does not create a log file when logging is disabled", () => {
    const log = createExecutionLogger(false, {
      conversationId: "c1",
      mode: "code",
      model: "gemma-test",
    });

    log("tool_call", { id: "call-1" });

    expect(existsSync(executionLogPath())).toBe(false);
  });

  it("creates an empty execution log file for opening", () => {
    const path = ensureExecutionLogFile();

    expect(path).toBe(executionLogPath());
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("");
  });
});
