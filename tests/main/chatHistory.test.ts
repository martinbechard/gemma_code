import { describe, expect, it } from "vitest";
import { replayRequestMessages } from "../../src/main/chatHistory";
import type { ChatRequest } from "../../src/shared/types";

const COMMON_REQUEST = {
  conversationId: "conversation",
  model: "model",
  enableTools: true,
  mode: "code",
} satisfies Omit<ChatRequest, "messages">;

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
});
