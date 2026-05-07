export type CliCommand =
  | "chat"
  | "code"
  | "plan"
  | "plan-ask-done"
  | "execute-plan"
  | "continue"
  | "setup"
  | "status";

export interface ParsedArgs {
  command: CliCommand;
  model: string;
  prompt: string;
  enableBash: boolean;
  worktree: boolean;
  planPath?: string;
  conversationPath?: string;
}

export const DEFAULT_MODEL = "mlx-community/gemma-4-e2b-it-4bit";

export function parseCliArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  if (args.length === 0) throw new Error("command required");
  const command = parseCommand(args[0]);
  let model = DEFAULT_MODEL;
  let worktree = false;
  let planPath: string | undefined;
  let conversationPath: string | undefined;
  const remaining: string[] = [];

  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--model") {
      model = args[++i] ?? DEFAULT_MODEL;
    } else if (a === "--worktree") {
      worktree = true;
    } else if (a === "--plan") {
      planPath = args[++i];
    } else if (a === "--conversation") {
      conversationPath = args[++i];
    } else {
      remaining.push(a);
    }
  }

  const prompt = remaining.join(" ").trim();
  if (
    command === "chat" ||
    command === "code" ||
    command === "plan" ||
    command === "plan-ask-done"
  ) {
    if (!prompt) {
      throw new Error("prompt required for chat/code/plan/plan-ask-done commands");
    }
  }
  if (command === "execute-plan") {
    if (!planPath) throw new Error("plan file required for execute-plan");
    if (!prompt) throw new Error("prompt required for execute-plan");
  }
  if (command === "continue") {
    if (!conversationPath) throw new Error("conversation file required for continue");
    if (!prompt) throw new Error("prompt required for continue");
  }
  if (
    worktree &&
    command !== "chat" &&
    command !== "code" &&
    command !== "plan" &&
    command !== "plan-ask-done" &&
    command !== "execute-plan"
  ) {
    throw new Error(
      "--worktree only applies to chat/code/plan/plan-ask-done/execute-plan commands",
    );
  }

  return {
    command,
    model,
    prompt,
    enableBash: process.env.RUN_BASH === "1",
    worktree,
    ...(planPath ? { planPath } : {}),
    ...(conversationPath ? { conversationPath } : {}),
  };
}

function parseCommand(value: string): CliCommand {
  if (
    value === "chat" ||
    value === "code" ||
    value === "plan" ||
    value === "plan-ask-done" ||
    value === "execute-plan" ||
    value === "continue" ||
    value === "setup" ||
    value === "status"
  ) {
    return value;
  }
  throw new Error(`unknown command: ${value}`);
}
