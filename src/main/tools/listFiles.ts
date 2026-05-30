import { ensureWorkspace, listTree } from "../workspace";
import type { ToolContext, ToolSpec } from "./types";

const LIST_FILES_MAX_ENTRIES = 200;

export const listFilesTool: ToolSpec = {
  name: "list_files",
  description:
    "List the workspace tree only; it does not search file contents. This tool has no path parameter. Use search_files for references or text, and use run_bash for narrower directory listings.",
  params: [],
  example: '<action name="list_files"></action>',
  mode: "code",
  run: listFiles,
};

async function listFiles(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const base = await ensureWorkspace(ctx.conversationId);
  const tree = await listTree(base, LIST_FILES_MAX_ENTRIES);
  if (tree.length === 0) return "(workspace is empty)";
  return tree
    .map((entry) =>
      entry.kind === "dir"
        ? `${entry.path}/`
        : `${entry.path}${entry.size != null ? ` (${entry.size}B)` : ""}`,
    )
    .join("\n");
}
