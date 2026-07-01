import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "fs";
import { join } from "path";
import type { ExecutionLogEntry, ExecutionLogSnapshot } from "../shared/types";
import { userDataDir } from "./runtimePaths";

const EXECUTION_LOG_VIEW_MAX_LINES = 800;
const EXECUTION_LOG_PREFIX = "execution-log";
const EXECUTION_LOG_EXTENSION = ".jsonl";
const LEGACY_EXECUTION_LOG_FILE = "execution-log.jsonl";
const STREAM_CHUNK_EVENT = "stream_chunk";
const MODEL_CHUNK_EVENT = "model_chunk";
const TOKEN_STREAM_CHUNK_TYPE = "token";
const REASONING_STREAM_CHUNK_TYPE = "reasoning";
const MODEL_CONTENT_CHUNK_FIELD = "content";
const MODEL_REASONING_CHUNK_FIELD = "reasoning";
const CONSOLIDATED_CHUNK_INITIAL_COUNT = 1;
const NO_ACTIVE_TURN = 0;
const TURN_INCREMENT = 1;
const TURN_START_EVENT = "turn_start";

export interface ExecutionLogMeta {
  conversationId: string;
  mode: string;
  model: string;
}

export interface ExecutionLogTurnData {
  label: string;
  source: string;
  round: number;
}

export interface ExecutionLogger {
  (event: string, data: unknown): void;
  startTurn(data: ExecutionLogTurnData): number;
}

interface ConsolidatedChunkLog {
  event: string;
  key: string;
  data: Record<string, unknown>;
  textField: string;
  chunks: number;
}

let activeExecutionLogPath: string | null = null;
let executionLogSequence = 0;

function executionLogDir(): string {
  return join(userDataDir(), "debug");
}

function ensureExecutionLogDir(): string {
  const dir = executionLogDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function safePathSegment(value: string): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "execution";
}

function timestampSegment(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function latestExecutionLogPath(): string | null {
  const dir = executionLogDir();
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .filter(
      (name) =>
        name.startsWith(`${EXECUTION_LOG_PREFIX}-`) &&
        name.endsWith(EXECUTION_LOG_EXTENSION),
    )
    .map((name) => {
      const path = join(dir, name);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.path ?? null;
}

function createExecutionLogFile(meta: ExecutionLogMeta): string {
  const dir = ensureExecutionLogDir();
  executionLogSequence += 1;
  const path = join(
    dir,
    [
      EXECUTION_LOG_PREFIX,
      timestampSegment(new Date()),
      String(executionLogSequence).padStart(4, "0"),
      safePathSegment(meta.conversationId),
    ].join("-") + EXECUTION_LOG_EXTENSION,
  );
  appendFileSync(path, "", "utf8");
  activeExecutionLogPath = path;
  return path;
}

export function executionLogPath(): string {
  if (activeExecutionLogPath && !existsSync(activeExecutionLogPath)) {
    activeExecutionLogPath = null;
  }
  return (
    activeExecutionLogPath ??
    latestExecutionLogPath() ??
    join(executionLogDir(), LEGACY_EXECUTION_LOG_FILE)
  );
}

export function ensureExecutionLogFile(): string {
  const path = executionLogPath();
  ensureExecutionLogDir();
  appendFileSync(path, "", "utf8");
  return path;
}

export function createExecutionLogger(
  enabled: boolean,
  meta: ExecutionLogMeta,
): ExecutionLogger {
  if (!enabled) return createDisabledExecutionLogger();
  const path = createExecutionLogFile(meta);
  let pendingChunk: ConsolidatedChunkLog | null = null;
  let activeTurn: number | null = null;

  const appendRecord = (event: string, data: unknown): void => {
    ensureExecutionLogDir();
    const record = {
      timestamp: new Date().toISOString(),
      conversationId: meta.conversationId,
      mode: meta.mode,
      model: meta.model,
      ...(activeTurn === null ? {} : { turn: activeTurn }),
      event,
      data,
    };
    appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
  };

  const flushPendingChunk = (): void => {
    if (!pendingChunk) return;
    appendRecord(pendingChunk.event, {
      ...pendingChunk.data,
      chunks: pendingChunk.chunks,
    });
    pendingChunk = null;
  };

  const logger = ((event: string, data: unknown): void => {
    const chunk = consolidatableChunkLog(event, data);
    if (!chunk) {
      flushPendingChunk();
      appendRecord(event, data);
      return;
    }

    if (pendingChunk?.key !== chunk.key) {
      flushPendingChunk();
      pendingChunk = chunk;
      return;
    }

    pendingChunk.data[pendingChunk.textField] =
      String(pendingChunk.data[pendingChunk.textField] ?? "") +
      String(chunk.data[chunk.textField] ?? "");
    pendingChunk.chunks += CONSOLIDATED_CHUNK_INITIAL_COUNT;
  }) as ExecutionLogger;

  logger.startTurn = (data: ExecutionLogTurnData): number => {
    flushPendingChunk();
    activeTurn = (activeTurn ?? NO_ACTIVE_TURN) + TURN_INCREMENT;
    appendRecord(TURN_START_EVENT, {
      ...data,
      turn: activeTurn,
    });
    return activeTurn;
  };

  return logger;
}

function createDisabledExecutionLogger(): ExecutionLogger {
  const logger = (() => undefined) as ExecutionLogger;
  logger.startTurn = () => NO_ACTIVE_TURN;
  return logger;
}

function isLogRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function consolidatableChunkLog(
  event: string,
  data: unknown,
): ConsolidatedChunkLog | null {
  if (!isLogRecord(data)) return null;
  if (event === STREAM_CHUNK_EVENT) {
    return consolidatableStreamChunk(data);
  }
  if (event === MODEL_CHUNK_EVENT) {
    return consolidatableModelChunk(data);
  }
  return null;
}

function consolidatableStreamChunk(
  data: Record<string, unknown>,
): ConsolidatedChunkLog | null {
  const type = data.type;
  if (
    type !== TOKEN_STREAM_CHUNK_TYPE &&
    type !== REASONING_STREAM_CHUNK_TYPE
  ) {
    return null;
  }
  if (typeof data.text !== "string" || data.text.length === 0) return null;
  return {
    event: STREAM_CHUNK_EVENT,
    key: `${STREAM_CHUNK_EVENT}:${type}`,
    data: { ...data },
    textField: "text",
    chunks: CONSOLIDATED_CHUNK_INITIAL_COUNT,
  };
}

function consolidatableModelChunk(
  data: Record<string, unknown>,
): ConsolidatedChunkLog | null {
  if (typeof data[MODEL_CONTENT_CHUNK_FIELD] === "string") {
    return {
      event: MODEL_CHUNK_EVENT,
      key: `${MODEL_CHUNK_EVENT}:${String(data.callId ?? "")}:${MODEL_CONTENT_CHUNK_FIELD}`,
      data: { ...data },
      textField: MODEL_CONTENT_CHUNK_FIELD,
      chunks: CONSOLIDATED_CHUNK_INITIAL_COUNT,
    };
  }
  if (typeof data[MODEL_REASONING_CHUNK_FIELD] === "string") {
    return {
      event: MODEL_CHUNK_EVENT,
      key: `${MODEL_CHUNK_EVENT}:${String(data.callId ?? "")}:${MODEL_REASONING_CHUNK_FIELD}`,
      data: { ...data },
      textField: MODEL_REASONING_CHUNK_FIELD,
      chunks: CONSOLIDATED_CHUNK_INITIAL_COUNT,
    };
  }
  return null;
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
        turn?: unknown;
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
        turn:
          typeof parsed.turn === "number" && Number.isFinite(parsed.turn)
            ? parsed.turn
            : undefined,
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
