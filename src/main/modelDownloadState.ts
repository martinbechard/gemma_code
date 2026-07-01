import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
  type LocalModelDownloadState,
  type LocalModelDownloadStatus,
} from "../shared/types";
import {
  isModelCacheReadyForInference,
  type ModelSnapshotDownloadOptions,
  type ModelSnapshotDownloadProgress,
  type MLXModelCacheInspection,
} from "./mlx";
import { userDataDir } from "./runtimePaths";

const MODEL_DOWNLOAD_STATE_FILE = "model-downloads.json";
const MODEL_DOWNLOAD_STATE_VERSION = 1;
const MODEL_DOWNLOAD_COMPLETE_PROGRESS = 1;
const NO_BYTES = 0;

export interface PersistedModelDownloadRecord {
  model: string;
  state: LocalModelDownloadState;
  message: string;
  updatedAt: number;
  progress?: number;
  bytesDone?: number;
  bytesTotal?: number;
  error?: string;
}

interface PersistedModelDownloadFile {
  version: number;
  records: PersistedModelDownloadRecord[];
}

export interface DeriveLocalModelDownloadStatusOptions {
  model: string;
  inspection: MLXModelCacheInspection;
  record: PersistedModelDownloadRecord | undefined;
  isRunning: boolean;
  now: number;
}

export interface ModelDownloadManagerDependencies {
  now: () => number;
  loadRecords: () => PersistedModelDownloadRecord[];
  saveRecords: (records: PersistedModelDownloadRecord[]) => void;
  emitStatus: (status: LocalModelDownloadStatus) => void;
  ensurePython: () => Promise<string>;
  downloadSnapshot: (
    python: string,
    model: string,
    options: ModelSnapshotDownloadOptions,
  ) => Promise<void>;
  inspectCache: (model: string) => MLXModelCacheInspection;
}

export class ModelDownloadManager {
  private readonly records = new Map<string, PersistedModelDownloadRecord>();
  private readonly running = new Map<string, Promise<void>>();

  constructor(private readonly deps: ModelDownloadManagerDependencies) {
    for (const record of deps.loadRecords()) {
      this.records.set(record.model, record);
    }
  }

  list(models: string[]): LocalModelDownloadStatus[] {
    return models.map((model) => this.status(model));
  }

  status(model: string): LocalModelDownloadStatus {
    return deriveLocalModelDownloadStatus({
      model,
      inspection: this.deps.inspectCache(model),
      record: this.records.get(model),
      isRunning: this.running.has(model),
      now: this.deps.now(),
    });
  }

  start(model: string): LocalModelDownloadStatus {
    const current = this.status(model);
    if (current.state === "downloaded" || current.state === "downloading") {
      return current;
    }

    const task = Promise.resolve().then(() => this.run(model));
    this.running.set(model, task);
    this.setRecord({
      model,
      state: "queued",
      message: "Queued for download.",
      updatedAt: this.deps.now(),
    });
    return this.status(model);
  }

  async whenIdle(model: string): Promise<void> {
    await (this.running.get(model) ?? Promise.resolve());
  }

  private async run(model: string): Promise<void> {
    this.setRecord({
      model,
      state: "downloading",
      message: "Downloading model.",
      updatedAt: this.deps.now(),
    });

    try {
      const python = await this.deps.ensurePython();
      await this.deps.downloadSnapshot(python, model, {
        onProgress: (progress) => this.updateProgress(model, progress),
      });
      this.running.delete(model);
      this.setRecordFromStatus(this.status(model));
    } catch (error) {
      this.running.delete(model);
      this.setRecord({
        model,
        state: "failed",
        message: "Download failed.",
        updatedAt: this.deps.now(),
        error: (error as Error).message,
      });
    }
  }

  private updateProgress(
    model: string,
    progress: ModelSnapshotDownloadProgress,
  ): void {
    this.setRecord({
      model,
      state: "downloading",
      message: progress.message,
      updatedAt: this.deps.now(),
      ...(progress.progress != null ? { progress: progress.progress } : {}),
      ...(progress.bytesDone != null ? { bytesDone: progress.bytesDone } : {}),
      ...(progress.bytesTotal != null
        ? { bytesTotal: progress.bytesTotal }
        : {}),
    });
  }

  private setRecordFromStatus(status: LocalModelDownloadStatus): void {
    this.setRecord({
      model: status.model,
      state: status.state,
      message: status.message,
      updatedAt: status.updatedAt,
      ...(status.progress != null ? { progress: status.progress } : {}),
      ...(status.bytesDone != null ? { bytesDone: status.bytesDone } : {}),
      ...(status.bytesTotal != null ? { bytesTotal: status.bytesTotal } : {}),
      ...(status.error ? { error: status.error } : {}),
    });
  }

  private setRecord(record: PersistedModelDownloadRecord): void {
    this.records.set(record.model, record);
    this.deps.saveRecords(Array.from(this.records.values()));
    this.deps.emitStatus(this.status(record.model));
  }
}

export function modelDownloadStatePath(): string {
  return join(userDataDir(), MODEL_DOWNLOAD_STATE_FILE);
}

export function readPersistedModelDownloadRecords(
  path = modelDownloadStatePath(),
): PersistedModelDownloadRecord[] {
  try {
    return parsePersistedModelDownloadFile(
      JSON.parse(readFileSync(path, "utf8")),
    );
  } catch {
    return [];
  }
}

export function writePersistedModelDownloadRecords(
  records: PersistedModelDownloadRecord[],
  path = modelDownloadStatePath(),
): void {
  mkdirSync(dirname(path), { recursive: true });
  const file: PersistedModelDownloadFile = {
    version: MODEL_DOWNLOAD_STATE_VERSION,
    records,
  };
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

export function deriveLocalModelDownloadStatus({
  model,
  inspection,
  record,
  isRunning,
  now,
}: DeriveLocalModelDownloadStatusOptions): LocalModelDownloadStatus {
  const progress = progressFromInspection(inspection);
  if (isModelCacheReadyForInference(inspection)) {
    return {
      model,
      state: "downloaded",
      message: "Model is downloaded.",
      updatedAt: record?.updatedAt ?? now,
      ...progress,
      progress: MODEL_DOWNLOAD_COMPLETE_PROGRESS,
    };
  }

  if (isRunning) {
    return {
      model,
      state: "downloading",
      message: "Downloading model.",
      updatedAt: record?.updatedAt ?? now,
      ...progress,
      ...(record?.progress != null && progress.progress == null
        ? { progress: record.progress }
        : {}),
    };
  }

  if (record?.state === "failed") {
    return {
      model,
      state: "failed",
      message: record.message,
      updatedAt: record.updatedAt,
      ...progress,
      ...(record.error ? { error: record.error } : {}),
    };
  }

  if (record) {
    return {
      model,
      state: "incomplete",
      message: "Download is incomplete.",
      updatedAt: record.updatedAt,
      ...progress,
    };
  }

  if (
    inspection.status === "incomplete" ||
    inspection.status === "missing-weights"
  ) {
    return {
      model,
      state: "incomplete",
      message: "Download is incomplete.",
      updatedAt: now,
      ...progress,
    };
  }

  return {
    model,
    state: "missing",
    message: "Model has not been downloaded.",
    updatedAt: now,
    ...progress,
  };
}

function progressFromInspection(
  inspection: MLXModelCacheInspection,
): Pick<LocalModelDownloadStatus, "bytesDone" | "bytesTotal" | "progress"> {
  const bytesTotal = inspection.metadataTotalSizeBytes;
  if (bytesTotal == null || bytesTotal <= NO_BYTES) {
    return inspection.modelWeightsBytes > NO_BYTES
      ? { bytesDone: inspection.modelWeightsBytes }
      : {};
  }
  const bytesDone = Math.min(inspection.modelWeightsBytes, bytesTotal);
  return {
    bytesDone,
    bytesTotal,
    progress: Math.min(bytesDone / bytesTotal, MODEL_DOWNLOAD_COMPLETE_PROGRESS),
  };
}

function parsePersistedModelDownloadFile(
  value: unknown,
): PersistedModelDownloadRecord[] {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return [];
  }
  const record = value as Record<string, unknown>;
  if (record.version !== MODEL_DOWNLOAD_STATE_VERSION) return [];
  if (!Array.isArray(record.records)) return [];
  return record.records.filter(isPersistedModelDownloadRecord);
}

function isPersistedModelDownloadRecord(
  value: unknown,
): value is PersistedModelDownloadRecord {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.model === "string" &&
    isLocalModelDownloadState(record.state) &&
    typeof record.message === "string" &&
    typeof record.updatedAt === "number" &&
    (record.progress == null || typeof record.progress === "number") &&
    (record.bytesDone == null || typeof record.bytesDone === "number") &&
    (record.bytesTotal == null || typeof record.bytesTotal === "number") &&
    (record.error == null || typeof record.error === "string")
  );
}

function isLocalModelDownloadState(
  value: unknown,
): value is LocalModelDownloadState {
  return (
    value === "missing" ||
    value === "queued" ||
    value === "downloading" ||
    value === "incomplete" ||
    value === "downloaded" ||
    value === "failed"
  );
}
