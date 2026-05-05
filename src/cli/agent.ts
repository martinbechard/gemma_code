import { chatStream, type MLXChatMessage } from "../main/mlx";
import {
  chatSystemPrompt,
  codeSystemPrompt,
  findNextAction,
  runTool,
  type ToolContext,
} from "../main/tools";
import {
  ensureWorkspace,
  startWorkspaceServer,
  previewUrl,
  setWorkspaceOverride,
  clearWorkspaceOverride,
} from "../main/workspace";
import { ensureMlxRunning } from "./setup";

const MAX_ROUNDS_CHAT = 8;
const MAX_ROUNDS_CODE = 40;

export interface AgentRunOptions {
  mode: "chat" | "code";
  model: string;
  prompt: string;
  enableBash: boolean;
}

function out(s: string): void {
  process.stdout.write(s);
}

function meta(line: string): void {
  process.stdout.write(`\n[cli] ${line}\n`);
}

export async function runChat(opts: AgentRunOptions): Promise<void> {
  const conversationId = `cli-${Date.now()}`;
  // CLI runs against the current working directory rather than the per-id
  // sandbox the Electron app uses. Tools (write_file, list_files, run_bash,
  // etc.) operate on real project files; rely on git for isolation.
  const projectRoot = process.cwd();
  setWorkspaceOverride(conversationId, projectRoot);
  try {
    await ensureMlxRunning(opts.model);
    await startWorkspaceServer();

    const messages: MLXChatMessage[] = [];
    if (opts.mode === "code") {
      const wsPath = await ensureWorkspace(conversationId);
      const href = previewUrl(conversationId);
      messages.push({
        role: "system",
        content: codeSystemPrompt(wsPath, href),
      });
      meta(`workspace: ${wsPath} (cwd)`);
      meta(`preview:   ${href}`);
    } else {
      messages.push({
        role: "system",
        content: chatSystemPrompt(true /* enableTools */),
      });
      meta(`cwd:       ${projectRoot}`);
    }
    messages.push({ role: "user", content: opts.prompt });

    const ctx: ToolContext = {
      conversationId,
      onFileChange: () => {
        /* no-op in CLI */
      },
    };

    const maxRounds = opts.mode === "code" ? MAX_ROUNDS_CODE : MAX_ROUNDS_CHAT;
    await runAgentLoop(opts, messages, ctx, maxRounds);
  } finally {
    clearWorkspaceOverride(conversationId);
  }
}

async function runAgentLoop(
  opts: AgentRunOptions,
  messages: MLXChatMessage[],
  ctx: ToolContext,
  maxRounds: number,
): Promise<void> {
  for (let round = 0; round < maxRounds; round++) {
    meta(`--- round ${round + 1} ---`);
    let buffer = "";
    for await (const chunk of chatStream({
      model: opts.model,
      messages,
    })) {
      if (chunk.content) {
        buffer += chunk.content;
        out(chunk.content);
      }
    }
    out("\n");

    const action = findNextAction(buffer);
    if (!action || action === "incomplete") {
      meta("done — no more actions");
      return;
    }

    if (action.name === "run_bash" && !opts.enableBash) {
      meta(
        "run_bash blocked (set RUN_BASH=1 to allow). Stopping to avoid skewing the test.",
      );
      messages.push({ role: "assistant", content: buffer });
      messages.push({
        role: "tool",
        content: `Result of <action name="run_bash">: blocked by CLI policy (RUN_BASH not set)`,
      });
      continue;
    }

    meta(`tool: ${action.name}`);
    for (const [k, v] of Object.entries(action.args)) {
      const preview = String(v).slice(0, 80).replace(/\n/g, "\\n");
      meta(`  ${k}: ${preview}${String(v).length > 80 ? "…" : ""}`);
    }

    let result: string;
    try {
      result = await runTool(action.name, action.args, ctx);
    } catch (e) {
      result = `Error: ${(e as Error).message}`;
    }
    const resPreview = result.slice(0, 200).replace(/\n/g, " ");
    meta(
      `result (${result.length} chars): ${resPreview}${result.length > 200 ? "…" : ""}`,
    );

    messages.push({ role: "assistant", content: buffer });
    messages.push({
      role: "tool",
      content: `Result of <action name="${action.name}">: ${result}`,
    });
  }

  meta(`stopped at max rounds (${maxRounds})`);
}
