import { describe, expect, it } from "vitest";
import {
  executionLogDetails,
  executionLogSummary,
} from "../../../src/renderer/src/components/Chat";
import type { ExecutionLogEntry } from "../../../src/shared/types";

function entry(
  event: string,
  data: unknown,
  line = 1,
): ExecutionLogEntry {
  return {
    line,
    timestamp: "2026-05-29T23:05:00.000Z",
    conversationId: "c1",
    mode: "code",
    model: "gemma",
    event,
    data,
  };
}

describe("execution log summaries", () => {
  it("summarizes model requests using the latest message preview", () => {
    const logEntry = entry("model_request", {
      promptPath: "/tmp/last-system-prompt.txt",
      messageCount: 3,
      messages: [
        {
          index: 1,
          role: "system",
          chars: 12,
          preview: "System prompt",
        },
        {
          index: 3,
          role: "user",
          chars: 42,
          preview: "Execute step Remove_Tool now.",
        },
      ],
    });

    expect(executionLogSummary(logEntry)).toContain(
      "3 messages · last user: Execute step Remove_Tool now.",
    );
    expect(executionLogDetails(logEntry)).toContain("messages:\n  1. system");
    expect(executionLogDetails(logEntry)).toContain(
      "  3. user (42 chars)\n     Execute step Remove_Tool now.",
    );
  });

  it("summarizes stream chunk activity with useful state", () => {
    expect(
      executionLogSummary(
        entry("stream_chunk", {
          type: "activity",
          activity: {
            kind: "runtime",
            label: "waiting for first token",
            detail: "Gemma",
          },
        }),
      ),
    ).toBe("activity runtime waiting for first token Gemma");
  });

  it("summarizes plan stream chunks with status and reason", () => {
    expect(
      executionLogSummary(
        entry("stream_chunk", {
          type: "plan_node_end",
          kind: "verify",
          status: "failed",
          reason: "missing mutation evidence",
        }),
      ),
    ).toBe("end verify failed missing mutation evidence");
  });
});
