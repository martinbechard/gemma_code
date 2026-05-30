import { wsDeleteFile } from "../workspace";
import type { ToolContext, ToolSpec } from "./types";

export const deleteFileTool: ToolSpec = {
  name: "delete_file",
  description: "Delete a file or directory from the workspace.",
  params: [{ name: "path", description: "path to delete", required: true }],
  example: '<action name="delete_file">\n<path>old.html</path>\n</action>',
  mode: "code",
  run: deleteFile,
};

async function deleteFile(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const path = String(args.path ?? "").trim();
  if (!path) return "Error: missing <path>";
  try {
    await wsDeleteFile(ctx.conversationId, path);
    ctx.onFileChange?.();
    return `Deleted ${path}.`;
  } catch (error) {
    return `Error deleting ${path}: ${(error as Error).message}`;
  }
}
