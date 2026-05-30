import { describe, expect, it } from "vitest";
import {
  appendToolResultMessage,
  replayRequestMessages,
} from "../../src/main/chatHistory";
import type { ChatRequest } from "../../src/shared/types";

const COMMON_REQUEST = {
  conversationId: "conversation",
  model: "model",
  enableTools: true,
  mode: "code",
} satisfies Omit<ChatRequest, "messages">;
const OLD_READ_RESULT = "old file content";
const NEW_READ_RESULT = "new file content";
const OTHER_READ_RESULT = "other file content";
const READ_PATH = "src/main/tools.ts";

describe("replayRequestMessages", () => {
  it("drops prior conversation messages when starting approved plan execution", () => {
    const messages: ChatRequest["messages"] = [
      { role: "user", content: "Please plan the change" },
      {
        role: "assistant",
        content: "plan:\n  steps:\n    - name: explore\n      prompt: Read files\n      verify: Files were read",
      toolCalls: [
        {
          id: "call-1",
          name: "read_file",
          args: { path: "src/main/tools.ts" },
          result: "old context",
        },
      ],
    },
    ];

    const replayed = replayRequestMessages({
      ...COMMON_REQUEST,
      messages,
      executePlan: true,
    });

    expect(replayed).toEqual([]);
  });

  it("keeps normal request history and skips the active planning task", () => {
    const messages: ChatRequest["messages"] = [
      { role: "user", content: "Earlier context" },
      {
        role: "assistant",
        content: "I read it",
        toolCalls: [
          {
            id: "call-1",
            name: "read_file",
            args: { path: "Gemma.plan.md" },
            result: "plan instructions",
          },
        ],
      },
      { role: "harness", content: "Synthetic instruction" },
      { role: "user", content: "Current planning request" },
    ];

    const replayed = replayRequestMessages({
      ...COMMON_REQUEST,
      messages,
      planningTaskMessageIndex: 3,
    });

    expect(replayed).toEqual([
      { role: "user", content: "Earlier context" },
      { role: "assistant", content: "I read it" },
      {
        role: "user",
        content: "[ok] read_file tool result:\nplan instructions",
      },
      { role: "user", content: "Synthetic instruction" },
    ]);
  });

  it("keeps only the latest read result for each file path", () => {
    const messages: ChatRequest["messages"] = [
      { role: "user", content: "Read the file" },
      {
        role: "assistant",
        content:
          '<action name="read_file">\n<path>src/main/tools.ts</path>\n</action>',
        toolCalls: [
          {
            id: "call-1",
            name: "read_file",
            args: { path: "src/main/tools.ts" },
            result: OLD_READ_RESULT,
          },
        ],
      },
      { role: "user", content: "Read it again and another file" },
      {
        role: "assistant",
        content: "I read the files",
        toolCalls: [
          {
            id: "call-2",
            name: "read_file",
            args: { path: "src/main/tools.ts" },
            result: NEW_READ_RESULT,
          },
          {
            id: "call-3",
            name: "read_file",
            args: { path: "src/main/index.ts" },
            result: OTHER_READ_RESULT,
          },
        ],
      },
    ];

    const replayed = replayRequestMessages({
      ...COMMON_REQUEST,
      messages,
    });
    const replayedText = replayed.map((message) => message.content).join("\n");

    expect(replayedText).not.toContain(OLD_READ_RESULT);
    expect(replayedText).toContain(NEW_READ_RESULT);
    expect(replayedText).toContain(OTHER_READ_RESULT);
  });

  it("keeps only the latest refreshed file context across reads and edits", () => {
    const messages: ChatRequest["messages"] = [
      { role: "user", content: "Read and edit the file" },
      {
        role: "assistant",
        content: "I read it",
        toolCalls: [
          {
            id: "call-1",
            name: "read_file",
            args: { path: READ_PATH },
            result: [
              "Files in context:",
              `- ${READ_PATH}`,
              "",
              `Current file: ${READ_PATH}`,
              OLD_READ_RESULT,
            ].join("\n"),
          },
        ],
      },
      {
        role: "assistant",
        content: "I edited it",
        toolCalls: [
          {
            id: "call-2",
            name: "edit_file",
            args: { path: READ_PATH },
            result: [
              `Edited ${READ_PATH} (1 replacement).`,
              "",
              "Files in context:",
              `- ${READ_PATH}`,
              "",
              `Current file: ${READ_PATH}`,
              NEW_READ_RESULT,
            ].join("\n"),
          },
        ],
      },
    ];

    const replayed = replayRequestMessages({
      ...COMMON_REQUEST,
      messages,
    });
    const replayedText = replayed.map((message) => message.content).join("\n");

    expect(replayedText).not.toContain(OLD_READ_RESULT);
    expect(replayedText).toContain(NEW_READ_RESULT);
  });

  it("removes an earlier read result when a newer read for the same path is appended", () => {
    const messages = [
      {
        role: "assistant" as const,
        content:
          '<action name="read_file">\n<path>src/main/tools.ts</path>\n</action>',
      },
    ];

    appendToolResultMessage(messages, {
      toolName: "read_file",
      args: { path: READ_PATH },
      result: [
        "Files in context:",
        `- ${READ_PATH}`,
        "",
        `Current file: ${READ_PATH}`,
        OLD_READ_RESULT,
      ].join("\n"),
      hadError: false,
    });
    appendToolResultMessage(messages, {
      toolName: "read_file",
      args: { path: READ_PATH },
      result: [
        "Files in context:",
        `- ${READ_PATH}`,
        "",
        `Current file: ${READ_PATH}`,
        NEW_READ_RESULT,
      ].join("\n"),
      hadError: false,
    });

    const replayedText = messages.map((message) => message.content).join("\n");

    expect(replayedText).not.toContain(OLD_READ_RESULT);
    expect(replayedText).toContain(NEW_READ_RESULT);
  });

  it("removes earlier file context when an edit result refreshes the same path", () => {
    const messages = [
      {
        role: "assistant" as const,
        content:
          '<action name="read_file">\n<path>src/main/tools.ts</path>\n</action>',
      },
    ];

    appendToolResultMessage(messages, {
      toolName: "read_file",
      args: { path: READ_PATH },
      result: [
        "Files in context:",
        `- ${READ_PATH}`,
        "",
        `Current file: ${READ_PATH}`,
        OLD_READ_RESULT,
      ].join("\n"),
      hadError: false,
    });
    appendToolResultMessage(messages, {
      toolName: "edit_file",
      args: { path: READ_PATH },
      result: [
        `Edited ${READ_PATH} (1 replacement).`,
        "",
        "Files in context:",
        `- ${READ_PATH}`,
        "",
        `Current file: ${READ_PATH}`,
        NEW_READ_RESULT,
      ].join("\n"),
      hadError: false,
    });

    const replayedText = messages.map((message) => message.content).join("\n");

    expect(replayedText).not.toContain(OLD_READ_RESULT);
    expect(replayedText).toContain(NEW_READ_RESULT);
  });
});
