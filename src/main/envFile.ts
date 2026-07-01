import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { appRootDir } from "./runtimePaths";

const ENV_FILE_NAME = ".env";
const ENV_LINE_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SAFE_ENV_VALUE_RE = /^[A-Za-z0-9_./:@+=-]+$/;
const LINE_SPLIT_RE = /\r?\n/;
const DOUBLE_QUOTE = '"';
const SINGLE_QUOTE = "'";
const EMPTY_STRING = "";
const ENV_FILE_MODE = 0o600;

export function defaultEnvFilePath(): string {
  return join(appRootDir(), ENV_FILE_NAME);
}

export function loadEnvFileIntoProcess(
  envPath: string = defaultEnvFilePath(),
): void {
  if (!existsSync(envPath)) return;
  for (const [key, value] of parseEnvFile(readFileSync(envPath, "utf8"))) {
    if (!hasProcessEnvValue(key) && value.trim().length > 0) {
      process.env[key] = value;
    }
  }
}

export function readEnvFileValue(
  key: string,
  envPath: string = defaultEnvFilePath(),
): string | undefined {
  assertValidEnvKey(key);
  if (!existsSync(envPath)) return undefined;
  const value = parseEnvFile(readFileSync(envPath, "utf8")).get(key)?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function readCredentialEnvValue(
  key: string,
  envPath: string = defaultEnvFilePath(),
): string | undefined {
  assertValidEnvKey(key);
  const direct = process.env[key]?.trim();
  if (direct && direct.length > 0) return direct;
  loadEnvFileIntoProcess(envPath);
  const loaded = process.env[key]?.trim();
  return loaded && loaded.length > 0 ? loaded : undefined;
}

export function writeEnvFileValue(
  key: string,
  value: string,
  envPath: string = defaultEnvFilePath(),
): void {
  assertValidEnvKey(key);
  const cleanValue = value.trim();
  if (cleanValue.length === 0) {
    throw new Error(`${key} cannot be empty.`);
  }

  const nextLine = `${key}=${formatEnvValue(cleanValue)}`;
  const existing = existsSync(envPath)
    ? readFileSync(envPath, "utf8").split(LINE_SPLIT_RE)
    : [];
  let updated = false;
  const keyLineRe = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  const nextLines = existing.map((line) => {
    if (!updated && keyLineRe.test(line)) {
      updated = true;
      return nextLine;
    }
    return line;
  });

  if (!updated) {
    if (
      nextLines.length > 0 &&
      nextLines[nextLines.length - 1] !== EMPTY_STRING
    ) {
      nextLines.push(EMPTY_STRING);
    }
    nextLines.push(nextLine);
  }

  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, `${trimTrailingBlankLines(nextLines).join("\n")}\n`, {
    encoding: "utf8",
    mode: ENV_FILE_MODE,
  });
  process.env[key] = cleanValue;
}

function parseEnvFile(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of text.split(LINE_SPLIT_RE)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const match = ENV_LINE_RE.exec(rawLine);
    if (!match) continue;
    const key = match[1];
    const rawValue = match[2] ?? EMPTY_STRING;
    values.set(key, unquoteEnvValue(rawValue.trim()));
  }
  return values;
}

function hasProcessEnvValue(key: string): boolean {
  const value = process.env[key]?.trim();
  return value != null && value.length > 0;
}

function assertValidEnvKey(key: string): void {
  if (!ENV_KEY_RE.test(key)) {
    throw new Error(`Invalid environment variable name: ${key}`);
  }
}

function unquoteEnvValue(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if (
    (first === DOUBLE_QUOTE && last === DOUBLE_QUOTE) ||
    (first === SINGLE_QUOTE && last === SINGLE_QUOTE)
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function formatEnvValue(value: string): string {
  if (SAFE_ENV_VALUE_RE.test(value)) return value;
  return `${DOUBLE_QUOTE}${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}${DOUBLE_QUOTE}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const next = [...lines];
  while (next.length > 0 && next[next.length - 1] === EMPTY_STRING) {
    next.pop();
  }
  return next;
}
