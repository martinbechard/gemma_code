import type { ChatMessage, MessageTimelineItem, ToolCall } from "@shared/types";

const FIRST_TIMELINE_ITEM_NUMBER = 1;

export function appendReasoningToMessage(
  message: ChatMessage,
  text: string,
): ChatMessage {
  const timeline = [...(message.timeline ?? [])];
  const lastItem = timeline[timeline.length - 1];

  if (lastItem?.kind === "thinking") {
    timeline[timeline.length - 1] = {
      ...lastItem,
      content: lastItem.content + text,
    };
  } else {
    timeline.push({
      kind: "thinking",
      id: `thinking-${nextThinkingItemNumber(timeline)}`,
      content: text,
    });
  }

  return {
    ...message,
    thinking: (message.thinking ?? "") + text,
    thinkingInProgress: true,
    activity: { kind: "idle" },
    timeline,
  };
}

export function appendToolCallToMessage(
  message: ChatMessage,
  toolCall: ToolCall,
): ChatMessage {
  return {
    ...message,
    toolCalls: [...(message.toolCalls ?? []), toolCall],
    timeline: [
      ...(message.timeline ?? []),
      { kind: "tool_call", toolCallId: toolCall.id },
    ],
  };
}

function nextThinkingItemNumber(timeline: MessageTimelineItem[]): number {
  return (
    timeline.filter((item) => item.kind === "thinking").length +
    FIRST_TIMELINE_ITEM_NUMBER
  );
}
