import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadEnvFileIntoProcess,
  readEnvFileValue,
  writeEnvFileValue,
} from "../../src/main/envFile";
import { validateRemoteModelReady } from "../../src/main/modelConfig";
import { setRuntimePaths } from "../../src/main/runtimePaths";

const TEST_PREFIX = "gemma-env-file-";
const TEST_KEY = "GEMINI_API_KEY";
const FILE_VALUE = "file-key";
const SHELL_VALUE = "shell-key";
const UPDATED_VALUE = "updated-key";

function tempEnvPath(): string {
  const dir = mkdtempSync(join(tmpdir(), TEST_PREFIX));
  tempDirs.push(dir);
  return join(dir, ".env");
}

const tempDirs: string[] = [];
const originalGeminiApiKey = process.env[TEST_KEY];

afterEach(() => {
  if (originalGeminiApiKey == null) {
    delete process.env[TEST_KEY];
  } else {
    process.env[TEST_KEY] = originalGeminiApiKey;
  }
  vi.unstubAllEnvs();
  setRuntimePaths({
    appRoot: process.cwd(),
    packaged: false,
    userData: process.cwd(),
  });
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("env file credentials", () => {
  it("loads .env values into missing process env entries", () => {
    const envPath = tempEnvPath();
    delete process.env[TEST_KEY];
    writeFileSync(envPath, `${TEST_KEY}=${FILE_VALUE}\n`, "utf8");

    loadEnvFileIntoProcess(envPath);

    expect(process.env[TEST_KEY]).toBe(FILE_VALUE);
  });

  it("keeps existing shell environment values ahead of .env values", () => {
    const envPath = tempEnvPath();
    process.env[TEST_KEY] = SHELL_VALUE;
    writeFileSync(envPath, `${TEST_KEY}=${FILE_VALUE}\n`, "utf8");

    loadEnvFileIntoProcess(envPath);

    expect(process.env[TEST_KEY]).toBe(SHELL_VALUE);
  });

  it("writes and updates one .env key without dropping other values", () => {
    const envPath = tempEnvPath();
    writeFileSync(envPath, ["COHERE_API_KEY=cohere-key", ""].join("\n"), "utf8");

    writeEnvFileValue(TEST_KEY, FILE_VALUE, envPath);
    writeEnvFileValue(TEST_KEY, UPDATED_VALUE, envPath);

    expect(readEnvFileValue(TEST_KEY, envPath)).toBe(UPDATED_VALUE);
    expect(readFileSync(envPath, "utf8")).toContain("COHERE_API_KEY=cohere-key");
  });

  it("validates remote models with credentials loaded from .env", () => {
    const envPath = tempEnvPath();
    const appRoot = join(envPath, "..");
    vi.stubEnv("GEMMA_MODEL_CONFIG", join(process.cwd(), "models.config.json"));
    vi.stubEnv(TEST_KEY, "");
    setRuntimePaths({
      appRoot,
      packaged: false,
      userData: appRoot,
    });
    writeFileSync(envPath, `${TEST_KEY}=${FILE_VALUE}\n`, "utf8");

    expect(() => validateRemoteModelReady("gemma-4-31b-it")).not.toThrow();
    expect(process.env[TEST_KEY]).toBe(FILE_VALUE);
  });
});
