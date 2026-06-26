import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Setup, {
  setupErrorClipboardText,
} from "../../../src/renderer/src/components/Setup";
import type { ModelInfo, SetupStatus } from "../../../src/shared/types";

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
});
