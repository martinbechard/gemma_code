import { calcTool } from "./calc";
import { deleteFileTool } from "./deleteFile";
import { editFileTool } from "./editFile";
import { fetchUrlTool } from "./fetchUrl";
import { getCurrentDatetimeTool } from "./getCurrentDatetime";
import { getCurrentWorkingDirectoryTool } from "./getCurrentWorkingDirectory";
import { killBackgroundTaskTool } from "./killBackgroundTask";
import { listBackgroundTasksTool } from "./listBackgroundTasks";
import { listFilesTool } from "./listFiles";
import { openPreviewTool } from "./openPreview";
import { readFileTool } from "./readFile";
import { runBashTool } from "./runBash";
import { runProjectScriptTool } from "./runProjectScript";
import { searchFilesTool } from "./searchFiles";
import { generateUuidTool } from "./uuid";
import { webSearchTool } from "./webSearch";
import { writeFileTool } from "./writeFile";
import { USE_WRITE_FILE_FOR_FILE_CHANGES } from "./constants";
import { loadProjectInstructions } from "./projectInstructions";
import { timezone } from "./time";
import type {
  ProjectInstructionOptions,
  PromptMode,
  ToolContext,
  ToolSpec,
} from "./types";

export { cleanFileContent } from "./fileContent";
export { clearFileContextForConversation } from "./fileContext";
export { loadProjectInstructions } from "./projectInstructions";
export { projectScriptCommand } from "./projectScripts";
export type {
  ProjectInstructionOptions,
  PromptMode,
  ToolContext,
  ToolSpec,
} from "./types";

export const TOOLS: Record<string, ToolSpec> = {
  web_search: webSearchTool,
  fetch_url: fetchUrlTool,
  calc: calcTool,
  get_current_datetime: getCurrentDatetimeTool,
  get_current_working_directory: getCurrentWorkingDirectoryTool,
  write_file: writeFileTool,
  read_file: readFileTool,
  edit_file: editFileTool,
  search_files: searchFilesTool,
  list_files: listFilesTool,
  delete_file: deleteFileTool,
  run_bash: runBashTool,
  run_project_script: runProjectScriptTool,
  list_background_tasks: listBackgroundTasksTool,
  "kill_background_task": killBackgroundTaskTool,
  "open_preview": openPreviewTool,
  "generate_uuid": generateUuidTool,
};

const PLAN_INSPECTION_TOOL_NAMES = new Set([
  "web_search",
  "fetch_url",
  "read_file",
  "search_files",
  "list_files",
  "run_bash",
]);

function renderToolHelp(mode: "chat" | "code" | "plan"): string {
  const wanted = (tool: ToolSpec): boolean => {
    if (mode === "plan") {
      return PLAN_INSPECTION_TOOL_NAMES.has(tool.name);
    }
    if (
      USE_WRITE_FILE_FOR_FILE_CHANGES &&
      mode === "code" &&
      tool.name === "edit_file"
    ) {
      return false;
    }
    return tool.mode === "both" || tool.mode === mode;
  };
  const lines: string[] = [];
  for (const tool of Object.values(TOOLS)) {
    if (!wanted(tool)) continue;
    lines.push(`### ${tool.name}`);
    lines.push(tool.description);
    if (tool.params.length) {
      lines.push("Parameters:");
      for (const param of tool.params) {
        const req = param.required ? " (required)" : "";
        const multi = param.multiline ? " — multi-line OK" : "";
        lines.push(`  <${param.name}>: ${param.description}${req}${multi}`);
      }
    } else {
      lines.push("No parameters.");
    }
    lines.push("Example:");
    lines.push(tool.example);
    lines.push("");
  }
  return lines.join("\n");
}

function projectInstructionsBlock(
  mode?: PromptMode | PromptMode[],
  opts: ProjectInstructionOptions = {},
): string[] {
  const instructions = loadProjectInstructions(mode, opts);
  if (!instructions) return [];
  return [
    "",
    "MODE AND PROJECT INSTRUCTIONS",
    "=============================",
    instructions,
  ];
}

export function chatSystemPrompt(enableTools: boolean): string {
  const now = new Date().toISOString();
  const day = new Date().toLocaleDateString("en-US", { weekday: "long" });
  if (!enableTools) {
    return [
      "You are Gemma, an AI assistant running 100% locally on the user's Mac.",
      `Current date/time: ${now} (${day}). Timezone: ${timezone()}.`,
      "Be clear, concise, and helpful. Use markdown for formatting when useful.",
      ...projectInstructionsBlock("chat"),
    ].join("\n");
  }
  return [
    "You are Gemma, an AI assistant running 100% locally on the user's Mac.",
    `Current date/time: ${now} (${day}). Timezone: ${timezone()}.`,
    "",
    "TOOL USE",
    "========",
    "When a tool helps, emit ONE action block and STOP. You will receive the result, then you may continue or call another tool.",
    "",
    "Action format:",
    '<action name="tool_name">',
    "<param_name>value</param_name>",
    "</action>",
    "",
    "Rules:",
    "- One action per response, on its own line.",
    "- Never wrap actions in markdown code fences.",
    '- For tools with no parameters, <action name="tool_name"/> is also valid.',
    "- After writing the action tag, STOP. Wait for the result before continuing.",
    "- When finished, write a short plain-text answer and emit no more actions.",
    "",
    "Tools:",
    "",
    renderToolHelp("chat"),
    ...projectInstructionsBlock("chat"),
  ].join("\n");
}

export function codeSystemPrompt(
  workspacePath: string,
  previewHref: string,
  codeMode: "code" | "build" | "plan" | "execute" | "freestyle" = "build",
): string {
  const now = new Date().toISOString();
  const day = new Date().toLocaleDateString("en-US", { weekday: "long" });
  if (codeMode === "freestyle") {
    return [
      "You are Gemma, a local coding agent running entirely on the user's Mac.",
      "",
      "Freestyle mode",
      "==============",
      `- Current date/time (UTC): ${now}`,
      `- Current day: ${day}`,
      `- Local timezone: ${timezone()}`,
      `- Workspace root: ${workspacePath}`,
      `- Preview URL: ${previewHref}`,
      "",
      "The user has asked you to decide how to work. Use the tools when they help, and stop when you are done.",
      "",
      "Action format:",
      '<action name="tool_name">',
      "<param_name>value</param_name>",
      "</action>",
      "",
      "Rules:",
      "- One action per response, then stop and wait for the result.",
      "- Never wrap actions in markdown code fences.",
      '- For tools with no parameters, <action name="tool_name"/> is also valid.',
      "- When finished, write a short plain-text answer and emit no more actions.",
      "",
      "Tools:",
      "",
      renderToolHelp("code"),
    ].join("\n");
  }

  const promptParts = [
    "You are Gemma, a local coding agent running entirely on the user's Mac.",
    "",
    "SESSION CONTEXT",
    "===============",
    `- Current date/time (UTC): ${now}`,
    `- Current day: ${day}`,
    `- Local timezone: ${timezone()}`,
    `- Workspace root: ${workspacePath}`,
    `- Preview URL: ${previewHref}`,
    ...(codeMode === "plan"
      ? ["- Current task: prepare an implementation plan"]
      : [`- Active prompt mode: ${codeMode}`]),
    ...projectInstructionsBlock(instructionModesForCodePrompt(codeMode), {
      includeCommon: codeMode !== "execute" && codeMode !== "plan",
    }),
  ];

  if (codeMode === "plan") {
    return [
      ...promptParts,
      "",
      "READ-ONLY INSPECTION ACTION FORMAT",
      '<action name="tool_name">',
      "<param_name>value</param_name>",
      "</action>",
      "",
      "While preparing the plan, use one read-only inspection action, then stop and wait for the result.",
      "Allowed inspection tools:",
      "",
      renderToolHelp("plan"),
    ].join("\n");
  }

  return [
    ...promptParts,
    "",
    "ACTION FORMAT — EXACT",
    '<action name="tool_name">',
    "<param_name>value</param_name>",
    "</action>",
    "",
    "WRITE_FILE <content> RULES — READ TWICE",
    "The string between <content> and </content> is WRITTEN TO DISK LITERALLY. Everything is saved.",
    "- NEVER put ``` fences at the start or end of <content>. Not ``` alone, not ```html, not ```js. None.",
    '- NEVER put explanatory text, "Key Features", "Instructions to Use", or any commentary INSIDE <content>. Only the file contents.',
    "- Close <content> with </content> on its own line, immediately after the last line of the file.",
    "- Then close the action with </action> on its own line.",
    "",
    "HARD RULES (apply in every code/build session)",
    "- Use edit_file for targeted changes to existing files after reading the file.",
    "- Use write_file for new files or full-file rewrites that preserve the current content.",
    "- Never paste file contents in your chat reply — only inside <content>.",
    "- Never wrap <action> tags in ``` code fences.",
    "- Paths are relative to the workspace (no leading slashes).",
    '- For tools with no parameters, <action name="tool_name"/> is also valid.',
    "- One action per response, then STOP and wait.",
    "",
    "AVAILABLE TOOLS",
    "",
    renderToolHelp("code"),
  ].join("\n");
}

function instructionModesForCodePrompt(
  codeMode: "code" | "build" | "plan" | "execute" | "freestyle",
): PromptMode[] {
  if (codeMode === "plan") return ["plan"];
  if (codeMode === "execute") return ["execute"];
  return [codeMode];
}

export interface ParsedAction {
  name: string;
  args: Record<string, unknown>;
  raw: string;
  start: number;
  end: number;
}

export function findNextAction(
  text: string,
  from = 0,
): ParsedAction | "incomplete" | null {
  const openRe = /<action\s+name\s*=\s*["']?([a-zA-Z_][\w]*)["']?\s*(\/?)>/gi;
  openRe.lastIndex = from;
  let open: RegExpExecArray | null;
  while ((open = openRe.exec(text)) !== null) {
    if (
      !isInsideMarkdownCodeFence(text, open.index) &&
      !isInsideThinkingBlock(text, open.index)
    ) {
      break;
    }
    openRe.lastIndex = open.index + open[0].length;
  }
  if (!open) return null;
  const name = open[1];
  if (open[2] === "/") {
    return {
      name,
      args: {},
      raw: open[0],
      start: open.index,
      end: open.index + open[0].length,
    };
  }
  const bodyStart = open.index + open[0].length;
  const close = findActionClose(text, bodyStart);
  if (close === null) return "incomplete";
  const body = text.slice(bodyStart, close.index);
  const args = parseActionBody(body);
  return {
    name,
    args,
    raw: text.slice(open.index, close.index + close.length),
    start: open.index,
    end: close.index + close.length,
  };
}

function findActionClose(
  text: string,
  bodyStart: number,
): { index: number; length: number } | null {
  const closeRe = /<\/action\s*>/gi;
  closeRe.lastIndex = bodyStart;
  let closeMatch: RegExpExecArray | null;
  let recoverableClose: { index: number; length: number } | null = null;
  while ((closeMatch = closeRe.exec(text)) !== null) {
    const closeIdx = closeMatch.index;
    const body = text.slice(bodyStart, closeIdx);
    if (hasUnclosedBlockingArgument(body)) continue;
    if (hasUnclosedRecoverableArgument(body)) {
      recoverableClose = { index: closeIdx, length: closeMatch[0].length };
      continue;
    }
    return { index: closeIdx, length: closeMatch[0].length };
  }
  return recoverableClose;
}

function hasUnclosedBlockingArgument(body: string): boolean {
  return ["old_string", "new_string"].some((tag) => {
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;
    const openIndex = body.indexOf(openTag);
    return openIndex >= 0 && body.indexOf(closeTag, openIndex + openTag.length) < 0;
  });
}

function hasUnclosedRecoverableArgument(body: string): boolean {
  return ["content", "command"].some((tag) => {
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;
    const openIndex = body.indexOf(openTag);
    return openIndex >= 0 && body.indexOf(closeTag, openIndex + openTag.length) < 0;
  });
}

function isInsideMarkdownCodeFence(text: string, index: number): boolean {
  const fenceRe = /```/g;
  let inside = false;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(text)) !== null) {
    if (match.index >= index) break;
    inside = !inside;
  }
  return inside;
}

function isInsideThinkingBlock(text: string, index: number): boolean {
  const tagRe = /<\/?think(?:ing)?>/gi;
  let inside = false;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(text)) !== null) {
    if (match.index >= index) break;
    inside = !match[0].startsWith("</");
  }
  return inside;
}

function parseActionBody(body: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  const contentOpen = body.indexOf("<content>");
  let outside = body;
  if (contentOpen >= 0) {
    const contentCloseRel = body.lastIndexOf("</content>");
    const contentEnd =
      contentCloseRel > contentOpen ? contentCloseRel : body.length;
    if (contentEnd > contentOpen) {
      let content = body.slice(contentOpen + "<content>".length, contentEnd);
      content = content.replace(/^\n/, "");
      content = content.replace(/\n[ \t]*$/, "");
      args.content = content;
      outside =
        body.slice(0, contentOpen) +
        (contentCloseRel > contentOpen
          ? body.slice(contentCloseRel + "</content>".length)
          : "");
    }
  }

  const commandOpen = outside.indexOf("<command>");
  if (commandOpen >= 0) {
    const commandCloseRel = outside.indexOf(
      "</command>",
      commandOpen + "<command>".length,
    );
    if (commandCloseRel < 0) {
      let command = outside.slice(commandOpen + "<command>".length);
      command = command.replace(/^\n/, "").replace(/\n[ \t]*$/, "");
      args.command = command;
      outside = outside.slice(0, commandOpen);
    }
  }

  const tagRe = /<([a-zA-Z_][\w-]*)>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(outside)) !== null) {
    const key = match[1];
    if (key === "content") continue;
    const raw = match[2];
    const trimmed = raw.trim();
    if (trimmed === "true") args[key] = true;
    else if (trimmed === "false") args[key] = false;
    else if (/^-?\d+$/.test(trimmed)) args[key] = Number(trimmed);
    else args[key] = raw.replace(/^\n/, "").replace(/\n[ \t]*$/, "");
  }
  return args;
}

export function emitSafeBoundary(buffer: string, from: number): number {
  for (let index = buffer.length - 1; index >= from; index -= 1) {
    if (buffer[index] !== "<") continue;
    if (isInsideThinkingBlock(buffer, index)) continue;
    const tail = buffer.slice(index).toLowerCase();
    if (tail.length < 8) {
      if ("<action".startsWith(tail)) return index;
      continue;
    }
    if (tail.startsWith("<action") && /\s/.test(tail[7])) return index;
  }
  return buffer.length;
}

export function isToolErrorResult(result: string): boolean {
  return /^Error(?:\b|:)/i.test(result.trimStart());
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const tool = TOOLS[name];
  if (!tool) {
    return `Error: unknown tool "${name}". Available: ${Object.keys(TOOLS).join(", ")}`;
  }
  try {
    return await tool.run(args, ctx);
  } catch (error) {
    return `Error running ${name}: ${(error as Error).message}`;
  }
}
