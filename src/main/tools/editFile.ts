import { wsEditFile } from "../workspace";
import {
  formatFileContextResult,
  readFileContentForContext,
} from "./fileContext";
import { PROTECTED_OVERWRITE_PATH_RE } from "./protectedFiles";
import type { ToolContext, ToolSpec } from "./types";

const DESTRUCTIVE_EDIT_MIN_OLD_STRING_CHARS = 20;
const DESTRUCTIVE_EDIT_MIN_NEW_STRING_CHARS = 200;
const DESTRUCTIVE_EDIT_MAX_NEW_TO_OLD_RATIO = 10;

export const editFileTool: ToolSpec = {
  name: "edit_file",
  description:
    "Replace a snippet in an existing file, then reread the updated file into context. old_string must appear exactly once, or pass <replace_all>true</replace_all>.",
  params: [
    { name: "path", description: "file path", required: true },
    {
      name: "old_string",
      description: "exact text to find",
      required: true,
      multiline: true,
    },
    {
      name: "new_string",
      description: "replacement text",
      required: true,
      multiline: true,
    },
    { name: "replace_all", description: "true to replace every occurrence" },
  ],
  example:
    '<action name="edit_file">\n<path>index.html</path>\n<old_string>Hello</old_string>\n<new_string>Hello, world</new_string>\n</action>',
  mode: "code",
  run: editFile,
};

async function editFile(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const path = String(args.path ?? "").trim();
  const oldString = typeof args.old_string === "string" ? args.old_string : "";
  const newString = typeof args.new_string === "string" ? args.new_string : "";
  const replaceAll = args.replace_all === true || args.replace_all === "true";
  if (!path) return "Error: missing <path>";
  if (!oldString) return "Error: missing <old_string>";
  const destructiveEditError = detectDestructiveEdit(
    path,
    oldString,
    newString,
  );
  if (destructiveEditError) return destructiveEditError;
  try {
    const result = await wsEditFile(
      ctx.conversationId,
      path,
      oldString,
      newString,
      replaceAll,
    );
    ctx.onFileChange?.();
    const summary = `Edited ${path} (${result.occurrences} replacement${result.occurrences === 1 ? "" : "s"}).`;
    try {
      const content = await readFileContentForContext(ctx.conversationId, path);
      return [
        summary,
        "",
        formatFileContextResult(ctx.conversationId, path, content),
      ].join("\n");
    } catch (error) {
      return `${summary}\n\nError refreshing ${path}: ${(error as Error).message}`;
    }
  } catch (error) {
    return `Error editing ${path}: ${(error as Error).message}`;
  }
}

function detectDestructiveEdit(
  path: string,
  oldString: string,
  newString: string,
): string | null {
  if (!PROTECTED_OVERWRITE_PATH_RE.test(path)) return null;
  const trimmedOldString = oldString.trim();
  const unsafeGenericOldString =
    trimmedOldString === "undefined" || trimmedOldString === "null";
  const unsafeExpansion =
    trimmedOldString.length < DESTRUCTIVE_EDIT_MIN_OLD_STRING_CHARS &&
    newString.length >= DESTRUCTIVE_EDIT_MIN_NEW_STRING_CHARS &&
    newString.length >
      Math.max(trimmedOldString.length, 1) *
        DESTRUCTIVE_EDIT_MAX_NEW_TO_OLD_RATIO;
  if (!unsafeGenericOldString && !unsafeExpansion) return null;
  return [
    `Error editing ${path}: unsafe edit blocked.`,
    "The old_string is too generic for a protected project file.",
    "Read the target file and use an exact surrounding snippet from the current file.",
  ].join(" ");
}
