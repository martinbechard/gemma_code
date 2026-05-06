import {
  locateMLX,
  installMLX,
  startServer,
  stopServer,
  inspectModelCache,
  isModelCacheReadyForInference,
  warmupInference,
  MLX_SERVER_PORT,
} from "../main/mlx";

function log(line: string): void {
  process.stdout.write(`[cli] ${line}\n`);
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

export async function runStatus(model: string): Promise<void> {
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
