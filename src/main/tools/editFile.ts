import { wsEditFile, wsReadFile, wsWriteFile } from "../workspace";
import {
  formatFileContextResult,
  readFileContentForContext,
} from "./fileContext";
import { PROTECTED_OVERWRITE_PATH_RE } from "./protectedFiles";
import type { ToolContext, ToolSpec } from "./types";

const DESTRUCTIVE_EDIT_MIN_OLD_STRING_CHARS = 20;
const DESTRUCTIVE_EDIT_MIN_NEW_STRING_CHARS = 200;
const DESTRUCTIVE_EDIT_MAX_NEW_TO_OLD_RATIO = 10;
const REMOVAL_COMMENT_RE = /^(?:\/\/|\/\*)[\s\S]*\b(?:removed|deleted)\b/i;
const OLD_STRING_NOT_FOUND_RE = /\bold_string not found\b/i;
const QUOTED_PROPERTY_KEY_RE = /(["'])([A-Za-z_$][\w$]*)\1\s*:/g;

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
  const removalCommentError = detectRemovalCommentEdit(path, oldString, newString);
  if (removalCommentError) return removalCommentError;
  try {
    const result = await applyEditWithSafeFallback(
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

async function applyEditWithSafeFallback(
  conversationId: string,
  path: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): Promise<{ occurrences: number }> {
  try {
    return await wsEditFile(
      conversationId,
      path,
      oldString,
      newString,
      replaceAll,
    );
  } catch (error) {
    const message = (error as Error).message;
    if (!OLD_STRING_NOT_FOUND_RE.test(message)) throw error;
    const fallback = await applyQuotedPropertyKeyFallback(
      conversationId,
      path,
      oldString,
      newString,
      replaceAll,
    );
    if (!fallback) throw error;
    return fallback;
  }
}

async function applyQuotedPropertyKeyFallback(
  conversationId: string,
  path: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): Promise<{ occurrences: number } | null> {
  if (!PROTECTED_OVERWRITE_PATH_RE.test(path)) return null;
  const variants = quotedPropertyKeyVariants(oldString);
  if (variants.length === 0) return null;
  const content = await wsReadFile(conversationId, path);
  for (const variant of variants) {
    const occurrences = countOccurrences(content, variant);
    if (replaceAll ? occurrences > 0 : occurrences === 1) {
      const next = replaceAll
        ? content.split(variant).join(newString)
        : content.replace(variant, newString);
      await wsWriteFile(conversationId, path, next);
      return { occurrences };
    }
  }
  return null;
}

function quotedPropertyKeyVariants(oldString: string): string[] {
  const unquoted = oldString.replace(
    QUOTED_PROPERTY_KEY_RE,
    (_match, _quote: string, key: string) => `${key}:`,
  );
  return unquoted === oldString ? [] : [unquoted];
}

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

function detectRemovalCommentEdit(
  path: string,
  oldString: string,
  newString: string,
): string | null {
  if (!PROTECTED_OVERWRITE_PATH_RE.test(path)) return null;
  if (!REMOVAL_COMMENT_RE.test(newString.trim())) return null;
  if (/^\s*(?:\/\/|\/\*)/.test(oldString.trim())) return null;
  return [
    `Error editing ${path}: removal comment blocked.`,
    "When removing code from protected project files, use an empty <new_string> instead of leaving a comment that mentions the removed symbol.",
  ].join(" ");
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
