import { wsReadFile } from "../workspace";

const READ_FILE_MAX_CONTENT_CHARS = 20_000;
const READ_FILE_TRUNCATION_SUFFIX = "\n[…truncated]";
const FILE_CONTEXT_HEADING = "Files in context:";
const CURRENT_FILE_HEADING_PREFIX = "Current file: ";

const filesInContextByConversation = new Map<string, string[]>();

export async function readFileContentForContext(
  conversationId: string,
  path: string,
): Promise<string> {
  const content = await wsReadFile(conversationId, path);
  if (content.length > READ_FILE_MAX_CONTENT_CHARS) {
    return (
      content.slice(0, READ_FILE_MAX_CONTENT_CHARS) +
      READ_FILE_TRUNCATION_SUFFIX
    );
  }
  return content;
}

export function formatFileContextResult(
  conversationId: string,
  path: string,
  content: string,
): string {
  const paths = recordFileInContext(conversationId, path);
  return [
    FILE_CONTEXT_HEADING,
    ...paths.map((contextPath) => `- ${contextPath}`),
    "",
    `${CURRENT_FILE_HEADING_PREFIX}${path}`,
    content,
  ].join("\n");
}

function recordFileInContext(conversationId: string, path: string): string[] {
  const existing = filesInContextByConversation.get(conversationId) ?? [];
  if (existing.includes(path)) return existing;
  const next = [...existing, path];
  filesInContextByConversation.set(conversationId, next);
  return next;
}

export function clearFileContextForConversation(conversationId: string): void {
  filesInContextByConversation.delete(conversationId);
}
