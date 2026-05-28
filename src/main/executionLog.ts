import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import type { ExecutionLogEntry, ExecutionLogSnapshot } from "../shared/types";
import { userDataDir } from "./runtimePaths";

const EXECUTION_LOG_VIEW_MAX_LINES = 800;

export interface ExecutionLogMeta {
  conversationId: string;
  mode: string;
  model: string;
}

export type ExecutionLogger = (event: string, data: unknown) => void;

export function executionLogPath(): string {
  return join(userDataDir(), "debug", "execution-log.jsonl");
}

export function ensureExecutionLogFile(): string {
  const path = executionLogPath();
  const dir = join(userDataDir(), "debug");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(path, "", "utf8");
  return path;
}

export function createExecutionLogger(
  enabled: boolean,
  meta: ExecutionLogMeta,
): ExecutionLogger {
  if (!enabled) return () => undefined;
  return (event: string, data: unknown): void => {
    const path = executionLogPath();
    const dir = join(userDataDir(), "debug");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const record = {
      timestamp: new Date().toISOString(),
      conversationId: meta.conversationId,
      mode: meta.mode,
      model: meta.model,
      event,
      data,
    };
    appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
  };
}

export function readExecutionLogSnapshot(
  limit = EXECUTION_LOG_VIEW_MAX_LINES,
): ExecutionLogSnapshot {
  const path = ensureExecutionLogFile();
  const content = readFileSync(path, "utf8");
  const allLines = content.split(/\r?\n/).filter((line) => line.trim() !== "");
  const start = Math.max(0, allLines.length - limit);
  const selectedLines = allLines.slice(start);
  const entries: ExecutionLogEntry[] = selectedLines.map((line, index) => {
    const lineNumber = start + index + 1;
    try {
      const parsed = JSON.parse(line) as {
        timestamp?: unknown;
        conversationId?: unknown;
        mode?: unknown;
        model?: unknown;
        event?: unknown;
        data?: unknown;
      };
      return {
        line: lineNumber,
        timestamp:
          typeof parsed.timestamp === "string" ? parsed.timestamp : "",
        conversationId:
          typeof parsed.conversationId === "string"
            ? parsed.conversationId
            : undefined,
        mode: typeof parsed.mode === "string" ? parsed.mode : undefined,
        model: typeof parsed.model === "string" ? parsed.model : undefined,
        event: typeof parsed.event === "string" ? parsed.event : "unknown",
        data: parsed.data,
      };
    } catch {
      return {
        line: lineNumber,
        timestamp: "",
        event: "invalid_json",
        data: line,
        raw: line,
      };
    }
  });
  return {
    path,
    entries,
    totalLines: allLines.length,
    truncated: start > 0,
  };
}
