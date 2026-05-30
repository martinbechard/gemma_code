import type { ChatRequest } from "../shared/types";
import type { MLXChatMessage } from "./mlx";

const TOOL_RESULT_STATUS_OK = "ok";
const TOOL_RESULT_STATUS_ERROR = "error";
const READ_FILE_TOOL_NAME = "read_file";
const FILE_CONTEXT_TOOL_NAMES = new Set([
  READ_FILE_TOOL_NAME,
  "edit_file",
  "write_file",
]);
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
  const latestFileContextResultKeys = latestFileContextResultKeysFor(
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
        isFileContextToolCall(toolCall) &&
        !latestFileContextResultKeys.has(resultKey(messageIndex, toolCallIndex))
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
  const path = !input.hadError ? fileContextPath(input.toolName, input.args) : null;
  if (path) {
    removeFileContextMessagesForPath(messages, path);
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

function latestFileContextResultKeysFor(
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
      if (!isUsableFileContextToolCall(toolCall)) continue;
      const path = fileContextToolCallPath(toolCall);
      if (!path) continue;
      latestByPath.set(path, resultKey(messageIndex, toolCallIndex));
    }
  }
  return new Set(latestByPath.values());
}

function isUsableFileContextToolCall(
  toolCall: NonNullable<ChatRequest["messages"][number]["toolCalls"]>[number],
): boolean {
  return (
    isFileContextToolCall(toolCall) &&
    typeof toolCall.result === "string" &&
    !TOOL_RESULT_ERROR_RE.test(toolCall.result.trimStart())
  );
}

function isFileContextToolCall(
  toolCall: NonNullable<ChatRequest["messages"][number]["toolCalls"]>[number],
): boolean {
  return fileContextToolCallPath(toolCall) !== null;
}

function fileContextToolCallPath(
  toolCall: NonNullable<ChatRequest["messages"][number]["toolCalls"]>[number],
): string | null {
  if (!FILE_CONTEXT_TOOL_NAMES.has(toolCall.name)) return null;
  if (
    toolCall.name !== READ_FILE_TOOL_NAME &&
    typeof toolCall.result === "string" &&
    !CURRENT_FILE_LINE_RE.test(toolCall.result)
  ) {
    return null;
  }
  return fileContextPath(toolCall.name, toolCall.args);
}

function fileContextPath(
  toolName: string,
  args: Record<string, unknown>,
): string | null {
  if (!FILE_CONTEXT_TOOL_NAMES.has(toolName)) return null;
  const path = args.path;
  if (typeof path !== "string") return null;
  const trimmed = path.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resultKey(messageIndex: number, toolCallIndex: number): string {
  return `${messageIndex}:${toolCallIndex}`;
}

function removeFileContextMessagesForPath(
  messages: MLXChatMessage[],
  path: string,
): void {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    if (fileContextPathFromContent(message.content) !== path) continue;
    messages.splice(index, 1);
  }
}

function fileContextPathFromContent(content: string): string | null {
  if (!content.startsWith(`[${TOOL_RESULT_STATUS_OK}] `)) return null;
  const currentFileMatch = content.match(CURRENT_FILE_LINE_RE);
  return currentFileMatch?.[1]?.trim() || null;
}
