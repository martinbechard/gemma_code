import {
  locateMLX,
  installMLX,
  startServer,
  stopServer,
  inspectModelCache,
  isModelCacheReadyForInference,
  warmupInference,
  linkGlobalCacheModel,
  MLX_SERVER_PORT,
  downloadModelSnapshot,
} from "../main/mlx";
import {
  ModelDownloadManager,
  readPersistedModelDownloadRecords,
  writePersistedModelDownloadRecords,
} from "../main/modelDownloadState";
import {
  endpointForModel,
  isLocalModel,
  modelInfoForName,
  validateRemoteModelReady,
} from "../main/modelConfig";
import type { LocalModelDownloadStatus } from "../shared/types";

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const BYTES_PER_KIB = 1024;
const BYTES_PER_MIB = BYTES_PER_KIB * BYTES_PER_KIB;
const BYTES_PER_GIB = BYTES_PER_MIB * BYTES_PER_KIB;
const PERCENT_SCALE = 100;
const PROGRESS_COMPLETE = 1;
const NO_BYTES = 0;

export interface DownloadProgressLineOptions {
  label: string;
  bytesDone?: number;
  bytesTotal?: number;
  progress?: number;
  startedBytesDone: number;
  startedAtMs: number;
  nowMs: number;
}

function log(line: string): void {
  process.stdout.write(`[cli] ${line}\n`);
}

function formatBytes(bytes: number): string {
  if (bytes >= BYTES_PER_GIB) {
    return `${(bytes / BYTES_PER_GIB).toFixed(1)} GB`;
  }
  if (bytes >= BYTES_PER_MIB) {
    return `${(bytes / BYTES_PER_MIB).toFixed(1)} MB`;
  }
  if (bytes >= BYTES_PER_KIB) {
    return `${(bytes / BYTES_PER_KIB).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function formatDuration(seconds: number): string {
  const wholeSeconds = Math.max(NO_BYTES, Math.round(seconds));
  const minutes = Math.floor(wholeSeconds / SECONDS_PER_MINUTE);
  const remainingSeconds = wholeSeconds % SECONDS_PER_MINUTE;
  if (minutes <= NO_BYTES) return `${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

export function formatDownloadProgressLine({
  label,
  bytesDone,
  bytesTotal,
  progress,
  startedBytesDone,
  startedAtMs,
  nowMs,
}: DownloadProgressLineOptions): string {
  const elapsedSeconds = Math.max(
    (nowMs - startedAtMs) / MS_PER_SECOND,
    NO_BYTES,
  );
  const currentBytes = bytesDone ?? NO_BYTES;
  const transferredBytes = Math.max(currentBytes - startedBytesDone, NO_BYTES);
  const bytesPerSecond =
    elapsedSeconds > NO_BYTES ? transferredBytes / elapsedSeconds : NO_BYTES;
  const percent =
    bytesTotal != null && bytesTotal > NO_BYTES && bytesDone != null
      ? Math.min(bytesDone / bytesTotal, PROGRESS_COMPLETE)
      : progress;
  const percentText =
    percent != null
      ? `${Math.round(percent * PERCENT_SCALE)}%`
      : "progress unknown";
  const byteText =
    bytesTotal != null && bytesDone != null
      ? ` (${formatBytes(bytesDone)} / ${formatBytes(bytesTotal)})`
      : "";
  const throughputText =
    bytesPerSecond > NO_BYTES
      ? `, ${formatBytes(bytesPerSecond)}/s`
      : ", throughput pending";
  const remainingBytes =
    bytesTotal != null && bytesDone != null
      ? Math.max(bytesTotal - bytesDone, NO_BYTES)
      : NO_BYTES;
  const etaText =
    bytesPerSecond > NO_BYTES && remainingBytes > NO_BYTES
      ? `, ETA ${formatDuration(remainingBytes / bytesPerSecond)}`
      : "";

  return `${label}: ${percentText}${byteText}${throughputText}${etaText}`;
}

// Returns true if an MLX server is already responding on the canonical port
// (e.g., the Electron app is running). The CLI then reuses that server rather
// than trying to spawn a duplicate that will fail with EADDRINUSE.
async function isServerRunning(model: string): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${MLX_SERVER_PORT}/v1/models`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { data?: Array<{ id: string }> };
    const ids = (json.data ?? []).map((m) => m.id);
    if (ids.length === 0) return true;
    return ids.some((id) => id === model || model.endsWith(id));
  } catch {
    return false;
  }
}

export async function runSetup(model: string): Promise<void> {
  if (!isLocalModel(model)) {
    validateRemoteModelReady(model);
    const endpoint = endpointForModel(model);
    log(
      `Remote model ready: ${modelInfoForName(model)?.label ?? model} via ${endpoint?.apiKeyEnv ?? "configured endpoint"}`,
    );
    return;
  }

  let mlx = locateMLX();
  if (!mlx || !mlx.installed) {
    log("Installing mlx-lm into the app venv (one-time)...");
    const py = await installMLX((p) =>
      log(`[install:${p.stage}] ${p.message}`),
    );
    mlx = { python: py, installed: true };
  } else {
    log(`MLX ready: ${mlx.python}`);
  }

  log(`Starting MLX server with model ${model}...`);
  await startServer(mlx.python, model, (p) => {
    const pct = p.progress != null ? ` (${Math.round(p.progress * 100)}%)` : "";
    log(`${p.message}${pct}`);
  });

  log("Warming up inference...");
  await warmupInference(model);
  log("Ready.");
}

export async function runDownloadModel(model: string): Promise<void> {
  if (!isLocalModel(model)) {
    throw new Error("download-model only supports local MLX models");
  }

  const label = modelInfoForName(model)?.label ?? model;
  let mlx = locateMLX();
  if (!mlx || !mlx.installed) {
    log("Installing MLX runtime into the app venv (one-time)...");
    const py = await installMLX((p) =>
      log(`[install:${p.stage}] ${p.message}`),
    );
    mlx = { python: py, installed: true };
  } else {
    log(`MLX ready: ${mlx.python}`);
  }

  if (linkGlobalCacheModel(model)) {
    log(`Reused global Hugging Face cache for ${label}.`);
  }

  const startingInspection = inspectModelCache(model);
  const startedBytesDone = startingInspection.modelWeightsBytes;
  const startedAtMs = Date.now();
  let fallbackProgress: number | undefined;

  const progressLine = (status?: LocalModelDownloadStatus): string => {
    const inspection = inspectModelCache(model);
    return formatDownloadProgressLine({
      label,
      bytesDone: status?.bytesDone ?? inspection.modelWeightsBytes,
      bytesTotal:
        status?.bytesTotal ?? inspection.metadataTotalSizeBytes ?? undefined,
      progress: status?.progress ?? fallbackProgress,
      startedBytesDone,
      startedAtMs,
      nowMs: Date.now(),
    });
  };

  if (isModelCacheReadyForInference(startingInspection)) {
    log(`Already downloaded. ${progressLine()}`);
    return;
  }

  const manager = new ModelDownloadManager({
    now: Date.now,
    loadRecords: readPersistedModelDownloadRecords,
    saveRecords: writePersistedModelDownloadRecords,
    emitStatus: (status) => {
      fallbackProgress = status.progress;
      log(`${status.message} ${progressLine(status)}`);
    },
    ensurePython: async () => mlx.python,
    downloadSnapshot: downloadModelSnapshot,
    inspectCache: inspectModelCache,
  });

  log(`Downloading ${label} with Hugging Face snapshot_download...`);
  manager.start(model);
  await manager.whenIdle(model);

  const finalStatus = manager.status(model);
  if (finalStatus.state === "failed") {
    throw new Error(finalStatus.error ?? finalStatus.message);
  }

  const finalInspection = inspectModelCache(model);
  if (isModelCacheReadyForInference(finalInspection)) {
    log(`Download complete. ${progressLine()}`);
    return;
  }

  throw new Error(`${label} did not finish downloading.`);
}

export async function runStatus(model: string): Promise<void> {
  if (!isLocalModel(model)) {
    try {
      validateRemoteModelReady(model);
      const endpoint = endpointForModel(model);
      log(`Remote model: ${modelInfoForName(model)?.label ?? model}`);
      log(`Endpoint kind: ${endpoint?.kind ?? "unknown"}`);
      log(`Credential: ${endpoint?.apiKeyEnv ?? "unknown"} is set`);
    } catch (error) {
      log(`Remote model: ${modelInfoForName(model)?.label ?? model}`);
      log((error as Error).message);
      process.exitCode = 1;
    }
    return;
  }

  const mlx = locateMLX();
  if (!mlx || !mlx.installed) {
    log("MLX: NOT INSTALLED");
    process.exitCode = 1;
    return;
  }
  log(`MLX: installed at ${mlx.python}`);
  const cache = inspectModelCache(model);
  log(`Model cache status: ${cache.status}`);
  log(`Model cache path: ${cache.modelCachePath}`);
  log(`Snapshots: ${cache.snapshotFolders.length}`);
  log(`Has model.safetensors: ${cache.hasModelSafetensors}`);
  log(
    `Weights bytes: ${cache.modelWeightsBytes} / ${cache.metadataTotalSizeBytes ?? "unknown"}`,
  );
  log(`Ready for inference: ${isModelCacheReadyForInference(cache)}`);
}

export async function ensureMlxRunning(model: string): Promise<boolean> {
  if (await isServerRunning(model)) {
    log(`Reusing MLX server already running on port ${MLX_SERVER_PORT}`);
    return false;
  }
  let mlx = locateMLX();
  if (!mlx || !mlx.installed) {
    log("Installing mlx-lm into the app venv (one-time)...");
    const py = await installMLX((p) =>
      log(`[install:${p.stage}] ${p.message}`),
    );
    mlx = { python: py, installed: true };
  }
  await startServer(mlx.python, model, (p) => {
    const pct = p.progress != null ? ` (${Math.round(p.progress * 100)}%)` : "";
    log(`${p.message}${pct}`);
  });
  await warmupInference(model);
  return true;
}

export function stopMlxServer(): void {
  stopServer();
}
