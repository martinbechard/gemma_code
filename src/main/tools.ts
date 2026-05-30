import { existsSync, promises as fs, readFileSync } from "fs";
import { basename, join } from "path";
import {
  wsWriteFile,
  wsReadFile,
  wsEditFile,
  wsDeleteFile,
  wsRunBash,
  ensureWorkspace,
  listTree,
  previewUrl,
} from "./workspace";
import { appRootDir, isPackaged } from "./runtimePaths";
import {
  killBackgroundTask,
  listBackgroundTasks,
  startBackgroundTask,
  type BackgroundTaskSnapshot,
} from "./backgroundTasks";

const COMMON_INSTRUCTIONS_FILE = "Gemma.md";
const PROJECT_SCRIPT_DEFAULT_TIMEOUT_MS = 120_000;
const PROJECT_SCRIPT_MAX_TIMEOUT_MS = 300_000;
const PROJECT_SCRIPT_ALLOWED_NAMES = ["build", "test", "dev"] as const;
const PROJECT_SCRIPT_MANAGERS = ["npm", "pnpm"] as const;
const USE_WRITE_FILE_FOR_FILE_CHANGES = true;
const DESTRUCTIVE_OVERWRITE_MIN_EXISTING_BYTES = 1_000;
const DESTRUCTIVE_OVERWRITE_MAX_NEW_TO_OLD_RATIO = 0.5;
const DESTRUCTIVE_EDIT_MIN_OLD_STRING_CHARS = 20;
const DESTRUCTIVE_EDIT_MIN_NEW_STRING_CHARS = 200;
const DESTRUCTIVE_EDIT_MAX_NEW_TO_OLD_RATIO = 10;
const READ_FILE_MAX_CONTENT_CHARS = 20_000;
const READ_FILE_TRUNCATION_SUFFIX = "\n[…truncated]";
const SEARCH_FILES_DEFAULT_PATH = ".";
const SEARCH_FILES_DEFAULT_MAX_RESULTS = 200;
const SEARCH_FILES_ABSOLUTE_MAX_RESULTS = 500;
const SEARCH_FILES_MAX_FILE_BYTES = 1_000_000;
const SEARCH_FILES_IGNORED_DIRS = [
  "node_modules",
  "out",
  "dist",
  "build",
  ".git",
  ".gemma-cli",
  ".next",
  "coverage",
  ".turbo",
  ".vite",
  ".cache",
  ".worktrees",
] as const;
const SEARCH_FILES_IGNORED_FILE_SUFFIXES = [
  ".tsbuildinfo",
] as const;
const PROTECTED_OVERWRITE_PATH_RE =
  /^(?:src|tests)\/|^Gemma(?:\.[A-Za-z]+)?\.md$|^package\.json$/;
const FILE_CONTEXT_HEADING = "Files in context:";
const CURRENT_FILE_HEADING_PREFIX = "Current file: ";

type ProjectScriptName = (typeof PROJECT_SCRIPT_ALLOWED_NAMES)[number];
type ProjectScriptManager = (typeof PROJECT_SCRIPT_MANAGERS)[number];
const filesInContextByConversation = new Map<string, string[]>();

interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export type PromptMode = "chat" | "code" | "build" | "plan" | "execute";

export interface ProjectInstructionOptions {
  includeCommon?: boolean;
}

// Read Gemma.md (common) and optionally Gemma.{mode}.md (mode-specific) from
// the app root (dev) or unpacked resources (packaged). The mode-specific file
// is appended after the common one so it can layer additional rules without
// duplicating the shared baseline. Returns null if neither file is found.
function readInstructionsFile(filename: string): string | null {
  const candidates = isPackaged()
    ? [join(process.resourcesPath, filename)]
    : [join(appRootDir(), filename)];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const text = readFileSync(p, "utf-8").trim();
        return text.length > 0 ? text : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function loadProjectInstructions(
  mode?: PromptMode | PromptMode[],
  opts: ProjectInstructionOptions = {},
): string | null {
  const includeCommon = opts.includeCommon ?? true;
  const common = readInstructionsFile(COMMON_INSTRUCTIONS_FILE);
  const modes = Array.isArray(mode) ? mode : mode ? [mode] : [];
  const parts: string[] = [];
  if (includeCommon && common) parts.push(common);
  for (const m of modes) {
    const modeFile = readInstructionsFile(`Gemma.${m}.md`);
    if (modeFile) parts.push(modeFile);
  }
  if (parts.length === 0) return null;
  return parts.join("\n\n");
}

export interface ToolContext {
  conversationId: string;
  onFileChange?: () => void;
}

export interface ToolSpec {
  name: string;
  description: string;
  params: Array<{
    name: string;
    description: string;
    required?: boolean;
    multiline?: boolean;
  }>;
  example: string;
  mode: "chat" | "code" | "both";
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function webSearch(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query ?? "").trim();
  if (!query) return "Error: missing query";
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html" },
  });
  if (!res.ok) return `Search failed: ${res.status} ${res.statusText}`;
  const html = await res.text();
  const results = parseDuckDuckGoResults(html).slice(0, 6);
  if (results.length === 0) return "No results found.";
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
    .join("\n\n");
}

function parseDuckDuckGoResults(
  html: string,
): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const blockRe =
    /<div class="result[^"]*?"[^>]*>([\s\S]*?)<div class="clear"/g;
  const titleRe =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/;

  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html))) {
    const block = m[1];
    const t = titleRe.exec(block);
    const s = snippetRe.exec(block);
    if (!t) continue;
    const rawUrl = decodeURIComponent(
      t[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, ""),
    )
      .split("&rut=")[0]
      .split("&amp;")[0];
    const cleanUrl = rawUrl.split("&")[0];
    const title = stripTags(t[2]).trim();
    const snippet = s ? stripTags(s[1]).trim() : "";
    if (title && cleanUrl.startsWith("http")) {
      results.push({ title, url: cleanUrl, snippet });
    }
    if (results.length >= 10) break;
  }
  return results;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchUrl(args: Record<string, unknown>): Promise<string> {
  const url = String(args.url ?? "").trim();
  if (!url) return "Error: missing url";
  if (!/^https?:\/\//.test(url)) return "Error: url must be http(s)";
  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (!res.ok) return `Fetch failed: ${res.status} ${res.statusText}`;
    const ct = res.headers.get("content-type") || "";
    const text = await res.text();
    if (ct.includes("html")) {
      return htmlToText(text).slice(0, 8000);
    }
    return text.slice(0, 8000);
  } catch (e) {
    return `Error fetching: ${(e as Error).message}`;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function calc(args: Record<string, unknown>): Promise<string> {
  const expr = String(args.expression ?? "").trim();
  if (!expr) return "Error: missing expression";
  if (!/^[0-9+\-*/().\s^%,eE]*$/.test(expr)) {
    return "Error: only numeric expressions allowed";
  }
  try {
    const sanitized = expr.replace(/\^/g, "**");
    const result = Function(`"use strict"; return (${sanitized})`)();
    return String(result);
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

async function getCurrentDatetime(
  _args: Record<string, unknown>,
): Promise<string> {
  const now = new Date();
  return [
    `ISO: ${now.toISOString()}`,
    `Unix milliseconds: ${now.getTime()}`,
    `Timezone: ${tz()}`,
    `Local: ${now.toLocaleString("en-US", {
      dateStyle: "full",
      timeStyle: "long",
    })}`,
  ].join("\n");
}

async function getCurrentWorkingDirectory(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const workspacePath = await ensureWorkspace(ctx.conversationId);
  return [
    `Workspace root: ${workspacePath}`,
    `Process cwd: ${process.cwd()}`,
  ].join("\n");
}

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
  await wsWriteFile(ctx.conversationId, path, content);
  ctx.onFileChange?.();
  const lines = content.split("\n").length;
  return `Wrote ${path} (${content.length} bytes, ${lines} lines).`;
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

export function cleanFileContent(raw: string, path: string): string {
  let s = raw;

  // Case 1: fully wrapped in ```lang ... ```
  const full = s.trim().match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```[\s\S]*$/);
  if (full) {
    s = full[1];
  } else {
    // Case 2: just a leading fence ```lang\n
    const lead = s.match(/^\s*```[a-zA-Z0-9_-]*\n/);
    if (lead) {
      s = s.slice(lead[0].length);
      // If there's a trailing fence somewhere, cut everything from there
      const trail = s.search(/\n```(?:\s|$)/);
      if (trail >= 0) s = s.slice(0, trail);
    }
  }

  // Case 3: file-type-aware truncation of post-file commentary
  const lower = path.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    const end = s.toLowerCase().lastIndexOf("</html>");
    if (end >= 0) s = s.slice(0, end + "</html>".length) + "\n";
  } else if (lower.endsWith(".svg")) {
    const end = s.toLowerCase().lastIndexOf("</svg>");
    if (end >= 0) s = s.slice(0, end + "</svg>".length) + "\n";
  } else if (lower.endsWith(".json")) {
    // Trim anything after a trailing } or ]
    const trimmed = s.trim();
    const lastBrace = Math.max(
      trimmed.lastIndexOf("}"),
      trimmed.lastIndexOf("]"),
    );
    if (lastBrace >= 0) s = trimmed.slice(0, lastBrace + 1) + "\n";
  }

  return s;
}

async function readFile(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const path = String(args.path ?? "").trim();
  if (!path) return "Error: missing <path>";
  try {
    const content = await readFileContentForContext(ctx.conversationId, path);
    return formatFileContextResult(ctx.conversationId, path, content);
  } catch (e) {
    return `Error reading ${path}: ${(e as Error).message}`;
  }
}

async function editFile(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const path = String(args.path ?? "").trim();
  const oldStr = typeof args.old_string === "string" ? args.old_string : "";
  const newStr = typeof args.new_string === "string" ? args.new_string : "";
  const replaceAll = args.replace_all === true || args.replace_all === "true";
  if (!path) return "Error: missing <path>";
  if (!oldStr) return "Error: missing <old_string>";
  const destructiveEditError = detectDestructiveEdit(path, oldStr, newStr);
  if (destructiveEditError) return destructiveEditError;
  try {
    const r = await wsEditFile(
      ctx.conversationId,
      path,
      oldStr,
      newStr,
      replaceAll,
    );
    ctx.onFileChange?.();
    const summary = `Edited ${path} (${r.occurrences} replacement${r.occurrences === 1 ? "" : "s"}).`;
    try {
      const content = await readFileContentForContext(ctx.conversationId, path);
      return [
        summary,
        "",
        formatFileContextResult(ctx.conversationId, path, content),
      ].join("\n");
    } catch (e) {
      return `${summary}\n\nError refreshing ${path}: ${(e as Error).message}`;
    }
  } catch (e) {
    return `Error editing ${path}: ${(e as Error).message}`;
  }
}

async function readFileContentForContext(
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

function formatFileContextResult(
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

async function listFiles(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const base = await ensureWorkspace(ctx.conversationId);
  const tree = await listTree(base, 200);
  if (tree.length === 0) return "(workspace is empty)";
  return tree
    .map((e) =>
      e.kind === "dir"
        ? `${e.path}/`
        : `${e.path}${e.size != null ? ` (${e.size}B)` : ""}`,
    )
    .join("\n");
}

function safeSearchPath(args: Record<string, unknown>): string | null {
  const rawPath = String(args.path ?? SEARCH_FILES_DEFAULT_PATH).trim();
  const path = rawPath || SEARCH_FILES_DEFAULT_PATH;
  if (path.startsWith("/") || path.split(/[\\/]+/).includes("..")) return null;
  return path;
}

function boundedSearchResultLimit(args: Record<string, unknown>): number {
  const raw =
    typeof args.max_results === "number"
      ? args.max_results
      : SEARCH_FILES_DEFAULT_MAX_RESULTS;
  const integer = Number.isFinite(raw)
    ? Math.floor(raw)
    : SEARCH_FILES_DEFAULT_MAX_RESULTS;
  return Math.max(1, Math.min(integer, SEARCH_FILES_ABSOLUTE_MAX_RESULTS));
}

function globToRegExp(glob: string): RegExp {
  let source = "^";
  let index = 0;
  while (index < glob.length) {
    const char = glob[index];
    const next = glob[index + 1];
    if (char === "*" && next === "*") {
      if (glob[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 3;
      } else {
        source += ".*";
        index += 2;
      }
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      index += 1;
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }
    source += char.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
    index += 1;
  }
  return new RegExp(`${source}$`);
}

function matchesSearchFileGlob(path: string, fileGlob: string): boolean {
  if (!fileGlob) return true;
  const normalizedGlob = fileGlob.replace(/\\/g, "/");
  const normalizedPath = path.replace(/\\/g, "/");
  if (normalizedGlob.includes("/")) {
    return globToRegExp(normalizedGlob).test(normalizedPath);
  }
  return globToRegExp(normalizedGlob).test(basename(normalizedPath));
}

function shouldIgnoreSearchDir(name: string): boolean {
  return SEARCH_FILES_IGNORED_DIRS.includes(
    name as (typeof SEARCH_FILES_IGNORED_DIRS)[number],
  );
}

function shouldIgnoreSearchFile(path: string): boolean {
  return SEARCH_FILES_IGNORED_FILE_SUFFIXES.some((suffix) =>
    path.endsWith(suffix),
  );
}

async function collectSearchMatches(params: {
  base: string;
  relativePath: string;
  query: string;
  fileGlob: string;
  maxResults: number;
  matches: SearchMatch[];
}): Promise<boolean> {
  let stat;
  const absolutePath = join(params.base, params.relativePath);
  try {
    stat = await fs.stat(absolutePath);
  } catch (error) {
    throw new Error(
      `could not read ${params.relativePath}: ${(error as Error).message}`,
    );
  }
  if (stat.isDirectory()) {
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && shouldIgnoreSearchDir(entry.name)) continue;
      const childPath =
        params.relativePath === SEARCH_FILES_DEFAULT_PATH
          ? entry.name
          : `${params.relativePath}/${entry.name}`;
      const truncated = await collectSearchMatches({
        ...params,
        relativePath: childPath,
      });
      if (truncated) return true;
    }
    return false;
  }
  if (!stat.isFile()) return false;
  if (stat.size > SEARCH_FILES_MAX_FILE_BYTES) return false;
  if (shouldIgnoreSearchFile(params.relativePath)) return false;
  if (!matchesSearchFileGlob(params.relativePath, params.fileGlob)) return false;
  const content = await fs.readFile(absolutePath, "utf8");
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes(params.query)) continue;
    params.matches.push({
      path: params.relativePath,
      line: index + 1,
      text: lines[index],
    });
    if (params.matches.length >= params.maxResults) return true;
  }
  return false;
}

async function searchFiles(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const query = String(args.query ?? "").trim();
  if (!query) return "Error: missing <query>";
  const path = safeSearchPath(args);
  if (!path) {
    return "Error: search_files path must be relative to the workspace and cannot contain ..";
  }
  const maxResults = boundedSearchResultLimit(args);
  const fileGlob = String(args.file_glob ?? "").trim();
  const base = await ensureWorkspace(ctx.conversationId);
  const matches: SearchMatch[] = [];
  let truncated = false;
  try {
    truncated = await collectSearchMatches({
      base,
      relativePath: path,
      query,
      fileGlob,
      maxResults,
      matches,
    });
  } catch (error) {
    return `Error searching files: ${(error as Error).message}`;
  }
  if (matches.length === 0) {
    return `No matches found for ${JSON.stringify(query)} in ${path}.`;
  }
  const renderedMatches = matches.map(
    (match) => `${match.path}:${match.line}:${match.text}`,
  );
  const parts = [
    `${truncated ? "Found at least" : "Found"} ${matches.length} match${matches.length === 1 ? "" : "es"} for ${JSON.stringify(query)} in ${path}.`,
    ...renderedMatches,
  ];
  if (truncated) {
    parts.push("[results were truncated]");
  }
  return parts.join("\n");
}

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
  } catch (e) {
    return `Error deleting ${path}: ${(e as Error).message}`;
  }
}

async function runBash(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const command = String(args.command ?? "").trim();
  const timeout =
    typeof args.timeout_ms === "number" ? args.timeout_ms : 60_000;
  if (!command) return "Error: missing <command>";
  try {
    const r = await wsRunBash(ctx.conversationId, command, timeout);
    ctx.onFileChange?.();
    const parts: string[] = [];
    parts.push(`exit=${r.exitCode ?? "killed"} (${r.durationMs}ms)`);
    if (r.stdout) parts.push("stdout:\n" + r.stdout);
    if (r.stderr) parts.push("stderr:\n" + r.stderr);
    if (r.truncated) parts.push("[output was truncated]");
    return parts.join("\n");
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

export function projectScriptCommand(
  script: string,
  manager: string,
): string {
  if (!PROJECT_SCRIPT_ALLOWED_NAMES.includes(script as ProjectScriptName)) {
    throw new Error(
      `Unsupported project script "${script}". Allowed: ${PROJECT_SCRIPT_ALLOWED_NAMES.join(", ")}`,
    );
  }
  if (!PROJECT_SCRIPT_MANAGERS.includes(manager as ProjectScriptManager)) {
    throw new Error(
      `Unsupported package manager "${manager}". Allowed: ${PROJECT_SCRIPT_MANAGERS.join(", ")}`,
    );
  }
  return `${manager} run ${script}`;
}

function projectScriptTimeout(args: Record<string, unknown>): number {
  const requested =
    typeof args.timeout_ms === "number"
      ? args.timeout_ms
      : PROJECT_SCRIPT_DEFAULT_TIMEOUT_MS;
  return Math.min(requested, PROJECT_SCRIPT_MAX_TIMEOUT_MS);
}

function formatBackgroundTask(task: BackgroundTaskSnapshot): string {
  const parts = [
    `${task.id} ${task.status} pid=${task.pid ?? "unknown"} command=${task.command}`,
  ];
  if (task.stdout) parts.push("stdout:\n" + task.stdout);
  if (task.stderr) parts.push("stderr:\n" + task.stderr);
  return parts.join("\n");
}

async function runProjectScript(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const script = String(args.script ?? "").trim();
  const manager = String(args.manager ?? "npm").trim();
  const background = args.background === true;
  if (!script) return "Error: missing <script>";
  try {
    const command = projectScriptCommand(script, manager);
    if (background) {
      const cwd = await ensureWorkspace(ctx.conversationId);
      const task = startBackgroundTask({
        conversationId: ctx.conversationId,
        command,
        cwd,
      });
      return `Started background task.\n${formatBackgroundTask(task)}`;
    }
    const r = await wsRunBash(
      ctx.conversationId,
      command,
      projectScriptTimeout(args),
    );
    ctx.onFileChange?.();
    const parts: string[] = [];
    parts.push(`command=${command}`);
    parts.push(`exit=${r.exitCode ?? "killed"} (${r.durationMs}ms)`);
    if (r.stdout) parts.push("stdout:\n" + r.stdout);
    if (r.stderr) parts.push("stderr:\n" + r.stderr);
    if (r.truncated) parts.push("[output was truncated]");
    return parts.join("\n");
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

async function listBackgroundTasksTool(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const tasks = listBackgroundTasks(ctx.conversationId);
  if (tasks.length === 0) return "No background tasks.";
  return tasks.map(formatBackgroundTask).join("\n\n");
}

async function killBackgroundTaskTool(
  args: Record<string, unknown>,
  _ctx: ToolContext,
): Promise<string> {
  const id = String(args.id ?? "").trim();
  if (!id) return "Error: missing <id>";
  const task = killBackgroundTask(id);
  if (!task) return `Error: background task not found: ${id}`;
  return `Killed background task.\n${formatBackgroundTask(task)}`;
}

async function openPreview(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const url = previewUrl(ctx.conversationId);
  return `Preview is live at ${url}. The Canvas pane on the right shows it.`;
}

export const TOOLS: Record<string, ToolSpec> = {
  web_search: {
    name: "web_search",
    description:
      "Search the web via DuckDuckGo. Returns a numbered list of results.",
    params: [
      { name: "query", description: "what to search for", required: true },
    ],
    example:
      '<action name="web_search">\n<query>latest tensorflow release notes</query>\n</action>',
    mode: "both",
    run: webSearch,
  },
  fetch_url: {
    name: "fetch_url",
    description:
      "Fetch a web page and return its text content (truncated to ~8KB).",
    params: [
      { name: "url", description: "absolute http(s) URL", required: true },
    ],
    example:
      '<action name="fetch_url">\n<url>https://example.com</url>\n</action>',
    mode: "both",
    run: fetchUrl,
  },
  calc: {
    name: "calc",
    description: "Evaluate a numeric expression.",
    params: [
      { name: "expression", description: "math expression", required: true },
    ],
    example:
      '<action name="calc">\n<expression>2 + 2 * 3</expression>\n</action>',
    mode: "both",
    run: calc,
  },
  get_current_datetime: {
    name: "get_current_datetime",
    description:
      "Return the current app date and time during inference, including ISO, local time, Unix milliseconds, and timezone.",
    params: [],
    example: '<action name="get_current_datetime"></action>',
    mode: "both",
    run: getCurrentDatetime,
  },
  get_current_working_directory: {
    name: "get_current_working_directory",
    description:
      "Return the active workspace root and the app process current working directory.",
    params: [],
    example: '<action name="get_current_working_directory"></action>',
    mode: "code",
    run: getCurrentWorkingDirectory,
  },
  write_file: {
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
  },
  read_file: {
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
  },
  edit_file: {
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
  },
  search_files: {
    name: "search_files",
    description:
      "Search workspace files for a literal query with generated directories excluded. Use this before run_bash for finding references, usages, symbols, or text.",
    params: [
      {
        name: "query",
        description: "literal text to search for",
        required: true,
      },
      {
        name: "path",
        description: "relative file or directory to search; defaults to .",
      },
      {
        name: "file_glob",
        description: "optional file glob such as *.ts or src/**/*.tsx",
      },
      {
        name: "max_results",
        description: "maximum matching lines to return; default 200, max 500",
      },
    ],
    example:
      '<action name="search_files">\n<query>get_current_working_directory</query>\n<path>.</path>\n<file_glob>*.ts</file_glob>\n</action>',
    mode: "code",
    run: searchFiles,
  },
  list_files: {
    name: "list_files",
    description:
      "List the workspace tree only; it does not search file contents. This tool has no path parameter. Use search_files for references or text, and use run_bash for narrower directory listings.",
    params: [],
    example: '<action name="list_files"></action>',
    mode: "code",
    run: listFiles,
  },
  delete_file: {
    name: "delete_file",
    description: "Delete a file or directory from the workspace.",
    params: [{ name: "path", description: "path to delete", required: true }],
    example: '<action name="delete_file">\n<path>old.html</path>\n</action>',
    mode: "code",
    run: deleteFile,
  },
  run_bash: {
    name: "run_bash",
    description:
      "Run a bash command inside the workspace directory. Use for exact commands with arguments, npm install, git, formatters, and quick checks.",
    params: [
      {
        name: "command",
        description: "shell command",
        required: true,
        multiline: true,
      },
    ],
    example: '<action name="run_bash">\n<command>ls -la</command>\n</action>',
    mode: "code",
    run: runBash,
  },
  run_project_script: {
    name: "run_project_script",
    description:
      "Run an allowed package.json script by name. Allowed scripts: build, test, dev. Package managers: npm, pnpm. Do not use this for exact commands with extra arguments, such as a focused test file path; use run_bash instead.",
    params: [
      {
        name: "script",
        description: "script name: build, test, or dev",
        required: true,
      },
      {
        name: "manager",
        description: "package manager: npm or pnpm",
      },
      {
        name: "timeout_ms",
        description: "timeout in milliseconds",
      },
      {
        name: "background",
        description: "true to leave the script running as a background task",
      },
    ],
    example:
      '<action name="run_project_script">\n<script>build</script>\n<manager>npm</manager>\n</action>',
    mode: "code",
    run: runProjectScript,
  },
  list_background_tasks: {
    name: "list_background_tasks",
    description: "List background tasks started in this workspace.",
    params: [],
    example: '<action name="list_background_tasks"></action>',
    mode: "code",
    run: listBackgroundTasksTool,
  },
  kill_background_task: {
    name: "kill_background_task",
    description: "Kill a background task by id.",
    params: [
      {
        name: "id",
        description: "background task id",
        required: true,
      },
    ],
    example:
      '<action name="kill_background_task">\n<id>task-1</id>\n</action>',
    mode: "code",
    run: killBackgroundTaskTool,
  },
  open_preview: {
    name: "open_preview",
    description:
      "Reveal the Canvas preview. Call after creating or updating index.html so the user sees the result.",
    params: [],
    example: '<action name="open_preview"></action>',
    mode: "code",
    run: openPreview,
  },
};

function tz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function renderToolHelp(mode: "chat" | "code"): string {
  const wanted = (t: ToolSpec): boolean => {
    if (
      USE_WRITE_FILE_FOR_FILE_CHANGES &&
      mode === "code" &&
      t.name === "edit_file"
    ) {
      return false;
    }
    return t.mode === "both" || t.mode === mode;
  };
  const lines: string[] = [];
  for (const t of Object.values(TOOLS)) {
    if (!wanted(t)) continue;
    lines.push(`### ${t.name}`);
    lines.push(t.description);
    if (t.params.length) {
      lines.push("Parameters:");
      for (const p of t.params) {
        const req = p.required ? " (required)" : "";
        const multi = p.multiline ? " — multi-line OK" : "";
        lines.push(`  <${p.name}>: ${p.description}${req}${multi}`);
      }
    } else {
      lines.push("No parameters.");
    }
    lines.push("Example:");
    lines.push(t.example);
    lines.push("");
  }
  return lines.join("\n");
}

function projectInstructionsBlock(
  mode?: PromptMode | PromptMode[],
  opts: ProjectInstructionOptions = {},
): string[] {
  const md = loadProjectInstructions(mode, opts);
  if (!md) return [];
  return ["", "MODE AND PROJECT INSTRUCTIONS", "=============================", md];
}

export function chatSystemPrompt(enableTools: boolean): string {
  const now = new Date().toISOString();
  const day = new Date().toLocaleDateString("en-US", { weekday: "long" });
  if (!enableTools) {
    return [
      "You are Gemma, an AI assistant running 100% locally on the user's Mac.",
      `Current date/time: ${now} (${day}). Timezone: ${tz()}.`,
      "Be clear, concise, and helpful. Use markdown for formatting when useful.",
      ...projectInstructionsBlock("chat"),
    ].join("\n");
  }
  return [
    "You are Gemma, an AI assistant running 100% locally on the user's Mac.",
    `Current date/time: ${now} (${day}). Timezone: ${tz()}.`,
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
  codeMode: "code" | "build" | "plan" | "execute" = "build",
): string {
  const now = new Date().toISOString();
  const day = new Date().toLocaleDateString("en-US", { weekday: "long" });
  // Behavioral guidance lives in mode-specific Gemma addenda so planning and
  // plan execution can use different instructions without rebuilding this
  // structural prompt.
  const promptParts = [
    "You are Gemma, a local coding agent running entirely on the user's Mac.",
    "",
    "SESSION CONTEXT",
    "===============",
    `- Current date/time (UTC): ${now}`,
    `- Current day: ${day}`,
    `- Local timezone: ${tz()}`,
    `- Workspace root: ${workspacePath}`,
    `- Preview URL: ${previewHref}`,
    `- Active prompt mode: ${codeMode}`,
    ...projectInstructionsBlock(instructionModesForCodePrompt(codeMode), {
      includeCommon: codeMode !== "execute" && codeMode !== "plan",
    }),
  ];

  if (codeMode === "plan") return promptParts.join("\n");

  return [
    ...promptParts,
    "",
    "ACTION FORMAT — EXACT",
    '<action name="tool_name">',
    "<param_name>value</param_name>",
    "</action>",
    "",
    "<content> RULES — READ TWICE",
    "The string between <content> and </content> is WRITTEN TO DISK LITERALLY. Everything is saved.",
    "- NEVER put ``` fences at the start or end of <content>. Not ``` alone, not ```html, not ```js. None.",
    '- NEVER put explanatory text, "Key Features", "Instructions to Use", or any commentary INSIDE <content>. Only the file contents.',
    "- Close <content> with </content> on its own line, immediately after the last line of the file.",
    "- Then close the action with </action> on its own line.",
    "",
    "HARD RULES (apply in every code/build session)",
    "- Use write_file for all file changes for now. For an existing file, read_file first, then write the full current file content with the requested changes.",
    "- Do not use edit_file unless a future instruction explicitly enables it.",
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
  codeMode: "code" | "build" | "plan" | "execute",
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
  // Accept variations: <action name="x">, name='x', name=x, and self-closing no-arg actions.
  const openRe = /<action\s+name\s*=\s*["']?([a-zA-Z_][\w]*)["']?\s*(\/?)>/gi;
  openRe.lastIndex = from;
  const open = openRe.exec(text);
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
  const closeMatch = text.slice(bodyStart).match(/<\/action\s*>/i);
  if (!closeMatch || closeMatch.index === undefined) return "incomplete";
  const closeIdx = bodyStart + closeMatch.index;
  const body = text.slice(bodyStart, closeIdx);
  const args = parseActionBody(body);
  return {
    name,
    args,
    raw: text.slice(open.index, closeIdx + closeMatch[0].length),
    start: open.index,
    end: closeIdx + closeMatch[0].length,
  };
}

function parseActionBody(body: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  // Special-case <content>…</content> — use the LAST </content> to survive nested close-tags
  const contentOpen = body.indexOf("<content>");
  let outside = body;
  if (contentOpen >= 0) {
    const contentCloseRel = body.lastIndexOf("</content>");
    if (contentCloseRel > contentOpen) {
      let content = body.slice(
        contentOpen + "<content>".length,
        contentCloseRel,
      );
      content = content.replace(/^\n/, "");
      content = content.replace(/\n[ \t]*$/, "");
      args.content = content;
      outside =
        body.slice(0, contentOpen) +
        body.slice(contentCloseRel + "</content>".length);
    }
  }

  const tagRe = /<([a-zA-Z_][\w-]*)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(outside)) !== null) {
    const key = m[1];
    if (key === "content") continue;
    const raw = m[2];
    const trimmed = raw.trim();
    if (trimmed === "true") args[key] = true;
    else if (trimmed === "false") args[key] = false;
    else if (/^-?\d+$/.test(trimmed)) args[key] = Number(trimmed);
    else args[key] = raw.replace(/^\n/, "").replace(/\n[ \t]*$/, "");
  }
  return args;
}

export function emitSafeBoundary(buffer: string, from: number): number {
  // Return the largest index ≤ buffer.length such that the slice [from, idx)
  // cannot be the start of a forming <action ...> tag.
  // Scan backwards from the end for a '<' that could start "<action".
  for (let i = buffer.length - 1; i >= from; i--) {
    if (buffer[i] !== "<") continue;
    const tail = buffer.slice(i).toLowerCase();
    // Could this be the start of "<action"? If tail is shorter than "<action"
    // we can't be sure yet — hold back.
    if (tail.length < 8) {
      if ("<action".startsWith(tail)) return i;
      continue;
    }
    if (tail.startsWith("<action") && /\s/.test(tail[7])) return i;
    // Otherwise this '<' is some other tag — safe.
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
  if (!tool)
    return `Error: unknown tool "${name}". Available: ${Object.keys(TOOLS).join(", ")}`;
  try {
    return await tool.run(args, ctx);
  } catch (e) {
    return `Error running ${name}: ${(e as Error).message}`;
  }
}
