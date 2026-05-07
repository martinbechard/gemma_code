import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildMessageRenderItems,
  pickStartupModel,
  isModeLocked,
  hasSystemPromptSnapshot,
  shouldDisplayConversationMessage,
  shouldSendConversationMessage,
  type PersistedConversationLite,
} from "../../../src/renderer/src/lib/conversationStore";

function conv(
  partial: Partial<PersistedConversationLite> = {},
): PersistedConversationLite {
  return {
    id: partial.id ?? "c1",
    mode: partial.mode ?? "chat",
    workingDir: partial.workingDir,
    model: partial.model,
    messages: partial.messages ?? [],
  };
}

describe("pickStartupModel", () => {
  it("returns null for an empty array", () => {
    expect(pickStartupModel([])).toBeNull();
  });

  it("returns null when no conversation has a stamped model", () => {
    expect(pickStartupModel([conv(), conv({ id: "c2" })])).toBeNull();
  });

  it("returns the model of the first conversation that has one", () => {
    expect(
      pickStartupModel([
        conv({ id: "c1", model: "model-A" }),
        conv({ id: "c2", model: "model-B" }),
      ]),
    ).toBe("model-A");
  });

  it("skips conversations without a model and finds the next stamped one", () => {
    expect(
      pickStartupModel([
        conv({ id: "c1" }),
        conv({ id: "c2", model: "model-B" }),
        conv({ id: "c3", model: "model-C" }),
      ]),
    ).toBe("model-B");
  });

  it("treats empty-string model as not-stamped", () => {
    expect(
      pickStartupModel([
        conv({ id: "c1", model: "" }),
        conv({ id: "c2", model: "model-B" }),
      ]),
    ).toBe("model-B");
  });
});

describe("isModeLocked", () => {
  it("returns false for a chat-mode conversation", () => {
    expect(
      isModeLocked(conv({ mode: "chat", messages: [{ id: "m1" }] })),
    ).toBe(false);
  });

  it("returns false for a Build conversation (code mode, no workingDir)", () => {
    expect(
      isModeLocked(
        conv({ mode: "code", workingDir: undefined, messages: [{ id: "m1" }] }),
      ),
    ).toBe(false);
  });

  it("returns false for a Code conversation with no messages yet", () => {
    expect(
      isModeLocked(
        conv({ mode: "code", workingDir: "/tmp/proj", messages: [] }),
      ),
    ).toBe(false);
  });

  it("ignores visible prompt messages when deciding whether Code is locked", () => {
    expect(
      isModeLocked(
        conv({
          mode: "code",
          workingDir: "/tmp/proj",
          messages: [
            { id: "s1", role: "system" },
            { id: "h1", role: "harness" },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("returns true once a Code conversation has at least one message", () => {
    expect(
      isModeLocked(
        conv({
          mode: "code",
          workingDir: "/tmp/proj",
          messages: [{ id: "m1" }],
        }),
      ),
    ).toBe(true);
  });
});

describe("prompt display helpers", () => {
  it("shows harness prompt messages while keeping system messages hidden", () => {
    expect(shouldDisplayConversationMessage({ role: "system" })).toBe(false);
    expect(shouldDisplayConversationMessage({ role: "harness" })).toBe(true);
    expect(shouldDisplayConversationMessage({ role: "user" })).toBe(true);
    expect(shouldDisplayConversationMessage({ role: "assistant" })).toBe(true);
  });

  it("keeps harness prompt messages out of model request history", () => {
    expect(shouldSendConversationMessage({ role: "system" })).toBe(false);
    expect(shouldSendConversationMessage({ role: "harness" })).toBe(false);
    expect(shouldSendConversationMessage({ role: "user" })).toBe(true);
    expect(shouldSendConversationMessage({ role: "assistant" })).toBe(true);
  });

  it("renders planning messages normally when auto execution is not collapsing", () => {
    const items = buildMessageRenderItems(
      [
        message("u1", "user", "planning"),
        message("h1", "harness", "planning"),
        message("a1", "assistant", "planning"),
      ],
      false,
    );

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "message",
      "message",
    ]);
  });

  it("collapses planning before execution and inserts a separator", () => {
    const items = buildMessageRenderItems(
      [
        message("u1", "user", "planning"),
        message("h1", "harness", "planning"),
        message("a1", "assistant", "planning"),
        message("a2", "assistant", "execution"),
      ],
      true,
    );

    expect(items.map((item) => item.kind)).toEqual([
      "planning-summary",
      "execution-separator",
      "message",
    ]);
    expect(items[0]).toMatchObject({
      kind: "planning-summary",
      messages: [{ id: "u1" }, { id: "h1" }, { id: "a1" }],
    });
  });

  it("does not keep a live prompt-loaded marker in UI or CLI source", () => {
    for (const path of [
      "src/renderer/src/components/Chat.tsx",
      "src/shared/types.ts",
      "src/cli/agent.ts",
      "Gemma.md",
    ]) {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      expect(source).not.toContain("Loaded: Gemma project instructions");
    }
  });

  it("keeps the system prompt debug bubble renderer wired", () => {
    const messageSource = readFileSync(
      join(process.cwd(), "src/renderer/src/components/Message.tsx"),
      "utf8",
    );
    const mainSource = readFileSync(
      join(process.cwd(), "src/main/index.ts"),
      "utf8",
    );

    expect(messageSource).toContain("SystemPromptView");
    expect(messageSource).toContain("System prompt:");
    expect(mainSource).toContain('type: "system_prompt"');
    expect(
      readFileSync(
        join(process.cwd(), "src/renderer/src/components/Chat.tsx"),
        "utf8",
      ),
    ).toContain("hasSystemPromptSnapshot");
  });

  it("keeps plan-step tool calls visible outside collapsed prompt details", () => {
    const messageSource = readFileSync(
      join(process.cwd(), "src/renderer/src/components/Message.tsx"),
      "utf8",
    );

    expect(messageSource).toContain(
      "Tool calls stay outside showDetails so repeated actions remain separate timeline bubbles.",
    );
  });

  it("recognizes duplicate system prompt snapshots across assistant messages", () => {
    expect(
      hasSystemPromptSnapshot(
        [
          {
            id: "m1",
            role: "assistant",
            content: "",
            createdAt: 1,
            systemPrompts: [{ label: "code discuss", content: "prompt body" }],
          },
          {
            id: "m2",
            role: "assistant",
            content: "",
            createdAt: 2,
          },
        ],
        { label: "code discuss", content: "prompt body" },
      ),
    ).toBe(true);
  });
});

function message(
  id: string,
  role: "user" | "assistant" | "harness",
  phase?: "planning" | "execution",
) {
  return {
    id,
    role,
    content: id,
    createdAt: 1,
    phase,
  };
}
