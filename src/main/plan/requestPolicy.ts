const READ_ONLY_REQUEST_RE =
  /\b(?:do not|don't|dont|without)\s+(?:modify(?:ing)?|chang(?:e|ing)|edit(?:ing)?|writ(?:e|ing)|creat(?:e|ing)|delet(?:e|ing)|alter(?:ing)?)\b|\bread[- ]only\b/i;

const FILE_MUTATION_TOOL_NAMES = [
  "edit_file",
  "write_file",
  "delete_file",
] as const;

export type FileMutationToolName = (typeof FILE_MUTATION_TOOL_NAMES)[number];

export function requestForbidsFileMutation(request: string): boolean {
  return READ_ONLY_REQUEST_RE.test(request);
}

export function isFileMutationToolName(toolName: string): boolean {
  return FILE_MUTATION_TOOL_NAMES.some((name) => name === toolName);
}

export function buildReadOnlyRequestToolBlockMessage(toolName: string): string {
  return [
    `The ${toolName} action was blocked because the original request forbids modifying files.`,
    "Use read-only actions such as read_file, search_files, list_files, or a non-mutating run_bash command.",
    "If the requested information is already visible in tool evidence, summarize it without modifying files.",
  ].join(" ");
}
