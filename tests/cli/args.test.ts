import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../../src/cli/args";

describe("parseCliArgs", () => {
  it("parses execute-plan with a plan file and prompt", () => {
    const parsed = parseCliArgs([
      "node",
      "cli",
      "execute-plan",
      "--worktree",
      "--plan",
      "plan.xml",
      "build the tool",
    ]);

    expect(parsed).toMatchObject({
      command: "execute-plan",
      worktree: true,
      planPath: "plan.xml",
      prompt: "build the tool",
    });
  });

  it("parses continue with a conversation file and prompt", () => {
    const parsed = parseCliArgs([
      "node",
      "cli",
      "continue",
      "--conversation",
      ".gemma-cli/conversations/cli-1.json",
      "recap requirements",
    ]);

    expect(parsed).toMatchObject({
      command: "continue",
      conversationPath: ".gemma-cli/conversations/cli-1.json",
      prompt: "recap requirements",
    });
  });

  it("rejects execute-plan without a plan file", () => {
    expect(() =>
      parseCliArgs(["node", "cli", "execute-plan", "build the tool"]),
    ).toThrow("plan file required");
  });
});
