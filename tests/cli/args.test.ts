import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../../src/cli/args";

describe("parseCliArgs", () => {
  it("parses plan with worktree and prompt", () => {
    const parsed = parseCliArgs([
      "node",
      "cli",
      "plan",
      "--worktree",
      "build the tool plan",
    ]);

    expect(parsed).toMatchObject({
      command: "plan",
      worktree: true,
      prompt: "build the tool plan",
    });
  });

  it("parses plan-ask-done with worktree and prompt", () => {
    const parsed = parseCliArgs([
      "node",
      "cli",
      "plan-ask-done",
      "--worktree",
      "build the tool plan",
    ]);

    expect(parsed).toMatchObject({
      command: "plan-ask-done",
      worktree: true,
      prompt: "build the tool plan",
    });
  });

  it("parses code approval mode", () => {
    const parsed = parseCliArgs([
      "node",
      "cli",
      "code",
      "--approve",
      "build the tool",
    ]);

    expect(parsed).toMatchObject({
      command: "code",
      approve: true,
      auto: false,
      prompt: "build the tool",
    });
  });

  it("parses explicit code auto mode", () => {
    const parsed = parseCliArgs([
      "node",
      "cli",
      "code",
      "--auto",
      "build the tool",
    ]);

    expect(parsed).toMatchObject({
      command: "code",
      approve: false,
      auto: true,
      prompt: "build the tool",
    });
  });

  it("parses execute-plan with a plan file and prompt", () => {
    const parsed = parseCliArgs([
      "node",
      "cli",
      "execute-plan",
      "--worktree",
      "--plan",
      "plan.yaml",
      "build the tool",
    ]);

    expect(parsed).toMatchObject({
      command: "execute-plan",
      worktree: true,
      planPath: "plan.yaml",
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

  it("rejects plan without a prompt", () => {
    expect(() => parseCliArgs(["node", "cli", "plan"])).toThrow(
      "prompt required",
    );
  });

  it("rejects approval mode outside code", () => {
    expect(() =>
      parseCliArgs(["node", "cli", "plan", "--approve", "build the tool"]),
    ).toThrow("--approve only applies");
  });

  it("rejects conflicting code workflow modes", () => {
    expect(() =>
      parseCliArgs([
        "node",
        "cli",
        "code",
        "--auto",
        "--approve",
        "build the tool",
      ]),
    ).toThrow("--auto and --approve");
  });
});
