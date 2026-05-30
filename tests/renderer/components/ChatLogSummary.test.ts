import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ExecutionLogEntryDetails,
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
      newMessageCount: 1,
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
      newMessages: [
        {
          index: 3,
          role: "user",
          chars: 42,
          preview: "Execute step Remove_Tool now.",
        },
      ],
    });

    expect(executionLogSummary(logEntry)).toContain(
      "3 messages | 1 new | latest user: Execute step Remove_Tool now.",
    );
    expect(executionLogDetails(logEntry)).toContain("messages:\n  1. system");
    expect(executionLogDetails(logEntry)).toContain(
      "  3. user (42 chars)\n     Execute step Remove_Tool now.",
    );
  });

  it("renders a model request message toggle", () => {
    const logEntry = entry("model_request", {
      promptPath: "/tmp/last-system-prompt.txt",
      requestSource: "conversation",
      messageCount: 46,
      newMessageCount: 2,
      messages: Array.from({ length: 46 }, (_, index) => ({
        index: index + 1,
        role: index === 0 ? "system" : "user",
        chars: 20,
        preview:
          index === 45 ? "Latest harness prompt" : `Message ${index + 1}`,
      })),
      newMessages: [
        {
          index: 46,
          role: "user",
          chars: 20,
          preview: "Latest harness prompt",
        },
      ],
    });

    const html = renderToStaticMarkup(
      createElement(ExecutionLogEntryDetails, { entry: logEntry }),
    );

    expect(html).toContain("Model request context");
    expect(html).toContain("Snapshot file is overwritten each request");
    expect(html).toContain("Show all 46 messages");
    expect(html).toContain("source: conversation");
    expect(html).toContain("added: 2");
    expect(html).toContain("Tool calls appear as separate tool_call");
    expect(html).toContain("hidden user message beginning with [ok] or [error]");
    expect(html).toContain("Latest harness prompt");
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
