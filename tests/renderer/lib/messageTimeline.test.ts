import { describe, expect, it } from "vitest";
import type { ChatMessage, ToolCall } from "../../../src/shared/types";
import {
  appendReasoningToMessage,
  appendToolCallToMessage,
} from "../../../src/renderer/src/lib/messageTimeline";

const CREATED_AT = 1;

function assistant(partial: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: partial.id ?? "a1",
    role: "assistant",
    content: partial.content ?? "",
    createdAt: partial.createdAt ?? CREATED_AT,
    ...partial,
  };
}

function toolCall(partial: Partial<ToolCall> = {}): ToolCall {
  return {
    id: partial.id ?? "tc1",
    name: partial.name ?? "read_file",
    args: partial.args ?? { path: "src/main/index.ts" },
    ...partial,
  };
}

describe("message timeline", () => {
  it("starts a fresh thinking item when reasoning arrives after a tool call", () => {
    const firstReasoning = appendReasoningToMessage(assistant(), "Before action.");
    const withTool = appendToolCallToMessage(firstReasoning, toolCall());
    const afterToolReasoning = appendReasoningToMessage(withTool, "After action.");

    expect(afterToolReasoning.timeline).toEqual([
      { kind: "thinking", id: "thinking-1", content: "Before action." },
      { kind: "tool_call", toolCallId: "tc1" },
      { kind: "thinking", id: "thinking-2", content: "After action." },
    ]);
    expect(afterToolReasoning.thinking).toBe("Before action.After action.");
  });
});
