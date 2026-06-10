import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { setRuntimePaths } from "../../src/main/runtimePaths";
import {
  createExecutionLogger,
  ensureExecutionLogFile,
  executionLogPath,
  readExecutionLogSnapshot,
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

    const path = executionLogPath();
    expect(basename(path)).toMatch(/^execution-log-.*-c1\.jsonl$/);
    const lines = readFileSync(path, "utf8").trim().split("\n");
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

  it("creates a separate log file for each enabled execution", () => {
    const first = createExecutionLogger(true, {
      conversationId: "first-conversation",
      mode: "code",
      model: "gemma-test",
    });
    const firstPath = executionLogPath();
    first("session_start", { id: 1 });

    const second = createExecutionLogger(true, {
      conversationId: "second-conversation",
      mode: "code",
      model: "gemma-test",
    });
    const secondPath = executionLogPath();
    second("session_start", { id: 2 });

    expect(secondPath).not.toBe(firstPath);
    expect(basename(firstPath)).toContain("first-conversation");
    expect(basename(secondPath)).toContain("second-conversation");
    expect(readFileSync(firstPath, "utf8")).toContain('"id":1');
    expect(readFileSync(firstPath, "utf8")).not.toContain('"id":2');
    expect(readFileSync(secondPath, "utf8")).toContain('"id":2');
  });

  it("consolidates consecutive text and reasoning stream chunks", () => {
    const log = createExecutionLogger(true, {
      conversationId: "c1",
      mode: "code",
      model: "gemma-test",
    });

    log("stream_chunk", { type: "token", text: "Hello" });
    log("stream_chunk", { type: "token", text: " there" });
    log("stream_chunk", { type: "reasoning", text: "I should" });
    log("stream_chunk", { type: "reasoning", text: " inspect first." });
    log("stream_chunk", { type: "done" });

    const lines = readFileSync(executionLogPath(), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      event: "stream_chunk",
      data: { type: "token", text: "Hello there", chunks: 2 },
    });
    expect(lines[1]).toMatchObject({
      event: "stream_chunk",
      data: {
        type: "reasoning",
        text: "I should inspect first.",
        chunks: 2,
      },
    });
    expect(lines[2]).toMatchObject({
      event: "stream_chunk",
      data: { type: "done" },
    });
  });

  it("consolidates consecutive model content and reasoning chunks", () => {
    const log = createExecutionLogger(true, {
      conversationId: "c1",
      mode: "code",
      model: "gemma-test",
    });

    log("model_chunk", { callId: "model-1", content: "One" });
    log("model_chunk", { callId: "model-1", content: " response" });
    log("model_chunk", { callId: "model-1", reasoning: "One" });
    log("model_chunk", { callId: "model-1", reasoning: " thought" });
    log("model_response", { callId: "model-1", content: "One response" });

    const lines = readFileSync(executionLogPath(), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      event: "model_chunk",
      data: { callId: "model-1", content: "One response", chunks: 2 },
    });
    expect(lines[1]).toMatchObject({
      event: "model_chunk",
      data: { callId: "model-1", reasoning: "One thought", chunks: 2 },
    });
    expect(lines[2]).toMatchObject({
      event: "model_response",
      data: { callId: "model-1", content: "One response" },
    });
  });

  it("creates an empty execution log file for opening", () => {
    const path = ensureExecutionLogFile();

    expect(path).toBe(executionLogPath());
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("");
  });

  it("reads execution log entries for the in-app viewer", () => {
    const log = createExecutionLogger(true, {
      conversationId: "c1",
      mode: "code",
      model: "gemma-test",
    });

    log("plan_blocked", { reason: "grep command was killed" });
    appendFileSync(executionLogPath(), "not json\n", "utf8");

    const snapshot = readExecutionLogSnapshot();

    expect(snapshot.path).toBe(executionLogPath());
    expect(snapshot.totalLines).toBe(2);
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.entries[0]).toMatchObject({
      line: 1,
      event: "plan_blocked",
      conversationId: "c1",
      data: { reason: "grep command was killed" },
    });
    expect(snapshot.entries[1]).toMatchObject({
      line: 2,
      event: "invalid_json",
      raw: "not json",
    });
  });
});
