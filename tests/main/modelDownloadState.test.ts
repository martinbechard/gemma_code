import { describe, expect, it } from "vitest";
import {
  deriveLocalModelDownloadStatus,
  ModelDownloadManager,
  type PersistedModelDownloadRecord,
} from "../../src/main/modelDownloadState";
import type { MLXModelCacheInspection } from "../../src/main/mlx";

const TEST_MODEL = "mlx-community/gemma-3-text-12b-it-4bit";
const UPDATED_AT = 1_788_000_000_000;

function inspection(
  overrides: Partial<MLXModelCacheInspection>,
): MLXModelCacheInspection {
  return {
    modelName: TEST_MODEL,
    modelCachePath: "/cache/model",
    status: "missing",
    exists: false,
    incompleteBlobPaths: [],
    snapshotFolders: [],
    snapshots: [],
    metadataTotalSizeBytes: null,
    modelWeightsBytes: 0,
    hasModelSafetensors: false,
    ...overrides,
  };
}

function record(
  overrides: Partial<PersistedModelDownloadRecord>,
): PersistedModelDownloadRecord {
  return {
    model: TEST_MODEL,
    state: "queued",
    message: "Queued for download.",
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

describe("deriveLocalModelDownloadStatus", () => {
  it("marks a never-requested missing model as downloadable", () => {
    expect(
      deriveLocalModelDownloadStatus({
        model: TEST_MODEL,
        inspection: inspection({}),
        record: undefined,
        isRunning: false,
        now: UPDATED_AT,
      }),
    ).toMatchObject({
      model: TEST_MODEL,
      state: "missing",
      message: "Model has not been downloaded.",
    });
  });

  it("marks complete cache as downloaded even when a stale record exists", () => {
    expect(
      deriveLocalModelDownloadStatus({
        model: TEST_MODEL,
        inspection: inspection({
          status: "complete",
          exists: true,
          snapshotFolders: ["/cache/model/snapshots/1"],
          metadataTotalSizeBytes: 100,
          modelWeightsBytes: 100,
          hasModelSafetensors: true,
        }),
        record: record({ state: "failed", error: "network failed" }),
        isRunning: false,
        now: UPDATED_AT,
      }),
    ).toMatchObject({
      state: "downloaded",
      message: "Model is downloaded.",
      progress: 1,
      bytesDone: 100,
      bytesTotal: 100,
    });
  });

  it("marks a requested but incomplete model as resumable after restart", () => {
    expect(
      deriveLocalModelDownloadStatus({
        model: TEST_MODEL,
        inspection: inspection({}),
        record: record({ state: "downloading" }),
        isRunning: false,
        now: UPDATED_AT,
      }),
    ).toMatchObject({
      state: "incomplete",
      message: "Download is incomplete.",
    });
  });

  it("preserves failed status while retaining resume details", () => {
    expect(
      deriveLocalModelDownloadStatus({
        model: TEST_MODEL,
        inspection: inspection({
          exists: true,
          status: "incomplete",
          incompleteBlobPaths: ["/cache/model/blobs/a.incomplete"],
          modelWeightsBytes: 25,
          metadataTotalSizeBytes: 100,
        }),
        record: record({
          state: "failed",
          message: "Download failed.",
          error: "fetch failed",
        }),
        isRunning: false,
        now: UPDATED_AT,
      }),
    ).toMatchObject({
      state: "failed",
      message: "Download failed.",
      error: "fetch failed",
      progress: 0.25,
      bytesDone: 25,
      bytesTotal: 100,
    });
  });

  it("marks active downloads as running", () => {
    expect(
      deriveLocalModelDownloadStatus({
        model: TEST_MODEL,
        inspection: inspection({}),
        record: record({ state: "queued" }),
        isRunning: true,
        now: UPDATED_AT,
      }),
    ).toMatchObject({
      state: "downloading",
      message: "Downloading model.",
    });
  });
});

describe("ModelDownloadManager", () => {
  it("persists download intent before running snapshot download", async () => {
    const savedRecords: PersistedModelDownloadRecord[][] = [];
    const emittedStates: string[] = [];
    let downloaded = false;
    const ensurePython = async (): Promise<string> => "/venv/bin/python";
    const downloadSnapshot = async (): Promise<void> => {
      downloaded = true;
    };
    const manager = new ModelDownloadManager({
      now: () => UPDATED_AT,
      loadRecords: () => [],
      saveRecords: (records) => savedRecords.push(records),
      emitStatus: (status) => emittedStates.push(status.state),
      ensurePython,
      downloadSnapshot,
      inspectCache: () =>
        inspection(
          downloaded
            ? {
                status: "complete",
                exists: true,
                snapshotFolders: ["/cache/model/snapshots/1"],
                metadataTotalSizeBytes: 100,
                modelWeightsBytes: 100,
                hasModelSafetensors: true,
              }
            : {},
        ),
    });

    const initial = manager.start(TEST_MODEL);
    await manager.whenIdle(TEST_MODEL);

    expect(initial.state).toBe("downloading");
    expect(savedRecords[0][0]).toMatchObject({
      model: TEST_MODEL,
      state: "queued",
      message: "Queued for download.",
    });
    expect(savedRecords.at(-1)?.[0]).toMatchObject({
      model: TEST_MODEL,
      state: "downloaded",
      message: "Model is downloaded.",
    });
    expect(emittedStates).toContain("downloading");
  });
});
