import { promises as fs } from "fs";
import { basename, join } from "path";
import { ensureWorkspace } from "../workspace";
import type { ToolContext, ToolSpec } from "./types";

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
const SEARCH_FILES_IGNORED_FILE_SUFFIXES = [".tsbuildinfo"] as const;

interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export const searchFilesTool: ToolSpec = {
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
};

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
