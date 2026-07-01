// Renderer-only helpers for the conversation list persisted in localStorage.
// Pure picker / predicate functions are kept here so they can be unit-tested
// under tests/renderer/ without touching localStorage or the React tree.

import type { AgentMode } from "@shared/types";
import type { ChatMessage, SystemPromptSnapshot } from "@shared/types";

export const STORAGE_KEY = "gemma-code:conversations:v2";
export const LAST_WORKING_DIR_STORAGE_KEY = "gemma-code:last-working-dir";
export const SELECTED_MODEL_STORAGE_KEY = "gemma-code:selected-model";
export const CLEAR_COMMAND = "/clear";
export const AUTO_PLANNING_SUMMARY_ID = "auto-planning-summary";
const AUTO_EXECUTION_SEPARATOR_ID = "auto-execution-separator";
const NO_EXPANDED_PLANNING_SUMMARIES: ReadonlySet<string> = new Set();

interface PreferenceStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

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
  return message.role !== "system";
}

export function shouldSendConversationMessage(message: {
  role?: string;
}): boolean {
  return message.role !== "system" && message.role !== "harness";
}

export function hasSystemPromptSnapshot(
  messages: ChatMessage[],
  snapshot: SystemPromptSnapshot,
): boolean {
  return messages.some((message) =>
    message.systemPrompts?.some(
      (prompt) =>
        prompt.label === snapshot.label && prompt.content === snapshot.content,
    ),
  );
}

export interface RegenerateRequestRewind {
  request: ChatMessage;
  priorMessages: ChatMessage[];
}

export function rewindToUserRequest(
  messages: ChatMessage[],
  messageId: string,
): RegenerateRequestRewind | null {
  const messageIndex = messages.findIndex((message) => message.id === messageId);
  if (messageIndex < 0) return null;
  const request = messages[messageIndex];
  if (request.role !== "user") return null;
  return {
    request,
    priorMessages: messages.slice(0, messageIndex),
  };
}

// Returns the stamped model of the most-recent conversation in the persisted
// list, or null if no conversation has one. The list is treated as
// most-recent-first (matches Chat.tsx, which prepends new conversations).
// Empty-string models are treated as "not stamped".
export function pickStartupModel(
  convs: PersistedConversationLite[],
  selectedModel: string | null = null,
): string | null {
  const selected = selectedModel?.trim();
  if (selected) return selected;
  for (const c of convs) {
    if (typeof c.model === "string" && c.model.length > 0) return c.model;
  }
  return null;
}

export function hasConversationStarted(c: PersistedConversationLite): boolean {
  return (c.messages ?? []).some(shouldSendConversationMessage);
}

export function resolveConversationModel(
  c: PersistedConversationLite,
  fallbackModel: string,
  availableModelNames?: readonly string[],
): string {
  const stamped = c.model?.trim();
  if (!stamped) return fallbackModel;
  if (availableModelNames && !availableModelNames.includes(stamped)) {
    return fallbackModel;
  }
  return stamped;
}

function selectedModelStorage(): PreferenceStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readPersistedSelectedModel(
  storage: PreferenceStorage | undefined = selectedModelStorage(),
): string | null {
  try {
    const value = storage?.getItem(SELECTED_MODEL_STORAGE_KEY)?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}

export function writePersistedSelectedModel(
  model: string,
  storage: PreferenceStorage | undefined = selectedModelStorage(),
): void {
  const value = model.trim();
  if (!value) return;
  try {
    storage?.setItem(SELECTED_MODEL_STORAGE_KEY, value);
  } catch {
    // ignore
  }
}

export function pickLastWorkingDir(
  convs: PersistedConversationLite[],
): string | null {
  for (const c of convs) {
    if (typeof c.workingDir === "string" && c.workingDir.trim().length > 0) {
      return c.workingDir;
    }
  }
  return null;
}

export function isClearCommand(input: string): boolean {
  return input.trim() === CLEAR_COMMAND;
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
  return msgs.some(shouldSendConversationMessage);
}

export type MessageRenderItem =
  | { kind: "message"; message: ChatMessage }
  | {
      kind: "planning-summary";
      id: string;
      messages: ChatMessage[];
      expanded: boolean;
    }
  | { kind: "execution-separator"; id: string };

export function buildMessageRenderItems(
  messages: ChatMessage[],
  collapsePlanning: boolean,
  expandedPlanningSummaryIds: ReadonlySet<string> =
    NO_EXPANDED_PLANNING_SUMMARIES,
): MessageRenderItem[] {
  const visibleMessages = messages.filter(shouldDisplayConversationMessage);
  const hasExecution = visibleMessages.some(
    (message) => message.phase === "execution",
  );
  if (!collapsePlanning || !hasExecution) {
    return visibleMessages.map((message) => ({ kind: "message", message }));
  }

  const items: MessageRenderItem[] = [];
  const planningMessages: ChatMessage[] = [];
  let initialPlanningRequest: ChatMessage | null = null;
  let separatorInserted = false;

  for (const message of visibleMessages) {
    if (!separatorInserted && message.phase === "planning") {
      if (!initialPlanningRequest && message.role === "user") {
        initialPlanningRequest = message;
        continue;
      }
      planningMessages.push(message);
      continue;
    }

    if (!separatorInserted && message.phase === "execution") {
      if (initialPlanningRequest) {
        items.push({ kind: "message", message: initialPlanningRequest });
      }
      if (planningMessages.length > 0) {
        const expanded = expandedPlanningSummaryIds.has(
          AUTO_PLANNING_SUMMARY_ID,
        );
        items.push({
          kind: "planning-summary",
          id: AUTO_PLANNING_SUMMARY_ID,
          messages: planningMessages,
          expanded,
        });
        if (expanded) {
          items.push(
            ...planningMessages.map(
              (planningMessage): MessageRenderItem => ({
                kind: "message",
                message: planningMessage,
              }),
            ),
          );
        }
      }
      items.push({ kind: "execution-separator", id: AUTO_EXECUTION_SEPARATOR_ID });
      separatorInserted = true;
    }

    items.push({ kind: "message", message });
  }

  if (!separatorInserted) {
    return visibleMessages.map((message) => ({ kind: "message", message }));
  }

  return items;
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
