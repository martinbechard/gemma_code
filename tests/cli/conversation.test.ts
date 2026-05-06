import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  conversationPathFor,
  loadCliConversation,
  saveCliConversation,
} from "../../src/cli/conversation";

let tempRoot = "";

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = "";
  }
});

describe("CLI conversation persistence", () => {
  it("stores snapshots under .gemma-cli/conversations", () => {
    expect(conversationPathFor("/repo", "cli-123")).toBe(
      join("/repo", ".gemma-cli", "conversations", "cli-123.json"),
    );
  });

  it("round-trips a saved conversation", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "gemma-cli-conversation-"));
    const savedPath = saveCliConversation(tempRoot, {
      conversationId: "cli-123",
      mode: "code",
      model: "model",
      repoRoot: tempRoot,
      projectRoot: tempRoot,
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "hello" },
      ],
      planExecutionSystemPrompt: "execute",
    });

    const loaded = loadCliConversation(savedPath);

    expect(loaded.conversationId).toBe("cli-123");
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.planExecutionSystemPrompt).toBe("execute");
  });
});
