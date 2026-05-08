import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Message from "../../../src/renderer/src/components/Message";
import type { ChatMessage } from "../../../src/shared/types";

function harnessMessage(
  harnessLabel: string,
  phase?: ChatMessage["phase"],
): ChatMessage {
  return {
    id: `harness-${harnessLabel}`,
    role: "harness",
    content: "Harness prompt body",
    createdAt: 1,
    harnessLabel,
    phase,
  };
}

function renderMessage(message: ChatMessage): string {
  return renderToStaticMarkup(
    createElement(Message, {
      message,
      isLast: false,
      streaming: false,
    }),
  );
}

describe("Message", () => {
  it("right-aligns planning harness prompts like user messages", () => {
    const prompts: Array<{
      label: string;
      phase?: ChatMessage["phase"];
    }> = [
      { label: "planning prompt", phase: "planning" },
      { label: "plan assembly", phase: "planning" },
      { label: "plan assembly retry", phase: "planning" },
      { label: "plan assembly validation", phase: "planning" },
      { label: "planning retry", phase: "planning" },
      { label: "plan step" },
      { label: "plan verify" },
    ];

    for (const prompt of prompts) {
      const html = renderMessage(harnessMessage(prompt.label, prompt.phase));

      expect(html).toContain('class="flex justify-end"');
      expect(html).toContain("rounded-br-md");
      expect(html).not.toContain("rounded-bl-md");
    }
  });

  it("keeps non-planning harness prompts left-aligned", () => {
    const html = renderMessage(harnessMessage("edit recovery"));

    expect(html).toContain('class="flex justify-start"');
    expect(html).toContain("rounded-bl-md");
    expect(html).not.toContain("rounded-br-md");
  });

  it("renders parented tool calls even when their plan node is not on the same message", () => {
    const html = renderMessage({
      id: "assistant-tool",
      role: "assistant",
      content: "",
      createdAt: 1,
      toolCalls: [
        {
          id: "call-1",
          name: "write_file",
          args: { path: "src/main/tools.ts", content: "file text" },
          parentStepId: "step-1",
          result: "Wrote src/main/tools.ts",
          running: false,
        },
      ],
    });

    expect(html).toContain("Writing");
    expect(html).toContain("src/main/tools.ts");
  });
});
