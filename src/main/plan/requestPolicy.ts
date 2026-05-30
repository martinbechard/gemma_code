const READ_ONLY_REQUEST_RE =
  /\b(?:do not|don't|dont|without)\s+(?:modify(?:ing)?|chang(?:e|ing)|edit(?:ing)?|writ(?:e|ing)|creat(?:e|ing)|delet(?:e|ing)|alter(?:ing)?)\b|\bread[- ]only\b/i;

const FILE_MUTATION_TOOL_NAMES = [
  "edit_file",
  "write_file",
  "delete_file",
] as const;
const PLAN_INSPECTION_TOOL_NAMES = [
  "web_search",
  "fetch_url",
  "read_file",
  "search_files",
  "list_files",
  "run_bash",
] as const;
const MUTATING_COMMAND_RE =
  /\b(?:rm|mv|cp|touch|mkdir|rmdir)\b|\bgit\s+(?:apply|am|checkout|clean|commit|merge|rebase|reset|restore|switch)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:add|install|remove|uninstall)\b|\b(?:sed|perl)\s+(?:-[A-Za-z]*i|[^\n]*\s-i\b)|(?:^|\s)>\s*\S+/i;

export type FileMutationToolName = (typeof FILE_MUTATION_TOOL_NAMES)[number];
export type PlanInspectionToolName = (typeof PLAN_INSPECTION_TOOL_NAMES)[number];

export function requestForbidsFileMutation(request: string): boolean {
  return READ_ONLY_REQUEST_RE.test(request);
}

export function isFileMutationToolName(toolName: string): boolean {
  return FILE_MUTATION_TOOL_NAMES.some((name) => name === toolName);
}

export function isPlanInspectionToolAction(
  toolName: string,
  args: Record<string, unknown>,
): toolName is PlanInspectionToolName {
  if (!PLAN_INSPECTION_TOOL_NAMES.some((name) => name === toolName)) {
    return false;
  }
  if (toolName !== "run_bash") return true;
  const command = typeof args.command === "string" ? args.command : "";
  if (command.trim().length === 0) return false;
  return !MUTATING_COMMAND_RE.test(command);
}

export function buildReadOnlyRequestToolBlockMessage(toolName: string): string {
  return [
    `The ${toolName} action was blocked because the original request forbids modifying files.`,
    "Use read-only actions such as read_file, search_files, list_files, or a non-mutating run_bash command.",
    "If the requested information is already visible in tool evidence, summarize it without modifying files.",
  ].join(" ");
}

export function buildPlanInspectionToolBlockMessage(toolName: string): string {
  return [
    `The ${toolName} action was blocked because planning may only inspect the project.`,
    "Use one read-only inspection action such as read_file, search_files, list_files, fetch_url, web_search, or a non-mutating run_bash command.",
    "If enough information is already visible, return one YAML plan step or a focused <Question>...</Question>.",
  ].join(" ");
}
