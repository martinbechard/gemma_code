import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { userDataDir } from "./runtimePaths";

// Persists the most recent assembled chat prompt to disk so the human can
// inspect what the model actually receives. Useful for confirming that
// Gemma.md is being threaded through and that the conversation isn't silently
// truncated.
//
// File path: <userData>/debug/last-system-prompt.txt
// Overwritten on every call.

export interface PromptMessage {
  role: string;
  content: string;
}

export interface PromptMeta {
  mode: string;
  model: string;
}

export function debugPromptPath(): string {
  return join(userDataDir(), "debug", "last-system-prompt.txt");
}

export function saveLastPrompt(
  messages: PromptMessage[],
  meta: PromptMeta,
): string {
  const path = debugPromptPath();
  const dir = join(userDataDir(), "debug");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const sysContent =
    messages.find((m) => m.role === "system")?.content ?? "";
  const hasGemmaMd = sysContent.includes("# Gemma");

  const sep = "=".repeat(80);
  const subSep = "-".repeat(80);

  const header = [
    `# Last prompt sent to the model`,
    `# Generated: ${new Date().toISOString()}`,
    `# Mode: ${meta.mode}`,
    `# Model: ${meta.model}`,
    `# Messages: ${messages.length}`,
    `# System prompt length: ${sysContent.length} chars`,
    `# Includes Gemma.md: ${hasGemmaMd ? "yes" : "NO"}`,
    "",
    sep,
    "FULL CONVERSATION",
    sep,
    "",
  ].join("\n");

  const body = messages
    .map(
      (m, i) =>
        `### Message ${i} — role: ${m.role} (${m.content.length} chars)\n${m.content}\n`,
    )
    .join(`\n${subSep}\n`);

  writeFileSync(path, header + body, "utf8");
  return path;
}
