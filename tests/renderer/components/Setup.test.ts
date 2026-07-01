import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Setup, {
  copySetupErrorToClipboard,
  setupErrorClipboardText,
} from "../../../src/renderer/src/components/Setup";
import type {
  LocalModelDownloadStatus,
  ModelInfo,
  SetupStatus,
} from "../../../src/shared/types";

const TEST_MODELS: ModelInfo[] = [
  {
    name: "mlx-community/gemma-4-e4b-it-4bit",
    label: "Gemma 4 E4B",
    size: "5.2 GB",
    sizeBytes: 5_216_992_212,
    description: "Larger local model.",
    runtime: "mlx-lm",
  },
];

const WELCOME_STATUS: SetupStatus = {
  stage: "checking",
  message: "Welcome",
};

const ERROR_STATUS: SetupStatus = {
  stage: "error",
  message: "Warmup failed",
  error: "MLX warmup failed after 60000ms",
  repair: {
    model: "mlx-community/gemma-4-E4B-it-qat-4bit",
    reason: "missing model weight shards",
  },
  command:
    "/Users/example/mlx/venv/bin/python3 -m mlx_lm server --model mlx-community/gemma-4-E4B-it-qat-4bit",
  logFile: "/Users/example/Library/Application Support/gemma-code/mlx/logs/mlx-server.log",
};

const DOWNLOAD_STATUSES: LocalModelDownloadStatus[] = [
  {
    model: TEST_MODELS[0].name,
    state: "missing",
    message: "Model has not been downloaded.",
    updatedAt: 1,
  },
  {
    model: "mlx-community/incomplete-model",
    state: "incomplete",
    message: "Download is incomplete.",
    updatedAt: 1,
    progress: 0.5,
    bytesDone: 50,
    bytesTotal: 100,
  },
];

describe("Setup error display", () => {
  it("formats the full setup error for copying", () => {
    expect(setupErrorClipboardText(ERROR_STATUS)).toBe(
      [
        "Error: MLX warmup failed after 60000ms",
        "Cause: missing model weight shards",
        "Command: /Users/example/mlx/venv/bin/python3 -m mlx_lm server --model mlx-community/gemma-4-E4B-it-qat-4bit",
        "Log file: /Users/example/Library/Application Support/gemma-code/mlx/logs/mlx-server.log",
      ].join("\n"),
    );
  });

  it("renders setup errors as selectable text with a copy action", () => {
    const html = renderToStaticMarkup(
      createElement(Setup, {
        models: TEST_MODELS,
        status: ERROR_STATUS,
        model: ERROR_STATUS.repair!.model,
        onModelChange: () => undefined,
        onStart: () => undefined,
        onRepairModel: () => undefined,
      }),
    );

    expect(html).toContain("Copy error");
    expect(html).toContain("<pre");
    expect(html).toContain("selectable");
    expect(html).toContain("MLX warmup failed after 60000ms");
    expect(html).toContain("missing model weight shards");
    expect(html).toContain("mlx-server.log");
  });

  it("copies setup errors through the preload clipboard bridge", async () => {
    const copiedText: string[] = [];
    const api = {
      copyTextToClipboard: async (text: string): Promise<void> => {
        copiedText.push(text);
      },
    };

    await copySetupErrorToClipboard(ERROR_STATUS, api);

    expect(copiedText).toEqual([setupErrorClipboardText(ERROR_STATUS)]);
  });
});

describe("Setup welcome model list", () => {
  it("keeps the model choices in a bounded scroll area", () => {
    const models = Array.from({ length: 9 }, (_, index): ModelInfo => ({
      ...TEST_MODELS[0],
      name: `test-model-${index}`,
      label: `Test Model ${index}`,
    }));

    const html = renderToStaticMarkup(
      createElement(Setup, {
        models,
        status: WELCOME_STATUS,
        model: models[0].name,
        onModelChange: () => undefined,
        onStart: () => undefined,
      }),
    );

    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("Start with Test Model 0");
  });

  it("renders download and resume actions for local model cache states", () => {
    const models: ModelInfo[] = [
      TEST_MODELS[0],
      {
        ...TEST_MODELS[0],
        name: "mlx-community/incomplete-model",
        label: "Incomplete Model",
      },
    ];

    const html = renderToStaticMarkup(
      createElement(Setup, {
        models,
        status: WELCOME_STATUS,
        model: models[0].name,
        modelDownloads: DOWNLOAD_STATUSES,
        onModelChange: () => undefined,
        onStart: () => undefined,
        onDownloadModel: () => undefined,
      }),
    );

    expect(html).toContain("Download");
    expect(html).toContain("Resume download");
    expect(html).toContain("50%");
  });
});
