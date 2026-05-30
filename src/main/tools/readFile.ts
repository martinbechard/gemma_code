import {
  formatFileContextResult,
  readFileContentForContext,
} from "./fileContext";
import type { ToolContext, ToolSpec } from "./types";

export const readFileTool: ToolSpec = {
  name: "read_file",
  description:
    "Read a file from the workspace and show the current files-in-context list.",
  params: [
    {
      name: "path",
      description: "path relative to workspace",
      required: true,
    },
  ],
  example: '<action name="read_file">\n<path>index.html</path>\n</action>',
  mode: "code",
  run: readFile,
};

async function readFile(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const path = String(args.path ?? "").trim();
  if (!path) return "Error: missing <path>";
  try {
    const content = await readFileContentForContext(ctx.conversationId, path);
    return formatFileContextResult(ctx.conversationId, path, content);
  } catch (error) {
    return `Error reading ${path}: ${(error as Error).message}`;
  }
}
