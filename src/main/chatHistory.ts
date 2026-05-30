import type { ChatRequest } from "../shared/types";
import type { MLXChatMessage } from "./mlx";

const TOOL_RESULT_STATUS_OK = "ok";
const TOOL_RESULT_STATUS_ERROR = "error";
const READ_FILE_TOOL_NAME = "read_file";
const CURRENT_FILE_LINE_RE = /^Current file: (.+)$/m;
const TOOL_RESULT_ERROR_RE =
  /^(Error\b|Error reading|Error editing|Error writing|Error deleting|Error fetching)/i;

export interface AppendToolResultMessageInput {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  hadError: boolean;
}

export interface ReplayRequestMessagesInput extends ChatRequest {
  planningTaskMessageIndex?: number;
}

export function replayRequestMessages(
  req: ReplayRequestMessagesInput,
): MLXChatMessage[] {
  if (req.executePlan) return [];

  const planningTaskMessageIndex = req.planningTaskMessageIndex ?? -1;
  const latestReadResultKeys = latestReadResultKeysFor(
    req.messages,
    planningTaskMessageIndex,
  );
  const replayedMessages: MLXChatMessage[] = [];

  for (const [messageIndex, message] of req.messages.entries()) {
    if (message.role === "system") continue;
    if (messageIndex === planningTaskMessageIndex) continue;

    const messageRole = message.role === "harness" ? "user" : message.role;
    replayedMessages.push({
      role: messageRole as MLXChatMessage["role"],
      content: message.content,
    });

    for (const [toolCallIndex, toolCall] of (
      message.toolCalls ?? []
    ).entries()) {
      if (toolCall.result == null) continue;
      if (
        isReadFileToolCall(toolCall.name) &&
        !latestReadResultKeys.has(readResultKey(messageIndex, toolCallIndex))
      ) {
        continue;
      }
      replayedMessages.push({
        role: "user",
        content: formatToolResultMessage(
          toolCall.name,
          toolCall.result,
          false,
        ),
      });
    }
  }

  return replayedMessages;
}

export function appendToolResultMessage(
  messages: MLXChatMessage[],
  input: AppendToolResultMessageInput,
): void {
  const path =
    !input.hadError && isReadFileToolCall(input.toolName)
      ? readFileToolPath(input.args)
      : null;
  if (path) {
    removeReadResultMessagesForPath(messages, path);
  }
  messages.push({
    role: "user",
    content: formatToolResultMessage(
      input.toolName,
      input.result,
      input.hadError,
    ),
  });
}

export function formatToolResultMessage(
  toolName: string,
  result: string,
  hadError: boolean,
): string {
  return `[${hadError ? TOOL_RESULT_STATUS_ERROR : TOOL_RESULT_STATUS_OK}] ${toolName} tool result:\n${result}`;
}

function latestReadResultKeysFor(
  messages: ChatRequest["messages"],
  planningTaskMessageIndex: number,
): Set<string> {
  const latestByPath = new Map<string, string>();
  for (const [messageIndex, message] of messages.entries()) {
    if (message.role === "system") continue;
    if (messageIndex === planningTaskMessageIndex) continue;
    for (const [toolCallIndex, toolCall] of (
      message.toolCalls ?? []
    ).entries()) {
      if (!isUsableReadFileToolCall(toolCall)) continue;
      const path = readFileToolPath(toolCall.args);
      if (!path) continue;
      latestByPath.set(path, readResultKey(messageIndex, toolCallIndex));
    }
  }
  return new Set(latestByPath.values());
}

function isUsableReadFileToolCall(
  toolCall: NonNullable<ChatRequest["messages"][number]["toolCalls"]>[number],
): boolean {
  return (
    isReadFileToolCall(toolCall.name) &&
    typeof toolCall.result === "string" &&
    !TOOL_RESULT_ERROR_RE.test(toolCall.result.trimStart())
  );
}

function isReadFileToolCall(toolName: string): boolean {
  return toolName === READ_FILE_TOOL_NAME;
}

function readFileToolPath(args: Record<string, unknown>): string | null {
  const path = args.path;
  if (typeof path !== "string") return null;
  const trimmed = path.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readResultKey(messageIndex: number, toolCallIndex: number): string {
  return `${messageIndex}:${toolCallIndex}`;
}

function removeReadResultMessagesForPath(
  messages: MLXChatMessage[],
  path: string,
): void {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    if (readResultPathFromContent(message.content) !== path) continue;
    messages.splice(index, 1);
  }
}

function readResultPathFromContent(content: string): string | null {
  if (
    !content.startsWith(
      `[${TOOL_RESULT_STATUS_OK}] ${READ_FILE_TOOL_NAME} tool result:\n`,
    )
  ) {
    return null;
  }
  const currentFileMatch = content.match(CURRENT_FILE_LINE_RE);
  return currentFileMatch?.[1]?.trim() || null;
}
