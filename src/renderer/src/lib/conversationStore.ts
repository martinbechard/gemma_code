// Renderer-only helpers for the conversation list persisted in localStorage.
// Pure picker / predicate functions are kept here so they can be unit-tested
// under tests/renderer/ without touching localStorage or the React tree.

import type { AgentMode } from "@shared/types";

export const STORAGE_KEY = "gemma-chat:conversations:v2";

// Minimal shape this module needs from a persisted conversation. Components
// pass the full Conversation type at runtime; the lite shape exists so tests
// don't have to construct ChatMessage objects.
export interface PersistedConversationLite {
  id: string;
  mode: AgentMode;
  workingDir?: string;
  model?: string;
  messages?: Array<{ id?: string; role?: string }>;
}

export function shouldDisplayConversationMessage(message: {
  role?: string;
}): boolean {
  return message.role !== "system" && message.role !== "harness";
}

// Returns the stamped model of the most-recent conversation in the persisted
// list, or null if no conversation has one. The list is treated as
// most-recent-first (matches Chat.tsx, which prepends new conversations).
// Empty-string models are treated as "not stamped".
export function pickStartupModel(
  convs: PersistedConversationLite[],
): string | null {
  for (const c of convs) {
    if (typeof c.model === "string" && c.model.length > 0) return c.model;
  }
  return null;
}

// True once a conversation is "started" in Code mode: mode==='code', a
// workingDir is set (distinguishing Code from Build), and at least one
// message has been exchanged. Once locked, switching to chat or build would
// orphan the user's working directory and swap out the sandbox underneath
// the agent — the UI prevents that change.
export function isModeLocked(c: PersistedConversationLite): boolean {
  if (c.mode !== "code") return false;
  if (!c.workingDir) return false;
  const msgs = c.messages ?? [];
  return msgs.some(shouldDisplayConversationMessage);
}

// Reads the persisted conversation list from localStorage. Returns [] on
// miss or parse error so callers can treat it as "no preference yet".
export function readPersistedConversations(): PersistedConversationLite[] {
  try {
    const raw =
      typeof localStorage === "undefined"
        ? null
        : localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as PersistedConversationLite[];
  } catch {
    return [];
  }
}
