import { describe, it, expect } from "vitest";
import {
  pickStartupModel,
  isModeLocked,
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
