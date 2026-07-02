import { spawn, ChildProcess, spawnSync } from "child_process";
import { homedir } from "os";
import { join } from "path";
import {
  cpSync,
  Dirent,
  existsSync,
  createWriteStream,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { userDataDir } from "./runtimePaths";
import { type ModelProvenance } from "../shared/types";
import { modelRuntimeForName } from "./modelConfig";
import { readSSE } from "./sse";

const MLX_PORT = 11435;
export const MLX_SERVER_PORT = MLX_PORT;
const MLX_HOST = `127.0.0.1:${MLX_PORT}`;
const MLX_URL = `http://${MLX_HOST}`;

const MLX_FIRST_TOKEN_TIMEOUT_MS = 120_000;
const MLX_HEALTH_POLL_INTERVAL_MS = 1500;
const MLX_MINUTE_MS = 60_000;
const MLX_SERVER_START_TIMEOUT_MINUTES = 60;
const MLX_SERVER_START_TIMEOUT_MS =
  MLX_SERVER_START_TIMEOUT_MINUTES * MLX_MINUTE_MS;
const MLX_WARMUP_MAX_TOKENS = 16;
const MLX_LOG_RETENTION_LINES = 250;
const MLX_LOG_TAIL_LINES = 80;
const MLX_SPAWN_TIMEOUT_MS = 5_000;
const MLX_VERIFICATION_TIMEOUT_MS = 15_000;
const MLX_PYTHON_MINOR_MIN = 10;
const MLX_PYTHON_MINOR_MAX = 13;
const MLX_CHAT_MAX_TOKENS = 8192;
const MLX_CHAT_TEMPERATURE = 0.7;
const MLX_ERROR_TEXT_TAIL_CHARS = 500;
const MLX_LOG_TEXT_LENGTH_LIMIT = 180;
const MLX_SERVER_STOP_TIMEOUT_MS = 5_000;
const MLX_PYTHON_PACKAGES = [
  "mlx",
  "mlx-lm>=0.31.3",
  "mlx-vlm>=0.6.2",
] as const;
const MLX_RUNTIME_IMPORT_CHECK =
  "import mlx_lm; import mlx_vlm.models.gemma4_unified; print('ok')";
const MLX_MODEL_WEIGHT_FILE = /^model(?:-[0-9]+-of-[0-9]+)?\.safetensors$/;
const MLX_GLOBAL_HF_CACHE_DIR = join(homedir(), ".cache", "huggingface");
const MLX_HF_HUB_CACHE_DIR_NAME = "hub";
const MLX_GLOBAL_HF_HUB_DIR = join(
  MLX_GLOBAL_HF_CACHE_DIR,
  MLX_HF_HUB_CACHE_DIR_NAME,
);
const MLX_HF_CACHE_SYMLINK_TYPE = "dir";
const MLX_SERVER_LOG_FILE_NAME = "mlx-server.log";
const MLX_VLM_MAX_KV_SIZE_ENV = "GEMMA_MLX_VLM_MAX_KV_SIZE";
const MLX_VLM_KV_BITS_ENV = "GEMMA_MLX_VLM_KV_BITS";
const MLX_VLM_KV_QUANT_SCHEME_ENV = "GEMMA_MLX_VLM_KV_QUANT_SCHEME";
const MLX_HF_HOME_ENV = "HF_HOME";
const MLX_TRANSFORMERS_CACHE_ENV = "TRANSFORMERS_CACHE";
const MLX_HF_HUB_DISABLE_TELEMETRY_ENV = "HF_HUB_DISABLE_TELEMETRY";
const MLX_HF_HUB_DISABLE_XET_ENV = "HF_HUB_DISABLE_XET";
const MLX_HF_HUB_DOWNLOAD_TIMEOUT_ENV = "HF_HUB_DOWNLOAD_TIMEOUT";
const MLX_PYTHON_UNBUFFERED_ENV = "PYTHONUNBUFFERED";
const MLX_ENABLED_ENV_VALUE = "1";
const MLX_HF_HUB_DOWNLOAD_TIMEOUT_SECONDS = "600";
const MLX_SNAPSHOT_DOWNLOAD_MAX_WORKERS = 4;
const MLX_SNAPSHOT_DOWNLOAD_PROGRESS_POLL_MS = 1000;
const MODEL_PROVENANCE_FETCH_TIMEOUT_MS = 8_000;
const MLX_SNAPSHOT_DOWNLOAD_SCRIPT = `
import sys
from pathlib import Path
from huggingface_hub import snapshot_download

repo_id = sys.argv[1]
hf_home = Path(sys.argv[2])
cache_dir = hf_home / "${MLX_HF_HUB_CACHE_DIR_NAME}"
print(f"snapshot_download_start {repo_id}", flush=True)
path = snapshot_download(
    repo_id=repo_id,
    cache_dir=cache_dir,
    max_workers=${MLX_SNAPSHOT_DOWNLOAD_MAX_WORKERS},
)
print(f"snapshot_download_complete {path}", flush=True)
`.trim();
const MLX_SERVER_LOAD_ERROR_INIT_MARKER = "self._default_model_load_error = None";
const MLX_SERVER_BROKEN_LOAD_BLOCK = `        # Load the default model if it is given
        self.model_provider.load_default()
`;
const MLX_SERVER_PATCHED_LOAD_BLOCK = `        # Load the default model if it is given
        try:
            self.model_provider.load_default()
        except Exception as e:
            self._default_model_load_error = e
            logging.exception("Failed to load default model")
            while True:
                try:
                    rqueue, _, _ = self.requests.get_nowait()
                except QueueEmpty:
                    break
                rqueue.put(e)
            return
`;
const MLX_SERVER_THREAD_START_BLOCK = `        self._stop = False
        self._generation_thread = Thread(target=self._generate)
`;
const MLX_SERVER_PATCHED_THREAD_START_BLOCK = `        self._stop = False
        self._default_model_load_error = None
        self._generation_thread = Thread(target=self._generate)
`;
const MLX_SERVER_GENERATE_QUEUE_BLOCK = `        response_queue = Queue()
        self.requests.put((response_queue, request, generation_args))
`;
const MLX_SERVER_PATCHED_GENERATE_QUEUE_BLOCK = `        if self._default_model_load_error is not None:
            raise self._default_model_load_error
        if not self._generation_thread.is_alive():
            raise RuntimeError("MLX generation thread is not running")

        response_queue = Queue()
        self.requests.put((response_queue, request, generation_args))
`;
const MLX_GEMMA4_TEXT_SANITIZER_MARKER = "drop_shared_kv_weight =";
const MLX_GEMMA4_TEXT_OPTIMIZED_ATTENTION_MARKER =
  "self.has_kv = layer_idx <";
const MLX_GEMMA4_TEXT_SANITIZE_BLOCK = `        sanitized = {}
        for k, v in weights.items():
`;
const MLX_GEMMA4_TEXT_PATCHED_SANITIZE_BLOCK = `        sanitized = {}
        first_kv_shared_layer = (
            self.args.num_hidden_layers - self.args.num_kv_shared_layers
        )
        drop_shared_kv_weight = (
            "self_attn.k_proj",
            "self_attn.v_proj",
            "self_attn.k_norm",
            "self_attn.v_norm",
        )

        def is_dead_shared_kv_weight(key):
            parts = key.split(".")
            try:
                layers_index = parts.index("layers")
                layer_index = int(parts[layers_index + 1])
            except (ValueError, IndexError):
                return False
            if first_kv_shared_layer <= 0 or layer_index < first_kv_shared_layer:
                return False
            return any(name in key for name in drop_shared_kv_weight)

        for k, v in weights.items():
            if is_dead_shared_kv_weight(k):
                continue
`;

let serverProc: ChildProcess | null = null;
let currentModel: string | null = null;
let serverLogStream: ReturnType<typeof createWriteStream> | null = null;
let lastServerCommand = "";

type MLXLogStream = "stdout" | "stderr";

interface MLXLogLine {
  stream: MLXLogStream;
  text: string;
  ts: string;
}

const recentMlxLogBuffer: MLXLogLine[] = [];

interface MLXSnapshotInfo {
  name: string;
  path: string;
  hasModelSafetensors: boolean;
  metadataTotalSize: number | null;
}

export type MLXModelCacheStatus =
  | "missing"
  | "incomplete"
  | "missing-weights"
  | "complete";

export interface MLXModelCacheInspection {
  modelName: string;
  modelCachePath: string;
  status: MLXModelCacheStatus;
  exists: boolean;
  incompleteBlobPaths: string[];
  snapshotFolders: string[];
  snapshots: MLXSnapshotInfo[];
  metadataTotalSizeBytes: number | null;
  modelWeightsBytes: number;
  hasModelSafetensors: boolean;
}

export function isModelCacheReadyForInference(
  inspection: MLXModelCacheInspection,
): boolean {
  if (!inspection.exists) return false;
  if (inspection.incompleteBlobPaths.length > 0) return false;
  if (inspection.snapshotFolders.length === 0) return false;
  if (!inspection.hasModelSafetensors) return false;
  if (inspection.metadataTotalSizeBytes == null) return true;
  return inspection.modelWeightsBytes >= inspection.metadataTotalSizeBytes;
}

interface MLXChatRequestFailureOptions {
  endpoint: string;
  model: string;
  elapsedMs: number;
  status?: number;
  statusText?: string;
  cause?: string;
  responseText?: string;
}

interface HuggingFaceModelInfo {
  sha?: unknown;
  lastModified?: unknown;
}

interface MLXServerErrorResponse {
  error?: unknown;
}

// ---------------------------------------------------------------------------
// Paths — everything lives under <appData>/mlx/
// ---------------------------------------------------------------------------

function dataDir(): string {
  return join(userDataDir(), "mlx");
}

function mlxLogDir(): string {
  return join(dataDir(), "logs");
}

function mlxLogFilePath(): string {
  return join(mlxLogDir(), MLX_SERVER_LOG_FILE_NAME);
}

function venvDir(): string {
  return join(dataDir(), "venv");
}

/** The python binary inside our managed venv */
function venvPython(): string {
  return join(venvDir(), "bin", "python3");
}

function modelsDir(): string {
  return join(dataDir(), "models");
}

function modelCacheFolder(model: string): string {
  const cacheModel = model.replaceAll("/", "--");
  return join(modelsDir(), "hub", `models--${cacheModel}`);
}

function globalModelCacheFolder(model: string): string {
  const cacheModel = model.replaceAll("/", "--");
  return join(MLX_GLOBAL_HF_HUB_DIR, `models--${cacheModel}`);
}

function ensureLocalModelSymlink(model: string): boolean {
  const source = globalModelCacheFolder(model);
  const destination = modelCacheFolder(model);

  if (
    !existsSync(MLX_GLOBAL_HF_CACHE_DIR) ||
    !existsSync(MLX_GLOBAL_HF_HUB_DIR)
  ) {
    return false;
  }

  if (!existsSync(source)) {
    return false;
  }

  if (existsSync(destination)) {
    const existingInspection = inspectModelCache(model);
    if (isModelCacheReadyForInference(existingInspection)) {
      return true;
    }
    try {
      rmSync(destination, { recursive: true, force: true });
    } catch {
      return false;
    }
  }

  try {
    mkdirSync(join(modelsDir(), "hub"), { recursive: true });
    try {
      symlinkSync(source, destination, MLX_HF_CACHE_SYMLINK_TYPE);
    } catch {
      cpSync(source, destination, { recursive: true });
    }

    const syncedInspection = inspectModelCache(model);
    return isModelCacheReadyForInference(syncedInspection);
  } catch {
    return false;
  }
}

function addMlxLog(stream: MLXLogStream, chunk: string): void {
  const text = chunk.trim();
  if (!text) return;
  recentMlxLogBuffer.push({
    ts: new Date().toISOString(),
    stream,
    text,
  });
  if (recentMlxLogBuffer.length > MLX_LOG_RETENTION_LINES) {
    recentMlxLogBuffer.splice(
      0,
      recentMlxLogBuffer.length - MLX_LOG_RETENTION_LINES,
    );
  }
}

function ensureMlxLogFileStream(): void {
  if (serverLogStream) return;
  mkdirSync(mlxLogDir(), { recursive: true });
  serverLogStream = createWriteStream(mlxLogFilePath(), { flags: "a" });
}

function appendMlxLogFile(stream: MLXLogStream, text: string): void {
  if (!serverLogStream || !text) return;
  const ts = new Date().toISOString();
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (!line) continue;
    serverLogStream.write(`[${ts}] ${stream}: ${line}\n`);
  }
}

function captureMlxOutput(stream: MLXLogStream, text: string): void {
  addMlxLog(stream, text);
  appendMlxLogFile(stream, text);
}

function closeMlxLogFile(): void {
  if (!serverLogStream) return;
  serverLogStream.end();
  serverLogStream = null;
}

export function getRecentMlxLogs(limit = MLX_LOG_TAIL_LINES): MLXLogLine[] {
  return recentMlxLogBuffer
    .slice(Math.max(0, recentMlxLogBuffer.length - limit))
    .map((line) => ({ ...line }));
}

export function getMlxServerLogPath(): string {
  return mlxLogFilePath();
}

export function getLastMlxServerCommand(): string {
  return lastServerCommand;
}

function formatLogTail(lines?: MLXLogLine[]): string {
  const tail = lines ?? getRecentMlxLogs();
  if (tail.length === 0) {
    return "No recent MLX logs available";
  }
  return tail
    .map((line) => `[${line.ts}] ${line.stream}: ${line.text}`)
    .join("\n");
}

function extractServerError(responseText?: string): string | null {
  if (!responseText) return null;
  try {
    const parsed = JSON.parse(responseText) as MLXServerErrorResponse;
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error.trim();
    }
  } catch {
    // Response bodies from upstream can be plain text. Fall through to text.
  }

  const text = responseText.trim();
  return text.length > 0 ? text : null;
}

function summarizeChatFailure({
  endpoint,
  model,
  elapsedMs,
  status,
  statusText,
  cause,
  responseText,
}: MLXChatRequestFailureOptions): string {
  const serverError = extractServerError(responseText);
  const parts: string[] = [];
  if (serverError) {
    parts.push(`serverError=${serverError}`);
  }
  parts.push(
    `endpoint=${endpoint}`,
    `model=${model}`,
    `elapsedMs=${elapsedMs}`,
  );
  if (status !== undefined) {
    parts.push(`status=${status}`);
  } else {
    parts.push("status=network");
  }
  if (statusText) {
    parts.push(`statusText=${statusText}`);
  }
  if (cause) {
    parts.push(`cause=${cause}`);
  }
  const statusTextTail = responseText
    ? responseText.slice(-MLX_ERROR_TEXT_TAIL_CHARS)
    : "N/A";
  const responseDetail = serverError
    ? ""
    : ` | response_tail=${statusTextTail}`;
  return `${parts.join(" ")}${responseDetail} | logs=${formatLogTail()}`;
}

function collectIncompleteBlobs(
  folder: string,
  results: string[] = [],
): string[] {
  const entries: Dirent[] = readdirSync(folder, { withFileTypes: true });
  for (const entry of entries) {
    const nextPath = join(folder, entry.name);
    if (entry.isDirectory()) {
      collectIncompleteBlobs(nextPath, results);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".incomplete")) {
      results.push(nextPath);
    }
  }
  return results;
}

function getDirectoryBytes(path: string): number {
  let totalBytes = 0;
  const entries = readdirSync(path, { withFileTypes: true });

  for (const entry of entries) {
    const childPath = join(path, entry.name);
    if (entry.isDirectory()) {
      totalBytes += getDirectoryBytes(childPath);
      continue;
    }
    if (!entry.isFile()) continue;
    const stats = statSync(childPath);
    totalBytes += stats.size;
  }

  return totalBytes;
}

function readSafetensorsIndexSize(snapshotDir: string): number | null {
  const indexPath = join(snapshotDir, "model.safetensors.index.json");
  if (!existsSync(indexPath)) return null;
  try {
    const raw = readFileSync(indexPath, "utf8");
    const parsed = JSON.parse(raw) as {
      metadata?: { total_size?: number };
    };
    const totalSize = parsed?.metadata?.total_size;
    if (typeof totalSize === "number") {
      return totalSize;
    }
  } catch {
    // ignore malformed index data for best-effort status
  }
  return null;
}

function snapshotInspection(
  snapshotDirName: string,
  snapshotDir: string,
): MLXSnapshotInfo {
  const snapshotEntries = readdirSync(snapshotDir, { withFileTypes: true });
  const hasModelSafetensors = snapshotEntries.some(
    (entry) =>
      (entry.isFile() || entry.isSymbolicLink()) &&
      MLX_MODEL_WEIGHT_FILE.test(entry.name),
  );
  const metadataTotalSize = readSafetensorsIndexSize(snapshotDir);
  return {
    name: snapshotDirName,
    path: snapshotDir,
    hasModelSafetensors,
    metadataTotalSize,
  };
}

export function linkGlobalCacheModel(model: string): boolean {
  if (
    !existsSync(MLX_GLOBAL_HF_CACHE_DIR) ||
    !existsSync(MLX_GLOBAL_HF_HUB_DIR)
  ) {
    return false;
  }
  return ensureLocalModelSymlink(model);
}

// ---------------------------------------------------------------------------
// System Python detection
// ---------------------------------------------------------------------------

/**
 * Find a compatible system Python (3.10–3.13).
 * We explicitly skip 3.14+ because mlx-lm doesn't publish wheels for it yet.
 * We try versioned binaries first (most reliable), then fall back to `python3`.
 */
function findSystemPython(): string | null {
  // Prefer specific known-good versions, newest first
  const versionedCandidates = [
    "/opt/homebrew/bin/python3.13",
    "/opt/homebrew/bin/python3.12",
    "/opt/homebrew/bin/python3.11",
    "/opt/homebrew/bin/python3.10",
    "/opt/homebrew/opt/python@3.13/bin/python3.13",
    "/opt/homebrew/opt/python@3.12/bin/python3.12",
    "/opt/homebrew/opt/python@3.11/bin/python3.11",
    "/opt/homebrew/opt/python@3.10/bin/python3.10",
    "/usr/local/bin/python3.13",
    "/usr/local/bin/python3.12",
    "/usr/local/bin/python3.11",
    "/usr/local/bin/python3.10",
  ];

  for (const c of versionedCandidates) {
    try {
      const s = spawnSync(c, ["--version"], {
        timeout: MLX_SPAWN_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (s.status === 0) {
        console.log(
          `[mlx] Found compatible Python: ${c} (${s.stdout.toString().trim()})`,
        );
        return c;
      }
    } catch {
      // not available
    }
  }

  // Last resort: try generic python3 but verify it's not 3.14+
  const fallbacks = [
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    "/usr/bin/python3",
  ];
  for (const c of fallbacks) {
    try {
      const s = spawnSync(c, ["--version"], {
        timeout: MLX_SPAWN_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (s.status === 0) {
        const ver = s.stdout.toString().trim(); // e.g. "Python 3.13.2"
        const match = ver.match(/Python 3\.(\d+)/);
        const minor = match ? parseInt(match[1], 10) : MLX_PYTHON_MINOR_MAX + 1;
        if (minor >= MLX_PYTHON_MINOR_MIN && minor <= MLX_PYTHON_MINOR_MAX) {
          console.log(`[mlx] Found compatible Python: ${c} (${ver})`);
          return c;
        } else if (minor < MLX_PYTHON_MINOR_MIN) {
          console.log(`[mlx] Skipping ${c} — ${ver} is too old (need 3.10+)`);
        } else {
          console.log(`[mlx] Skipping ${c} — ${ver} is too new for mlx-lm`);
        }
      }
    } catch {
      // not available
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// MLX detection
// ---------------------------------------------------------------------------

export interface MLXStatus {
  /** Python to use for running the selected MLX runtime. */
  python: string;
  /** Whether required MLX runtime packages are installed and importable. */
  installed: boolean;
}

/**
 * Check if the required MLX runtimes are ready to use.
 * Returns the python path to use and whether the packages are installed.
 */
export function locateMLX(): MLXStatus | null {
  // 1. Check if we have a working venv with MLX runtimes installed
  const vPy = venvPython();
  if (existsSync(vPy)) {
    // Verify the venv Python is 3.10+ — older versions can't run modern mlx-lm
    try {
      const verCheck = spawnSync(vPy, ["--version"], {
        timeout: MLX_SPAWN_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const verStr = verCheck.stdout?.toString().trim() || "";
      const verMatch = verStr.match(/Python 3\.(\d+)/);
      const minor = verMatch
        ? parseInt(verMatch[1], 10)
        : MLX_PYTHON_MINOR_MIN - 1;
      if (minor < MLX_PYTHON_MINOR_MIN) {
        console.log(
          `[mlx] Existing venv uses ${verStr} (too old). Deleting and recreating…`,
        );
        try {
          rmSync(venvDir(), { recursive: true, force: true });
        } catch {
          /* ok */
        }
        // Fall through to system python detection below
      } else {
        // Venv Python is compatible — check if required MLX runtimes are installed
        try {
          const check = spawnSync(vPy, ["-c", MLX_RUNTIME_IMPORT_CHECK], {
            timeout: MLX_VERIFICATION_TIMEOUT_MS,
            stdio: ["ignore", "pipe", "pipe"],
          });
          const stdout = check.stdout?.toString().trim() || "";
          if (check.status === 0 && stdout.includes("ok")) {
            console.log("[mlx] Found MLX runtimes in venv");
            applyMlxPatches(vPy);
            return { python: vPy, installed: true };
          }
        } catch {
          // venv exists but one of the required runtimes is not importable
        }
        // Venv exists but an MLX runtime is missing — can still pip install into it
        return { python: vPy, installed: false };
      }
    } catch {
      // Can't check version — treat as needing recreation
      console.log("[mlx] Cannot determine venv Python version. Recreating…");
      try {
        rmSync(venvDir(), { recursive: true, force: true });
      } catch {
        /* ok */
      }
    }
  }

  // 2. No venv yet — find a compatible system python so we can create one
  const sysPython = findSystemPython();
  if (!sysPython) return null;
  return { python: sysPython, installed: false };
}

// ---------------------------------------------------------------------------
// Installation — creates a venv and installs mlx-lm
// ---------------------------------------------------------------------------

export type InstallProgress = {
  stage: "download" | "install";
  message: string;
};

/**
 * Install mlx-lm into a dedicated virtual environment.
 * Uses --index-url to bypass any corporate pip registries.
 * Returns the venv python path to use for all subsequent operations.
 */
export async function installMLX(
  onProgress: (p: InstallProgress) => void,
): Promise<string> {
  const sysPython = findSystemPython();
  if (!sysPython) {
    throw new Error(
      "Python 3.10–3.13 not found. Please install Python via Homebrew: brew install python@3.13",
    );
  }

  const vDir = venvDir();
  const vPy = venvPython();

  // Step 1: Create venv if needed
  if (!existsSync(vPy)) {
    onProgress({
      stage: "install",
      message: "Creating Python virtual environment…",
    });
    console.log(`[mlx] Creating venv at ${vDir} using ${sysPython}`);
    await runProcess(sysPython, ["-m", "venv", vDir], onProgress);
  }

  // Step 2: Upgrade pip first (avoids old-pip issues)
  onProgress({ stage: "install", message: "Upgrading pip…" });
  await runProcess(
    vPy,
    [
      "-m",
      "pip",
      "install",
      "--upgrade",
      "pip",
      "--index-url",
      "https://pypi.org/simple/",
    ],
    onProgress,
  );

  // Step 3: Install MLX packages into the managed venv
  onProgress({
    stage: "install",
    message: "Installing MLX runtime packages (this may take a few minutes)…",
  });
  await runProcess(
    vPy,
    [
      "-m",
      "pip",
      "install",
      "--upgrade",
      ...MLX_PYTHON_PACKAGES,
      "--index-url",
      "https://pypi.org/simple/",
    ],
    onProgress,
  );

  // Verify the install worked
  const check = spawnSync(vPy, ["-c", 'import mlx_lm; print("ok")'], {
    timeout: MLX_VERIFICATION_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (check.status !== 0 || !check.stdout?.toString().includes("ok")) {
    const err =
      check.stderr?.toString().slice(-MLX_ERROR_TEXT_TAIL_CHARS) ||
      "unknown error";
    throw new Error(`mlx-lm installed but failed to import: ${err}`);
  }

  console.log("[mlx] mlx-lm installed successfully");
  applyMlxPatches(vPy);
  return vPy;
}

/**
 * Apply local hot-patches to the installed mlx-lm package.
 *
 * Applies small, content-detected fixes to the managed mlx-lm install.
 */
export function applyMlxPatches(vPy: string): void {
  applyMlxServerPatch(vPy);
  applyGemma4TextPatch(vPy);
}

function applyMlxServerPatch(vPy: string): void {
  const targetPath = resolvePythonModulePath(vPy, "mlx_lm.server");
  if (!targetPath) {
    console.log(
      "[mlx] patch: mlx_lm.server not importable, skipping (mlx-lm may be too old)",
    );
    return;
  }

  let installedSource = "";
  try {
    installedSource = readFileSync(targetPath, "utf8");
  } catch (e) {
    console.log("[mlx] patch: cannot read", targetPath, e);
    return;
  }

  const patchedSource = patchMlxServerSource(installedSource);
  if (!patchedSource) {
    console.log("[mlx] patch: mlx_lm.server already compatible, skipping");
    return;
  }

  const backupPath = `${targetPath}.bak.upstream`;
  try {
    if (!existsSync(backupPath)) {
      cpSync(targetPath, backupPath);
    }
    writeFileSync(targetPath, patchedSource);
    console.log(
      "[mlx] patch: applied server default-load error propagation fix",
    );
  } catch (e) {
    console.warn("[mlx] patch: failed to update mlx_lm.server:", e);
  }
}

export function patchMlxServerSource(source: string): string | null {
  if (source.includes(MLX_SERVER_LOAD_ERROR_INIT_MARKER)) {
    return null;
  }
  if (
    !source.includes(MLX_SERVER_BROKEN_LOAD_BLOCK) ||
    !source.includes(MLX_SERVER_THREAD_START_BLOCK) ||
    !source.includes(MLX_SERVER_GENERATE_QUEUE_BLOCK)
  ) {
    return null;
  }

  return source
    .replace(MLX_SERVER_THREAD_START_BLOCK, MLX_SERVER_PATCHED_THREAD_START_BLOCK)
    .replace(MLX_SERVER_BROKEN_LOAD_BLOCK, MLX_SERVER_PATCHED_LOAD_BLOCK)
    .replace(MLX_SERVER_GENERATE_QUEUE_BLOCK, MLX_SERVER_PATCHED_GENERATE_QUEUE_BLOCK);
}

function applyGemma4TextPatch(vPy: string): void {
  // Resolve the canonical path of the installed file via the venv python so
  // we don't have to hardcode the python minor version in the site-packages path.
  const targetPath = resolvePythonModulePath(vPy, "mlx_lm.models.gemma4_text");
  if (!targetPath) {
    console.log(
      "[mlx] patch: gemma4_text not importable, skipping (mlx-lm may be too old)",
    );
    return;
  }

  let installedSource = "";
  try {
    installedSource = readFileSync(targetPath, "utf8");
  } catch (e) {
    console.log("[mlx] patch: cannot read", targetPath, e);
    return;
  }

  const backupPath = `${targetPath}.bak.upstream`;
  if (
    !installedSource.includes(MLX_GEMMA4_TEXT_OPTIMIZED_ATTENTION_MARKER) &&
    existsSync(backupPath)
  ) {
    try {
      installedSource = readFileSync(backupPath, "utf8");
    } catch (e) {
      console.warn("[mlx] patch: cannot read gemma4_text upstream backup:", e);
      return;
    }
  }

  const patchedSource = patchMlxGemma4TextSource(installedSource);
  if (!patchedSource) {
    console.log("[mlx] patch: gemma4_text already compatible, skipping");
    return;
  }

  try {
    if (!existsSync(backupPath)) {
      cpSync(targetPath, backupPath);
    }
    writeFileSync(targetPath, patchedSource);
    console.log(
      "[mlx] patch: applied gemma4_text shared-KV sanitizer fix",
    );
  } catch (e) {
    console.warn("[mlx] patch: failed to update gemma4_text.py:", e);
  }
}

export function patchMlxGemma4TextSource(source: string): string | null {
  if (source.includes(MLX_GEMMA4_TEXT_SANITIZER_MARKER)) {
    return null;
  }
  if (
    !source.includes(MLX_GEMMA4_TEXT_OPTIMIZED_ATTENTION_MARKER) ||
    !source.includes(MLX_GEMMA4_TEXT_SANITIZE_BLOCK)
  ) {
    return null;
  }

  return source.replace(
    MLX_GEMMA4_TEXT_SANITIZE_BLOCK,
    MLX_GEMMA4_TEXT_PATCHED_SANITIZE_BLOCK,
  );
}

function resolvePythonModulePath(vPy: string, moduleName: string): string | null {
  const resolve = spawnSync(
    vPy,
    [
      "-c",
      `import ${moduleName} as m; import sys; sys.stdout.write(m.__file__)`,
    ],
    { timeout: MLX_VERIFICATION_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (resolve.status !== 0) {
    return null;
  }
  const targetPath = resolve.stdout?.toString().trim();
  if (!targetPath || !existsSync(targetPath)) {
    return null;
  }
  return targetPath;
}

/** Run a subprocess and stream output to onProgress */
function runProcess(
  cmd: string,
  args: string[],
  onProgress: (p: InstallProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PIP_DISABLE_PIP_VERSION_CHECK: "1",
        // Force public PyPI — don't inherit corporate pip.conf
        PIP_INDEX_URL: "https://pypi.org/simple/",
        PIP_EXTRA_INDEX_URL: "",
      },
    });

    let stderr = "";
    proc.stdout?.on("data", (d) => {
      const line = d.toString().trim();
      if (line)
        onProgress({
          stage: "install",
          message: line.slice(0, MLX_LOG_TEXT_LENGTH_LIMIT),
        });
    });
    proc.stderr?.on("data", (d) => {
      stderr += d.toString();
      const line = d.toString().trim();
      if (line)
        onProgress({
          stage: "install",
          message: line.slice(0, MLX_LOG_TEXT_LENGTH_LIMIT),
        });
    });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${cmd} ${args.slice(0, 3).join(" ")} failed (exit ${code}): ${stderr.slice(-MLX_ERROR_TEXT_TAIL_CHARS)}`,
          ),
        );
    });
  });
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

export interface ServerProgress {
  message: string;
  /** 0.0–1.0 progress fraction, if available */
  progress?: number;
}

export interface ModelSnapshotDownloadProgress {
  message: string;
  progress?: number;
  bytesDone?: number;
  bytesTotal?: number;
}

export interface ModelSnapshotDownloadOptions {
  onProgress?: (progress: ModelSnapshotDownloadProgress) => void;
  pollMs?: number;
}

export function buildServerArgs(model: string): string[] {
  const runtime = modelRuntimeForName(model);
  if (runtime === "mlx-vlm") {
    const args = [
      "-m",
      "mlx_vlm.server",
      "--model",
      model,
      "--host",
      "127.0.0.1",
      "--port",
      String(MLX_PORT),
    ];
    const maxKvSize = process.env[MLX_VLM_MAX_KV_SIZE_ENV];
    if (maxKvSize) {
      args.push("--max-kv-size", maxKvSize);
    }
    const kvBits = process.env[MLX_VLM_KV_BITS_ENV];
    if (kvBits) {
      args.push("--kv-bits", kvBits);
    }
    const kvQuantScheme = process.env[MLX_VLM_KV_QUANT_SCHEME_ENV];
    if (kvQuantScheme) {
      args.push("--kv-quant-scheme", kvQuantScheme);
    }
    return args;
  }

  return [
    "-m",
    "mlx_lm",
    "server",
    "--model",
    model,
    "--port",
    String(MLX_PORT),
    // Gemma 4 chat template emits chain-of-thought into delta.reasoning before
    // any delta.content. Disabling thinking keeps the SSE stream filled with
    // user-visible content. The flag is a no-op on chat templates that don't
    // reference `enable_thinking` (e.g. Gemma 3), so it's safe to pass always.
    "--chat-template-args",
    '{"enable_thinking": false}',
  ];
}

export function buildServerEnv(): NodeJS.ProcessEnv {
  const modelCacheDir = modelsDir();
  return {
    ...process.env,
    [MLX_HF_HOME_ENV]: modelCacheDir,
    [MLX_TRANSFORMERS_CACHE_ENV]: modelCacheDir,
    [MLX_HF_HUB_DISABLE_TELEMETRY_ENV]: MLX_ENABLED_ENV_VALUE,
    [MLX_HF_HUB_DISABLE_XET_ENV]: MLX_ENABLED_ENV_VALUE,
    [MLX_HF_HUB_DOWNLOAD_TIMEOUT_ENV]: MLX_HF_HUB_DOWNLOAD_TIMEOUT_SECONDS,
  };
}

export function buildSnapshotDownloadArgs(model: string): string[] {
  return ["-c", MLX_SNAPSHOT_DOWNLOAD_SCRIPT, model, modelsDir()];
}

function buildSnapshotDownloadEnv(): NodeJS.ProcessEnv {
  return {
    ...buildServerEnv(),
    [MLX_PYTHON_UNBUFFERED_ENV]: MLX_ENABLED_ENV_VALUE,
  };
}

function modelSnapshotDownloadProgress(
  model: string,
  message: string,
  fallbackProgress?: number,
): ModelSnapshotDownloadProgress {
  const inspection = inspectModelCache(model);
  const bytesTotal = inspection.metadataTotalSizeBytes;
  const bytesDone =
    bytesTotal != null
      ? Math.min(inspection.modelWeightsBytes, bytesTotal)
      : inspection.modelWeightsBytes;
  return {
    message,
    ...(bytesTotal != null && bytesTotal > 0
      ? {
          bytesDone,
          bytesTotal,
          progress: Math.min(bytesDone / bytesTotal, 1),
        }
      : {
          ...(bytesDone > 0 ? { bytesDone } : {}),
          ...(fallbackProgress != null ? { progress: fallbackProgress } : {}),
        }),
  };
}

interface HuggingFaceFetchProgress {
  message: string;
  progress: number;
}

function parseHuggingFaceFetchProgress(
  line: string,
): HuggingFaceFetchProgress | null {
  const fetchMatch = line.match(
    /Fetching\s+(\d+)\s+files?:\s+(\d+)%.*?(\d+)\/(\d+)/,
  );
  if (!fetchMatch) return null;
  const pct = parseInt(fetchMatch[2], 10);
  const done = parseInt(fetchMatch[3], 10);
  const total = parseInt(fetchMatch[4], 10);
  return {
    message: `Downloading model files… ${done}/${total}`,
    progress: pct / 100,
  };
}

export async function downloadModelSnapshot(
  python: string,
  model: string,
  options: ModelSnapshotDownloadOptions = {},
): Promise<void> {
  const args = buildSnapshotDownloadArgs(model);
  const env = buildSnapshotDownloadEnv();
  const pollMs = options.pollMs ?? MLX_SNAPSHOT_DOWNLOAD_PROGRESS_POLL_MS;
  let stderrBuf = "";
  let fallbackProgress: number | undefined;
  let latestMessage = "Downloading model snapshot…";

  options.onProgress?.(
    modelSnapshotDownloadProgress(model, latestMessage, fallbackProgress),
  );

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(python, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
    const progressPoll = setInterval(() => {
      options.onProgress?.(
        modelSnapshotDownloadProgress(model, latestMessage, fallbackProgress),
      );
    }, pollMs);

    const handleOutput = (text: string): void => {
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        const parsed = parseHuggingFaceFetchProgress(line);
        if (parsed) {
          latestMessage = parsed.message;
          fallbackProgress = parsed.progress;
          options.onProgress?.(
            modelSnapshotDownloadProgress(
              model,
              latestMessage,
              fallbackProgress,
            ),
          );
        } else if (line.includes("snapshot_download_start")) {
          latestMessage = "Resolving model snapshot…";
        } else if (line.includes("snapshot_download_complete")) {
          latestMessage = "Model snapshot downloaded.";
        }
      }
    };

    proc.stdout?.on("data", (d) => {
      handleOutput(d.toString());
    });
    proc.stderr?.on("data", (d) => {
      const text = d.toString();
      stderrBuf += text;
      handleOutput(text);
    });
    proc.on("error", (error) => {
      clearInterval(progressPoll);
      reject(error);
    });
    proc.on("exit", (code) => {
      clearInterval(progressPoll);
      if (code !== 0) {
        reject(
          new Error(
            `Hugging Face snapshot_download failed for ${model} (exit ${code}): ${stderrBuf.slice(
              -MLX_ERROR_TEXT_TAIL_CHARS,
            )}`,
          ),
        );
        return;
      }
      const inspection = inspectModelCache(model);
      if (!isModelCacheReadyForInference(inspection)) {
        reject(
          new Error(
            `Hugging Face snapshot_download finished, but ${model} is not ready for inference. cacheStatus=${inspection.status}`,
          ),
        );
        return;
      }
      options.onProgress?.(
        modelSnapshotDownloadProgress(model, "Download complete.", 1),
      );
      resolve();
    });
  });
}

export async function startServer(
  python: string,
  model: string,
  onProgress?: (p: ServerProgress) => void,
): Promise<void> {
  if (serverProc && !serverProc.killed && currentModel === model) return;

  // Kill existing server if running with different model
  await stopServerForRestart();

  const env = buildServerEnv();

  // Track early exit so waitForHealth can bail out immediately
  let earlyExit: { code: number | null; stderr: string } | null = null;
  let stderrBuf = "";
  const args = buildServerArgs(model);
  const commandText = `${python} ${args.join(" ")}`;
  lastServerCommand = commandText;

  closeMlxLogFile();
  ensureMlxLogFileStream();
  appendMlxLogFile("stdout", `[startup] ${commandText}`);
  console.log(`[mlx] Starting server: ${commandText}`);

  serverProc = spawn(python, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  currentModel = model;

  serverProc.stdout?.on("data", (d) => {
    const text = d.toString();
    captureMlxOutput("stdout", text);
    console.log("[mlx]", text.trim());
  });
  serverProc.stderr?.on("data", (d) => {
    const text = d.toString();
    captureMlxOutput("stderr", text);
    stderrBuf += text;
    console.log("[mlx]", text.trim());

    // Parse HuggingFace download progress from stderr
    // Format: "Fetching 8 files:  50%|█████     | 4/8 [00:55<00:59, 14.98s/it]"
    if (onProgress) {
      const lines = text.split("\n");
      for (const line of lines) {
        const fetchProgress = parseHuggingFaceFetchProgress(line);
        if (fetchProgress) {
          onProgress({
            message: fetchProgress.message,
            progress: fetchProgress.progress,
          });
          continue;
        }

        // Match loading messages
        if (line.includes("Starting httpd") || line.includes("starting")) {
          onProgress({ message: "Starting server…", progress: 1.0 });
        }
      }
    }
  });
  serverProc.on("exit", (code) => {
    console.log("[mlx] server exited with code", code);
    earlyExit = { code, stderr: stderrBuf };
    appendMlxLogFile("stderr", `[exit] server exited with code ${code}`);
    if (code !== null) {
      appendMlxLogFile(
        "stderr",
        `[exit] full-stderr-tail=${stderrBuf.slice(-MLX_ERROR_TEXT_TAIL_CHARS)}`,
      );
    }
    serverProc = null;
    currentModel = null;
    closeMlxLogFile();
  });

  // Wait for the server to become healthy.
  // First run downloads model weights from HuggingFace, so allow up to 10 min.
  await waitForHealth(MLX_SERVER_START_TIMEOUT_MS, () => earlyExit);
}

export function stopServer(): void {
  if (serverProc && !serverProc.killed) {
    console.log("[mlx] Stopping server");
    serverProc.kill("SIGTERM");
    serverProc = null;
    currentModel = null;
  }
  closeMlxLogFile();
}

async function stopServerForRestart(): Promise<void> {
  if (!serverProc || serverProc.killed) {
    closeMlxLogFile();
    return;
  }

  const proc = serverProc;
  console.log("[mlx] Stopping server");

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (!proc.killed) {
        proc.kill("SIGKILL");
      }
      finish();
    }, MLX_SERVER_STOP_TIMEOUT_MS);

    proc.once("exit", finish);
    proc.kill("SIGTERM");
  });

  if (serverProc === proc) {
    serverProc = null;
    currentModel = null;
  }
  closeMlxLogFile();
}

/**
 * Poll the server's /v1/models endpoint until it responds.
 * If the server process exits early, throw immediately.
 */
async function waitForHealth(
  timeoutMs: number,
  checkEarlyExit: () => { code: number | null; stderr: string } | null,
): Promise<void> {
  const start = Date.now();
  let lastError: unknown = null;

  while (Date.now() - start < timeoutMs) {
    // Check if the server process crashed
    const exit = checkEarlyExit();
    if (exit) {
      throw new Error(
        `MLX server exited with code ${exit.code}. ${exit.stderr.slice(
          -MLX_ERROR_TEXT_TAIL_CHARS,
        )}. log=${mlxLogFilePath()}`,
      );
    }

    try {
      const res = await fetch(`${MLX_URL}/v1/models`);
      if (res.ok) {
        console.log("[mlx] Server is healthy");
        return;
      }
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, MLX_HEALTH_POLL_INTERVAL_MS));
  }
  throw new Error(
    `MLX server did not become healthy within ${Math.floor(timeoutMs / 1000)}s: ${String(
      lastError,
    )}. log=${mlxLogFilePath()}`,
  );
}

// ---------------------------------------------------------------------------
// Model management
// ---------------------------------------------------------------------------

export async function listLocalModels(): Promise<string[]> {
  try {
    const res = await fetch(`${MLX_URL}/v1/models`);
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    return (data.data ?? []).map((m) => m.id);
  } catch {
    return [];
  }
}

export async function hasModel(_name: string): Promise<boolean> {
  try {
    const models = await listLocalModels();
    return models.length > 0;
  } catch {
    return false;
  }
}

export function inspectModelCache(model: string): MLXModelCacheInspection {
  const modelCachePath = modelCacheFolder(model);
  if (!existsSync(modelCachePath)) {
    return {
      modelName: model,
      modelCachePath,
      status: "missing",
      exists: false,
      incompleteBlobPaths: [],
      snapshotFolders: [],
      snapshots: [],
      metadataTotalSizeBytes: null,
      modelWeightsBytes: 0,
      hasModelSafetensors: false,
    };
  }

  const incompleteBlobPaths = collectIncompleteBlobs(modelCachePath);
  const snapshotsBase = join(modelCachePath, "snapshots");
  const snapshots: MLXSnapshotInfo[] = [];
  const snapshotFolders: string[] = [];
  let metadataTotalSizeBytes: number | null = null;
  let hasModelSafetensors = false;

  if (existsSync(snapshotsBase)) {
    const snapshotEntries: Dirent[] = readdirSync(snapshotsBase, {
      withFileTypes: true,
    });
    for (const entry of snapshotEntries) {
      if (!entry.isDirectory()) continue;
      const snapshotPath = join(snapshotsBase, entry.name);
      const snapshotInfo = snapshotInspection(entry.name, snapshotPath);
      snapshotFolders.push(snapshotPath);
      snapshots.push(snapshotInfo);
      if (snapshotInfo.metadataTotalSize !== null) {
        metadataTotalSizeBytes =
          snapshotInfo.metadataTotalSize > (metadataTotalSizeBytes ?? 0)
            ? snapshotInfo.metadataTotalSize
            : metadataTotalSizeBytes;
      }
      if (snapshotInfo.hasModelSafetensors) {
        hasModelSafetensors = true;
      }
    }
  }

  const modelWeightsBytes = getDirectoryBytes(modelCachePath);
  let status: MLXModelCacheStatus = "complete";
  if (
    metadataTotalSizeBytes !== null &&
    modelWeightsBytes < metadataTotalSizeBytes
  ) {
    status = "missing-weights";
  } else if (!hasModelSafetensors) {
    status = "missing-weights";
  } else if (snapshotFolders.length === 0) {
    status = "missing-weights";
  } else if (incompleteBlobPaths.length > 0) {
    status = "incomplete";
  }

  if (incompleteBlobPaths.length > 0) {
    status = "incomplete";
  }

  return {
    modelName: model,
    modelCachePath,
    status,
    exists: true,
    incompleteBlobPaths,
    snapshotFolders,
    snapshots,
    metadataTotalSizeBytes,
    modelWeightsBytes,
    hasModelSafetensors,
  };
}

export async function inspectModelProvenance(
  model: string,
): Promise<ModelProvenance> {
  const inspection = inspectModelCache(model);
  const revision = readModelRevision(inspection.modelCachePath);
  const localCachedAt = latestModelSnapshotMtime(inspection);
  const upstreamLastModified = revision
    ? await fetchHuggingFaceLastModified(model, revision)
    : null;
  return {
    model,
    revision,
    upstreamLastModified,
    localCachedAt,
    weightsBytes: inspection.hasModelSafetensors
      ? inspection.modelWeightsBytes
      : null,
  };
}

function readModelRevision(modelCachePath: string): string | null {
  const refPath = join(modelCachePath, "refs", "main");
  if (!existsSync(refPath)) return null;
  const revision = readFileSync(refPath, "utf8").trim();
  return revision.length > 0 ? revision : null;
}

function latestModelSnapshotMtime(
  inspection: MLXModelCacheInspection,
): string | null {
  let latest = 0;
  for (const snapshot of inspection.snapshots) {
    if (!existsSync(snapshot.path)) continue;
    latest = Math.max(latest, statSync(snapshot.path).mtimeMs);
    const weightPath = join(snapshot.path, "model.safetensors");
    if (existsSync(weightPath)) {
      latest = Math.max(latest, statSync(weightPath).mtimeMs);
    }
  }
  return latest > 0 ? new Date(latest).toISOString() : null;
}

async function fetchHuggingFaceLastModified(
  model: string,
  revision: string,
): Promise<string | null> {
  const abort = new AbortController();
  const timeout = setTimeout(
    () => abort.abort("model provenance timeout"),
    MODEL_PROVENANCE_FETCH_TIMEOUT_MS,
  );
  try {
    const response = await fetch(
      `https://huggingface.co/api/models/${model}/revision/${revision}`,
      { signal: abort.signal },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as HuggingFaceModelInfo;
    return typeof data.lastModified === "string" ? data.lastModified : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function repairModelCache(model: string): void {
  stopServer();
  const modelCachePath = modelCacheFolder(model);
  if (!existsSync(modelCachePath)) {
    return;
  }
  rmSync(modelCachePath, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Chat streaming (OpenAI-compatible SSE)
// ---------------------------------------------------------------------------

export interface MLXChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  images?: string[];
}

export interface MLXChatOptions {
  model: string;
  messages: MLXChatMessage[];
  signal?: AbortSignal;
  temperature?: number;
  enableThinking?: boolean;
}

export interface MLXChatRequestMessage {
  role: MLXChatMessage["role"];
  content: string;
}

export interface MLXChatRequestBody {
  model: string;
  messages: MLXChatRequestMessage[];
  stream: boolean;
  temperature: number;
  max_tokens: number;
  enable_thinking: boolean;
  chat_template_kwargs: {
    enable_thinking: boolean;
  };
}

export function buildChatRequestBody(opts: MLXChatOptions): MLXChatRequestBody {
  const enableThinking = opts.enableThinking ?? false;
  return {
    model: opts.model,
    messages: opts.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    stream: true,
    temperature: opts.temperature ?? MLX_CHAT_TEMPERATURE,
    max_tokens: MLX_CHAT_MAX_TOKENS,
    enable_thinking: enableThinking,
    chat_template_kwargs: {
      enable_thinking: enableThinking,
    },
  };
}

export type MLXChatStreamChunk =
  | { content: string }
  | { reasoning: string }
  | { done: true };

export async function* chatStream(
  opts: MLXChatOptions,
): AsyncGenerator<MLXChatStreamChunk> {
  const start = Date.now();
  const endpoint = `${MLX_URL}/v1/chat/completions`;
  const abortController = new AbortController();
  let timeoutTriggered = false;

  const handleAbort = (): void => {
    abortController.abort("chat request aborted");
  };

  if (opts.signal) {
    if (opts.signal.aborted) {
      throw new Error("Chat request aborted before sending");
    }
    opts.signal.addEventListener("abort", handleAbort);
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  timeoutHandle = setTimeout(() => {
    timeoutTriggered = true;
    abortController.abort("first token timeout");
  }, MLX_FIRST_TOKEN_TIMEOUT_MS);

  try {
    const requestBody = buildChatRequestBody(opts);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: abortController.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      const elapsedMs = Date.now() - start;
      throw new Error(
        `MLX chat request failed: ${summarizeChatFailure({
          endpoint,
          model: opts.model,
          elapsedMs,
          status: res.status,
          statusText: res.statusText,
          responseText: text,
        })}`,
      );
    }

    let didReceiveFirstEvent = false;

    const stream = res.body as unknown as ReadableStream<Uint8Array>;
    for await (const event of readSSE(stream)) {
      if (event === "[DONE]") {
        if (!didReceiveFirstEvent) {
          didReceiveFirstEvent = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
        }
        yield { done: true };
        return;
      }
      try {
        const parsed = JSON.parse(event) as {
          choices?: Array<{
            delta?: { content?: string; reasoning?: string; role?: string };
            finish_reason?: string | null;
          }>;
        };
        const choice = parsed.choices?.[0];
        if (choice?.delta?.reasoning) {
          if (!didReceiveFirstEvent) {
            didReceiveFirstEvent = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);
          }
          yield { reasoning: choice.delta.reasoning };
        }
        if (choice?.delta?.content) {
          if (!didReceiveFirstEvent) {
            didReceiveFirstEvent = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);
          }
          yield { content: choice.delta.content };
        }
        if (
          choice?.finish_reason === "stop" ||
          choice?.finish_reason === "length"
        ) {
          if (!didReceiveFirstEvent) {
            didReceiveFirstEvent = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);
          }
          yield { done: true };
          return;
        }
      } catch {
        // Skip malformed events
      }
    }
    if (!didReceiveFirstEvent) {
      const elapsedMs = Date.now() - start;
      throw new Error(
        `MLX chat stream closed without any events in ${elapsedMs}ms`,
      );
    }
    yield { done: true };
  } catch (error) {
    const elapsedMs = Date.now() - start;
    if (timeoutTriggered) {
      throw new Error(
        `MLX first-token timeout (${MLX_FIRST_TOKEN_TIMEOUT_MS}ms): endpoint=${endpoint} model=${opts.model} elapsedMs=${elapsedMs}. logs=${formatLogTail()}`,
      );
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `MLX chat request aborted: endpoint=${endpoint} model=${opts.model} elapsedMs=${elapsedMs}. ${error.message}`,
      );
    }

    if (error instanceof Error) {
      const cause = error.message;
      throw new Error(
        `MLX chat stream failed: ${summarizeChatFailure({
          endpoint,
          model: opts.model,
          elapsedMs,
          cause,
        })}`,
      );
    }
    throw error;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (opts.signal) {
      opts.signal.removeEventListener("abort", handleAbort);
    }
  }
}

interface MLXCompletionChoice {
  finish_reason?: string | null;
  message?: {
    role?: string;
    content?: string | null;
  };
}

interface MLXCompletionResponse {
  choices?: MLXCompletionChoice[];
}

export async function warmupInference(
  model: string,
  signal?: AbortSignal,
  firstTokenTimeoutMs = MLX_FIRST_TOKEN_TIMEOUT_MS,
): Promise<void> {
  const maxTokens = MLX_WARMUP_MAX_TOKENS;
  const start = Date.now();
  const endpoint = `${MLX_URL}/v1/chat/completions`;
  const abortController = new AbortController();

  const stopTimerIfAny = (
    handle: ReturnType<typeof setTimeout> | undefined,
  ): void => {
    if (handle) clearTimeout(handle);
  };

  const cleanupSignal = (): void => {
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
  };

  const onAbort = (): void => abortController.abort("warmup aborted");
  if (signal) {
    if (signal.aborted) throw new Error("Warmup request aborted");
    signal.addEventListener("abort", onAbort);
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  timeoutHandle = setTimeout(
    () => abortController.abort("warmup timeout"),
    firstTokenTimeoutMs,
  );
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Hi" }],
        stream: false,
        temperature: 0,
        max_tokens: maxTokens,
      }),
      signal: abortController.signal,
    });

    if (!res.ok || !res.body) {
      const responseText = await res.text().catch(() => "");
      const elapsedMs = Date.now() - start;
      throw new Error(
        `MLX warmup failed: ${summarizeChatFailure({
          endpoint,
          model,
          elapsedMs,
          status: res.status,
          statusText: res.statusText,
          responseText,
        })}`,
      );
    }

    const result = (await res.json()) as MLXCompletionResponse;
    const choices = result.choices ?? [];
    const hasCompletion = choices.some((choice) => {
      const content = choice.message?.content;
      return typeof content === "string" && content.trim().length > 0;
    });

    if (!hasCompletion) {
      throw new Error(
        `MLX warmup returned empty completion for model=${model}. response=${JSON.stringify(result)}`,
      );
    }

    stopTimerIfAny(timeoutHandle);
    return;
  } catch (error) {
    const elapsedMs = Date.now() - start;
    const inspection = inspectModelCache(model);
    const cacheSummary = JSON.stringify(
      {
        model: inspection.modelName,
        status: inspection.status,
        snapshots: inspection.snapshotFolders,
        metadataTotalSizeBytes: inspection.metadataTotalSizeBytes,
        modelWeightsBytes: inspection.modelWeightsBytes,
        hasModelSafetensors: inspection.hasModelSafetensors,
        incompleteBlobCount: inspection.incompleteBlobPaths.length,
      },
      null,
      2,
    );

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `MLX warmup aborted after ${elapsedMs}ms: endpoint=${endpoint} model=${model} reason=${error.message}`,
      );
    }

    if (
      error instanceof Error &&
      error.message.startsWith("MLX warmup failed:")
    ) {
      throw new Error(
        `${error.message} | cache=${cacheSummary} | logs=${formatLogTail()}`,
      );
    }

    if (error instanceof Error) {
      throw new Error(
        `MLX warmup failed after ${elapsedMs}ms: endpoint=${endpoint} model=${model} cause=${error.message} | cache=${cacheSummary} | logs=${formatLogTail()}`,
      );
    }
    throw new Error(
      `MLX warmup failed after ${elapsedMs}ms: endpoint=${endpoint} model=${model} | cache=${cacheSummary} | logs=${formatLogTail()}`,
    );
  } finally {
    stopTimerIfAny(timeoutHandle);
    cleanupSignal();
  }
}

export { MLX_URL };
