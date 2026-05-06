import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MLXChatMessage } from "../main/mlx";

export const CLI_STATE_DIR = ".gemma-cli";
export const CLI_CONVERSATIONS_DIR = "conversations";

export interface CliConversationSnapshot {
  conversationId: string;
  mode: "chat" | "code";
  model: string;
  repoRoot: string;
  projectRoot: string;
  messages: MLXChatMessage[];
  planExecutionSystemPrompt: string | null;
}

export function conversationPathFor(
  repoRoot: string,
  conversationId: string,
): string {
  return join(
    repoRoot,
    CLI_STATE_DIR,
    CLI_CONVERSATIONS_DIR,
    `${sanitiseSegment(conversationId)}.json`,
  );
}

export function saveCliConversation(
  repoRoot: string,
  snapshot: CliConversationSnapshot,
): string {
  const path = conversationPathFor(repoRoot, snapshot.conversationId);
  mkdirSync(join(repoRoot, CLI_STATE_DIR, CLI_CONVERSATIONS_DIR), {
    recursive: true,
  });
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return path;
}

export function loadCliConversation(path: string): CliConversationSnapshot {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isSnapshot(parsed)) {
    throw new Error(`Invalid CLI conversation snapshot: ${path}`);
  }
  return parsed;
}

function isSnapshot(value: unknown): value is CliConversationSnapshot {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.conversationId === "string" &&
    (record.mode === "chat" || record.mode === "code") &&
    typeof record.model === "string" &&
    typeof record.repoRoot === "string" &&
    typeof record.projectRoot === "string" &&
    Array.isArray(record.messages) &&
    (typeof record.planExecutionSystemPrompt === "string" ||
      record.planExecutionSystemPrompt === null)
  );
}

function sanitiseSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.{2,}/g, "_");
}
