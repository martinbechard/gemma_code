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

function renderMessage(
  message: ChatMessage,
  handlers: {
    onRegenerate?: () => void;
    onExecutePlan?: () => void;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(Message, {
      message,
      isLast: false,
      streaming: false,
      ...handlers,
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

  it("keeps thinking after a tool call out of visible markdown", () => {
    const html = renderMessage({
      id: "assistant-thinking-tool",
      role: "assistant",
      content: [
        "<think>",
        "First private note before the tool.",
        "</think>",
        "<think>",
        "Second private note after the tool.",
        "</think>",
      ].join("\n"),
      createdAt: 1,
      toolCalls: [
        {
          id: "call-1",
          name: "read_file",
          args: { path: "src/main/tools/index.ts" },
          result: "File contents",
          running: false,
        },
      ],
    });

    expect(html).toContain("Thought process");
    expect(html).toContain("Reading");
    expect(html).toContain("src/main/tools/index.ts");
    expect(html).not.toContain("<think>");
    expect(html).not.toContain("&lt;think&gt;");
    expect(html).not.toContain("markdown-body");
  });

  it("renders timeline tool calls at the point they occur in visible text", () => {
    const beforeToolText = "I will confirm the live tool list now.";
    const afterToolText = "The requested tool is available.";
    const html = renderMessage({
      id: "assistant-visible-tool-order",
      role: "assistant",
      content: `${beforeToolText}\n\n${afterToolText}`,
      createdAt: 1,
      toolCalls: [
        {
          id: "call-1",
          name: "generate_uuid",
          args: {},
          result: "2f5cc4ec-a41c-491e-a978-7e60b1af03f1",
          running: false,
        },
      ],
      timeline: [
        {
          kind: "text",
          id: "text-1",
          content: beforeToolText,
        },
        {
          kind: "tool_call",
          toolCallId: "call-1",
        },
        {
          kind: "text",
          id: "text-2",
          content: afterToolText,
        },
      ],
    });

    const beforeToolIndex = html.indexOf(beforeToolText);
    const toolIndex = html.indexOf("generate_uuid");
    const afterToolIndex = html.indexOf(afterToolText);

    expect(beforeToolIndex).toBeGreaterThanOrEqual(0);
    expect(toolIndex).toBeGreaterThan(beforeToolIndex);
    expect(afterToolIndex).toBeGreaterThan(toolIndex);
  });

  it("renders separate thinking content without mixing it into markdown", () => {
    const html = renderMessage({
      id: "assistant-thinking-field",
      role: "assistant",
      content: '<action name="read_file"><path>src/main/tools/index.ts</path></action>',
      thinking: [
        "I should inspect the tool registry first.",
        "Then I can call the read_file tool.",
      ].join("\n"),
      createdAt: 1,
    });

    expect(html).toContain("Thought process");
    expect(html).not.toContain('<action name="read_file">');
    expect(html).not.toContain("&lt;action");
    expect(html).not.toContain("I should inspect the tool registry first.");
    expect(html).not.toContain("&lt;think&gt;");
  });

  it("hides incomplete action markup from visible markdown while streaming", () => {
    const html = renderMessage({
      id: "assistant-incomplete-action",
      role: "assistant",
      content: [
        "I will read the tool file now.",
        '<action name="read_file">',
        "<path>src/main/tools/uuid.ts</path>",
      ].join("\n"),
      createdAt: 1,
    });

    expect(html).toContain("I will read the tool file now.");
    expect(html).not.toContain('<action name="read_file">');
    expect(html).not.toContain("&lt;action");
    expect(html).not.toContain("src/main/tools/uuid.ts");
  });

  it("renders an expandable structured plan review bubble", () => {
    const html = renderMessage({
      id: "assistant-review",
      role: "assistant",
      content: "",
      createdAt: 1,
      planReview: {
        verdict: "needs_correction",
        summary: "The plan matches the request.",
        checklist: [
          {
            id: "request_fit",
            question: "Does the plan directly address the original request?",
            allowedAnswers: ["yes", "no", "partial"],
            answer: "yes",
            additionalInfo: "The steps all target the requested behavior.",
          },
        ],
      },
    });

    expect(html).toContain("Plan review");
    expect(html).toContain("The plan matches the request.");
    expect(html).toContain("Does the plan directly address");
    expect(html).toContain("The steps all target the requested behavior.");
    expect(html).toContain("aria-expanded");
  });

  it("shows regenerate for user request messages", () => {
    const html = renderMessage(
      {
        id: "user-request",
        role: "user",
        content: "Remove the CWD tool.",
        createdAt: 1,
      },
      {
        onRegenerate: () => undefined,
      },
    );

    expect(html).toContain("Remove the CWD tool.");
    expect(html).toContain("Regenerate");
  });

  it("does not show a plan-specific rerun button for failed plan executions", () => {
    const html = renderMessage({
      id: "assistant-plan",
      role: "assistant",
      content: "",
      createdAt: 1,
      phase: "execution",
      planNodes: [
        {
          id: "plan-1",
          kind: "plan",
          status: "failed",
        },
      ],
    });

    expect(html).not.toContain("Run Failed Plan Again");
  });

  it("collapses completed plan executions behind a done row", () => {
    const html = renderMessage({
      id: "assistant-plan",
      role: "assistant",
      content: "",
      createdAt: 1,
      phase: "execution",
      planNodes: [
        {
          id: "plan-1",
          kind: "plan",
          status: "ok",
        },
        {
          id: "step-1",
          kind: "step",
          parentId: "plan-1",
          name: "remove_tool",
          status: "ok",
          prompt: "Remove the CWD tool.",
        },
      ],
    });

    expect(html).toContain("Plan done");
    expect(html).toContain("aria-expanded=\"false\"");
    expect(html).not.toContain("Step: remove_tool");
  });

  it("does not show run again on an executed proposal", () => {
    const html = renderMessage(
      {
        id: "assistant-proposal",
        role: "assistant",
        content: "",
        createdAt: 1,
        proposedPlan: [
          {
            name: "remove_tool",
            prompt: "Remove the CWD tool.",
            verify: "The CWD tool is absent.",
          },
        ],
        planExecuted: true,
      },
      {
        onExecutePlan: () => undefined,
      },
    );

    expect(html).toContain("Plan approved");
    expect(html).not.toContain("Run Again");
    expect(html).not.toContain("Execute Plan");
  });
});
