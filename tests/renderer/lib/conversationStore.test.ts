import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTO_PLANNING_SUMMARY_ID,
  buildMessageRenderItems,
  isClearCommand,
  readPersistedSelectedModel,
  pickStartupModel,
  pickLastWorkingDir,
  isModeLocked,
  hasSystemPromptSnapshot,
  hasConversationStarted,
  resolveConversationModel,
  shouldStartNewConversationForSelectedModel,
  stampConversationModelBeforeFirstPrompt,
  rewindToUserRequest,
  shouldDisplayConversationMessage,
  shouldSendConversationMessage,
  writePersistedSelectedModel,
  type PersistedConversationLite,
} from "../../../src/renderer/src/lib/conversationStore";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

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

  it("prefers the persisted selected model over conversation stamps", () => {
    expect(
      pickStartupModel(
        [
          conv({ id: "c1", model: "model-A" }),
          conv({ id: "c2", model: "model-B" }),
        ],
        "gemma-4-31b-it",
      ),
    ).toBe("gemma-4-31b-it");
  });

  it("falls back to stamped conversations when the persisted selected model is blank", () => {
    expect(
      pickStartupModel([conv({ id: "c1", model: "model-A" })], "  "),
    ).toBe("model-A");
  });
});

describe("persisted selected model", () => {
  it("stores and reads the last selected model", () => {
    const storage = new MemoryStorage();

    writePersistedSelectedModel(" gemma-4-31b-it ", storage);

    expect(readPersistedSelectedModel(storage)).toBe("gemma-4-31b-it");
  });

  it("returns null when the stored selected model is blank", () => {
    const storage = new MemoryStorage();
    storage.setItem("gemma-code:selected-model", "  ");

    expect(readPersistedSelectedModel(storage)).toBeNull();
  });
});

describe("pickLastWorkingDir", () => {
  it("returns null for an empty array", () => {
    expect(pickLastWorkingDir([])).toBeNull();
  });

  it("returns the first non-empty working directory", () => {
    expect(
      pickLastWorkingDir([
        conv({ id: "c1", workingDir: "" }),
        conv({ id: "c2", workingDir: "/tmp/project-a" }),
        conv({ id: "c3", workingDir: "/tmp/project-b" }),
      ]),
    ).toBe("/tmp/project-a");
  });
});

describe("isClearCommand", () => {
  it("matches /clear with surrounding whitespace", () => {
    expect(isClearCommand(" /clear\n")).toBe(true);
  });

  it("does not match other slash commands or text", () => {
    expect(isClearCommand("/clear now")).toBe(false);
    expect(isClearCommand("/reset")).toBe(false);
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

describe("hasConversationStarted", () => {
  it("returns false before the first prompt", () => {
    expect(hasConversationStarted(conv({ messages: [] }))).toBe(false);
  });

  it("ignores system and harness messages", () => {
    expect(
      hasConversationStarted(
        conv({
          messages: [
            { id: "s1", role: "system" },
            { id: "h1", role: "harness" },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("returns true after the first sendable message", () => {
    expect(
      hasConversationStarted(
        conv({ messages: [{ id: "u1", role: "user" }] }),
      ),
    ).toBe(true);
  });
});

describe("resolveConversationModel", () => {
  it("uses the stamped conversation model when it is available", () => {
    expect(
      resolveConversationModel(
        conv({ model: "gemma-4-31b-it" }),
        "mlx-community/gemma-4-e4b-it-4bit",
        ["gemma-4-31b-it"],
      ),
    ).toBe("gemma-4-31b-it");
  });

  it("falls back when the stamped model is not in the configured list", () => {
    expect(
      resolveConversationModel(
        conv({ model: "missing-model" }),
        "mlx-community/gemma-4-e4b-it-4bit",
        ["mlx-community/gemma-4-e4b-it-4bit"],
      ),
    ).toBe("mlx-community/gemma-4-e4b-it-4bit");
  });
});

describe("stampConversationModelBeforeFirstPrompt", () => {
  it("stamps an empty conversation with the selected model", () => {
    expect(
      stampConversationModelBeforeFirstPrompt(
        conv({ model: "mlx-community/gemma-4-e4b-it-4bit", messages: [] }),
        "north-mini-code-1-0",
      ),
    ).toMatchObject({ model: "north-mini-code-1-0" });
  });

  it("does not change a conversation after the first prompt", () => {
    expect(
      stampConversationModelBeforeFirstPrompt(
        conv({
          model: "mlx-community/gemma-4-e4b-it-4bit",
          messages: [{ id: "u1", role: "user" }],
        }),
        "north-mini-code-1-0",
      ),
    ).toMatchObject({ model: "mlx-community/gemma-4-e4b-it-4bit" });
  });
});

describe("shouldStartNewConversationForSelectedModel", () => {
  it("starts a new conversation when a selected model conflicts with a started conversation", () => {
    expect(
      shouldStartNewConversationForSelectedModel(
        conv({
          model: "mlx-community/gemma-4-e4b-it-4bit",
          messages: [{ id: "u1", role: "user" }],
        }),
        "north-mini-code-1-0",
      ),
    ).toBe(true);
  });

  it("does not start a new conversation for empty conversations", () => {
    expect(
      shouldStartNewConversationForSelectedModel(
        conv({ model: "mlx-community/gemma-4-e4b-it-4bit", messages: [] }),
        "north-mini-code-1-0",
      ),
    ).toBe(false);
  });

  it("does not start a new conversation when the started conversation already uses the selected model", () => {
    expect(
      shouldStartNewConversationForSelectedModel(
        conv({
          model: "north-mini-code-1-0",
          messages: [{ id: "u1", role: "user" }],
        }),
        "north-mini-code-1-0",
      ),
    ).toBe(false);
  });
});

describe("rewindToUserRequest", () => {
  it("returns the selected user request and the messages before it", () => {
    const messages = [
      {
        id: "u1",
        role: "user",
        content: "First",
        createdAt: 1,
      },
      {
        id: "a1",
        role: "assistant",
        content: "First response",
        createdAt: 2,
      },
      {
        id: "u2",
        role: "user",
        content: "Second",
        createdAt: 3,
      },
      {
        id: "a2",
        role: "assistant",
        content: "Second response",
        createdAt: 4,
      },
    ] as const;

    const rewind = rewindToUserRequest([...messages], "u2");

    expect(rewind?.request).toMatchObject({ id: "u2", content: "Second" });
    expect(rewind?.priorMessages.map((message) => message.id)).toEqual([
      "u1",
      "a1",
    ]);
  });

  it("returns null for assistant messages", () => {
    expect(
      rewindToUserRequest(
        [
          {
            id: "a1",
            role: "assistant",
            content: "Response",
            createdAt: 1,
          },
        ],
        "a1",
      ),
    ).toBeNull();
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
      "message",
      "planning-summary",
      "execution-separator",
      "message",
    ]);
    expect(items[0]).toMatchObject({
      kind: "message",
      message: { id: "u1" },
    });
    expect(items[1]).toMatchObject({
      kind: "planning-summary",
      messages: [{ id: "h1" }, { id: "a1" }],
    });
  });

  it("can expand a collapsed planning summary before the execution separator", () => {
    const items = buildMessageRenderItems(
      [
        message("u1", "user", "planning"),
        message("h1", "harness", "planning"),
        message("a1", "assistant", "planning"),
        message("a2", "assistant", "execution"),
      ],
      true,
      new Set([AUTO_PLANNING_SUMMARY_ID]),
    );

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "planning-summary",
      "message",
      "message",
      "execution-separator",
      "message",
    ]);
    expect(items[0]).toMatchObject({
      kind: "message",
      message: { id: "u1" },
    });
    expect(items[1]).toMatchObject({
      kind: "planning-summary",
      expanded: true,
    });
    expect(
      items
        .filter((item) => item.kind === "message")
        .map((item) => item.message.id),
    ).toEqual(["u1", "h1", "a1", "a2"]);
  });

  it("keeps the initial request visible without adding an empty planning summary", () => {
    const items = buildMessageRenderItems(
      [
        message("u1", "user", "planning"),
        message("a2", "assistant", "execution"),
      ],
      true,
    );

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "execution-separator",
      "message",
    ]);
    expect(items[0]).toMatchObject({
      kind: "message",
      message: { id: "u1" },
    });
  });

  it("wires the planning summary row as an expandable control", () => {
    const chatSource = readFileSync(
      join(process.cwd(), "src/renderer/src/components/Chat.tsx"),
      "utf8",
    );

    expect(chatSource).toContain("togglePlanningSummary");
    expect(chatSource).toContain("aria-expanded={expanded}");
    expect(chatSource).toContain("Show planning");
    expect(chatSource).toContain("Hide planning");
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

  it("wires structured plan review results into the proposal message", () => {
    const chatSource = readFileSync(
      join(process.cwd(), "src/renderer/src/components/Chat.tsx"),
      "utf8",
    );
    const messageSource = readFileSync(
      join(process.cwd(), "src/renderer/src/components/Message.tsx"),
      "utf8",
    );
    const sharedSource = readFileSync(
      join(process.cwd(), "src/shared/types.ts"),
      "utf8",
    );

    expect(sharedSource).toContain('type: "plan_reviewed"');
    expect(chatSource).toContain('chunk.type === "plan_reviewed"');
    expect(chatSource).toContain("planReview: chunk.review");
    expect(messageSource).toContain("PlanReviewView");
    expect(messageSource).toContain("aria-expanded");
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

  it("wires the execution logging toggle into chat requests", () => {
    const chatSource = readFileSync(
      join(process.cwd(), "src/renderer/src/components/Chat.tsx"),
      "utf8",
    );
    const preloadSource = readFileSync(
      join(process.cwd(), "src/preload/index.ts"),
      "utf8",
    );
    const mainSource = readFileSync(
      join(process.cwd(), "src/main/index.ts"),
      "utf8",
    );

    expect(chatSource).toContain("executionLogging");
    expect(chatSource).toContain("debugLogging: executionLogging");
    expect(chatSource).toContain("onToggleExecutionLogging");
    expect(chatSource).toContain("onOpenExecutionLog");
    expect(chatSource).toContain("Open execution log viewer");
    expect(chatSource).toContain("ExecutionLogViewer");
    expect(chatSource).toContain("Auto-scroll");
    expect(chatSource).toContain("readExecutionLog");
    expect(preloadSource).toContain("openExecutionLog");
    expect(preloadSource).toContain("readExecutionLog");
    expect(preloadSource).toContain("debug:open-execution-log");
    expect(preloadSource).toContain("debug:execution-log-read");
    expect(mainSource).toContain("debug:open-execution-log");
    expect(mainSource).toContain("debug:execution-log-read");
    expect(mainSource).toContain("ensureExecutionLogFile");
    expect(mainSource).toContain("readExecutionLogSnapshot");
    expect(mainSource).toContain("plan_blocked");
    expect(mainSource).toContain("plan_step_failed");
    expect(mainSource).toContain("plan_semantic_review_rejected");
    expect(mainSource).toContain("MAX_PLAN_SEMANTIC_REVIEW_RETRIES");
    expect(mainSource).toContain("step_evidence_check");
    expect(mainSource).toContain("step_evidence_reset");
    expect(mainSource).toContain("summarizePlanStepEvidence");
    expect(mainSource).toContain("forcedStepReason");
    expect(mainSource).toContain("forcedVerifyReason");
    expect(mainSource).toContain("isToolErrorResult(result)");
    expect(mainSource).toContain("args: found.args");
    expect(mainSource).toContain("output: result");
    expect(mainSource).toContain('status: hadError ? "error" : "ok"');
  });

  it("wires one-shot thinking plan generation into chat requests by default", () => {
    const chatSource = readFileSync(
      join(process.cwd(), "src/renderer/src/components/Chat.tsx"),
      "utf8",
    );
    const typeSource = readFileSync(
      join(process.cwd(), "src/shared/types.ts"),
      "utf8",
    );
    const mainSource = readFileSync(
      join(process.cwd(), "src/main/index.ts"),
      "utf8",
    );

    expect(typeSource).toContain("generatePlanInOneStepWhenThinking?: boolean");
    expect(chatSource).toContain("PLAN_ONE_SHOT_WHEN_THINKING_STORAGE_KEY");
    expect(chatSource).toContain("generatePlanInOneStepWhenThinking");
    expect(chatSource).toContain("!== \"false\"");
    expect(mainSource).toContain("completePlanInOneResponse");
    expect(mainSource).toContain("acceptCompletePlan");
    expect(mainSource).toContain("startValidatedPlanExecution");
    expect(mainSource).toContain('codeSubmode === "auto"');
    expect(mainSource).toContain('"freestyle"].includes');
  });

  it("wires last working directory reuse and clear command handling into Chat", () => {
    const chatSource = readFileSync(
      join(process.cwd(), "src/renderer/src/components/Chat.tsx"),
      "utf8",
    );

    expect(chatSource).toContain("LAST_WORKING_DIR_STORAGE_KEY");
    expect(chatSource).toContain("pickLastWorkingDir(conversations)");
    expect(chatSource).toContain("rememberWorkingDir(path)");
    expect(chatSource).toContain("isClearCommand(input)");
    expect(chatSource).toContain("clearActiveConversation");
    expect(chatSource).toContain("Change");
    expect(chatSource).toContain("chooseFolder: true");
  });

  it("wires conversation model locking into the Chat model picker", () => {
    const chatSource = readFileSync(
      join(process.cwd(), "src/renderer/src/components/Chat.tsx"),
      "utf8",
    );
    const appSource = readFileSync(
      join(process.cwd(), "src/renderer/src/App.tsx"),
      "utf8",
    );

    expect(chatSource).toContain(
      "const modelLocked = hasConversationStarted(activeConversation)",
    );
    expect(chatSource).toContain("model={activeModel}");
    expect(chatSource).toContain("modelLocked={modelLocked}");
    expect(chatSource).toContain("disabled={modelLocked}");
    expect(chatSource).toContain("if (modelLocked) return");
    expect(chatSource).toContain("stampActiveConversationModel(nextModel)");
    expect(chatSource).toContain("saveConversations(nextConversations)");
    expect(chatSource).toContain("writePersistedSelectedModel(nextModel)");
    expect(chatSource).toContain("initialConversationsForModel(model)");
    expect(appSource).toContain("model={state.toModel}");
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
