import { afterEach, describe, expect, it, vi } from "vitest";

const TEST_MODEL = "mlx-community/gemma-3-text-12b-it-4bit";
const TEST_LABEL = "Gemma 3 Text 12B";
afterEach(() => {
  vi.doUnmock("../../src/main/mlx");
  vi.doUnmock("../../src/main/modelConfig");
  vi.doUnmock("../../src/main/modelDownloadState");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("runDownloadModel", () => {
  it("downloads the Hugging Face snapshot directly without starting MLX", async () => {
    const savedStates: string[] = [];
    const writePersistedModelDownloadRecords = vi.fn(
      (
        records: Array<{
          model: string;
          state: string;
          message: string;
        }>,
      ) => {
        const current = records.find((record) => record.model === TEST_MODEL);
        if (current) savedStates.push(current.state);
      },
    );
    const downloadModelSnapshot = vi.fn(
      async (
        _python: string,
        _model: string,
        options: {
          onProgress?: (progress: {
            message: string;
            progress?: number;
            bytesDone?: number;
            bytesTotal?: number;
          }) => void;
        },
      ) => {
        options.onProgress?.({
          message: "Downloading model files… 2/11",
          progress: 0.5,
          bytesDone: 50,
          bytesTotal: 100,
        });
      },
    );
    const startServer = vi.fn(async () => undefined);
    const warmupInference = vi.fn(async () => undefined);
    const stopServer = vi.fn();
    const inspectModelCache = vi.fn(() => {
      const downloaded = downloadModelSnapshot.mock.calls.length > 0;
      return {
        modelName: TEST_MODEL,
        modelCachePath: "/cache/model",
        status: downloaded ? "complete" : "missing",
        exists: downloaded,
        incompleteBlobPaths: [],
        snapshotFolders: downloaded ? ["/cache/model/snapshots/1"] : [],
        snapshots: [],
        metadataTotalSizeBytes: 100,
        modelWeightsBytes: downloaded ? 100 : 0,
        hasModelSafetensors: downloaded,
      };
    });

    vi.doMock("../../src/main/mlx", () => ({
      MLX_SERVER_PORT: 11435,
      downloadModelSnapshot,
      inspectModelCache,
      installMLX: vi.fn(),
      isModelCacheReadyForInference: (inspection: {
        status: string;
      }) => inspection.status === "complete",
      linkGlobalCacheModel: vi.fn(() => false),
      locateMLX: vi.fn(() => ({ python: "/venv/bin/python", installed: true })),
      startServer,
      stopServer,
      warmupInference,
    }));
    vi.doMock("../../src/main/modelConfig", () => ({
      endpointForModel: vi.fn(),
      isLocalModel: vi.fn(() => true),
      modelInfoForName: vi.fn(() => ({ label: TEST_LABEL })),
      validateRemoteModelReady: vi.fn(),
    }));
    vi.doMock("../../src/main/modelDownloadState", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../../src/main/modelDownloadState")>();
      return {
        ...actual,
        readPersistedModelDownloadRecords: vi.fn(() => []),
        writePersistedModelDownloadRecords,
      };
    });

    const { runDownloadModel } = await import("../../src/cli/setup");

    await expect(runDownloadModel(TEST_MODEL)).resolves.toBeUndefined();
    expect(downloadModelSnapshot).toHaveBeenCalledWith(
      "/venv/bin/python",
      TEST_MODEL,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(startServer).not.toHaveBeenCalled();
    expect(warmupInference).not.toHaveBeenCalled();
    expect(stopServer).not.toHaveBeenCalled();
    expect(savedStates).toContain("queued");
    expect(savedStates).toContain("downloading");
    expect(savedStates).toContain("downloaded");
  });
});
