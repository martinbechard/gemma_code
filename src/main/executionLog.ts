import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { userDataDir } from "./runtimePaths";

export interface ExecutionLogMeta {
  conversationId: string;
  mode: string;
  model: string;
}

export type ExecutionLogger = (event: string, data: unknown) => void;

export function executionLogPath(): string {
  return join(userDataDir(), "debug", "execution-log.jsonl");
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
