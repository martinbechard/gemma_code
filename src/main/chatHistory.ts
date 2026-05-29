import type { ChatRequest } from "../shared/types";
import type { MLXChatMessage } from "./mlx";

export interface ReplayRequestMessagesInput extends ChatRequest {
  planningTaskMessageIndex?: number;
}

export function replayRequestMessages(
  req: ReplayRequestMessagesInput,
): MLXChatMessage[] {
  if (req.executePlan) return [];

  const planningTaskMessageIndex = req.planningTaskMessageIndex ?? -1;
  const replayedMessages: MLXChatMessage[] = [];

  for (const [messageIndex, message] of req.messages.entries()) {
    if (message.role === "system") continue;
    if (messageIndex === planningTaskMessageIndex) continue;

    const messageRole = message.role === "harness" ? "user" : message.role;
    replayedMessages.push({
      role: messageRole as MLXChatMessage["role"],
      content: message.content,
    });

    for (const toolCall of message.toolCalls ?? []) {
      if (toolCall.result == null) continue;
      replayedMessages.push({
        role: "user",
        content: `[ok] ${toolCall.name} tool result:\n${toolCall.result}`,
      });
    }
  }

  return replayedMessages;
}
