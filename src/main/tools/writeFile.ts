import { wsReadFile, wsWriteFile } from "../workspace";
import { cleanFileContent } from "./fileContent";
import { formatFileContextResult } from "./fileContext";
import { PROTECTED_OVERWRITE_PATH_RE } from "./protectedFiles";
import type { ToolContext, ToolSpec } from "./types";

const DESTRUCTIVE_OVERWRITE_MIN_EXISTING_BYTES = 1_000;
const DESTRUCTIVE_OVERWRITE_MAX_NEW_TO_OLD_RATIO = 0.8;
const REMOVAL_COMMENT_RE = /^\s*(?:\/\/|\/\*)[^\n]*\b(?:removed|deleted)\b/im;

export const writeFileTool: ToolSpec = {
  name: "write_file",
  description:
    "Create or overwrite a file in the workspace. Use this for file changes: read the existing file first, then provide the full current file content plus the requested change.",
  params: [
    {
      name: "path",
      description: "path relative to workspace (e.g. index.html)",
      required: true,
    },
    {
      name: "content",
      description: "full file text",
      required: true,
      multiline: true,
    },
  ],
  example:
    '<action name="write_file">\n<path>index.html</path>\n<content>\n<!doctype html>\n<html>\n<body>Hello</body>\n</html>\n</content>\n</action>',
  mode: "code",
  run: writeFile,
};

async function writeFile(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const path = String(args.path ?? "").trim();
  const raw = typeof args.content === "string" ? args.content : "";
  if (!path) return "Error: missing <path>";
  const content = cleanFileContent(raw, path);
  const destructiveOverwriteError = await detectDestructiveOverwrite(
    ctx.conversationId,
    path,
    content,
  );
  if (destructiveOverwriteError) return destructiveOverwriteError;
  const removalCommentError = detectRemovalCommentWrite(path, content);
  if (removalCommentError) return removalCommentError;
  await wsWriteFile(ctx.conversationId, path, content);
  ctx.onFileChange?.();
  const lines = content.split("\n").length;
  const summary = `Wrote ${path} (${content.length} bytes, ${lines} lines).`;
  return [
    summary,
    "",
    formatFileContextResult(ctx.conversationId, path, content),
  ].join("\n");
}

function detectRemovalCommentWrite(path: string, content: string): string | null {
  if (!PROTECTED_OVERWRITE_PATH_RE.test(path)) return null;
  if (!REMOVAL_COMMENT_RE.test(content)) return null;
  return [
    `Error writing ${path}: removal comment blocked.`,
    "When removing code from protected project files, delete obsolete lines instead of leaving comments that mention removed code.",
  ].join(" ");
}

async function detectDestructiveOverwrite(
  conversationId: string,
  path: string,
  content: string,
): Promise<string | null> {
  if (!PROTECTED_OVERWRITE_PATH_RE.test(path)) return null;
  let existing: string;
  try {
    existing = await wsReadFile(conversationId, path);
  } catch {
    return null;
  }
  if (existing.length < DESTRUCTIVE_OVERWRITE_MIN_EXISTING_BYTES) return null;
  if (
    content.length >=
    existing.length * DESTRUCTIVE_OVERWRITE_MAX_NEW_TO_OLD_RATIO
  ) {
    return null;
  }
  return [
    `Error writing ${path}: destructive overwrite blocked.`,
    "The existing project file is much larger than the replacement content.",
    "Use edit_file, or use write_file with the full current file content plus the requested change.",
  ].join(" ");
}
