import { describe, expect, it } from "vitest";
import {
  formatModelProvenanceSummary,
} from "../../src/shared/types";
import {
  allConfiguredModels,
  configuredModelList,
} from "../../src/main/modelConfig";

const GEMMA_4_E2B_REPO = "mlx-community/gemma-4-e2b-it-4bit";
const GEMMA_4_E2B_SIZE = "3.6 GB";
const GEMMA_4_E2B_BYTES = 3_580_765_126;
const GEMMA_4_E4B_REPO = "mlx-community/gemma-4-e4b-it-4bit";
const GEMMA_4_E4B_SIZE = "5.2 GB";
const GEMMA_4_E4B_BYTES = 5_216_992_212;
const GEMMA_4_E4B_QAT_REPO = "mlx-community/gemma-4-E4B-it-qat-4bit";
const GEMMA_4_E4B_QAT_SIZE = "6.8 GB";
const GEMMA_4_E4B_QAT_BYTES = 6_800_000_000;
const GEMMA_4_12B_QAT_REPO = "mlx-community/gemma-4-12B-it-qat-4bit";
const GEMMA_4_12B_QAT_SIZE = "11 GB";
const GEMMA_4_12B_QAT_BYTES = 11_000_000_000;
const ORNITH_9B_REPO = "mlx-community/Ornith-1.0-9B-4bit";
const ORNITH_9B_SIZE = "6.0 GB";
const ORNITH_9B_BYTES = 5_977_072_107;

function modelByName(name: string) {
  return allConfiguredModels().find((model) => model.name === name);
}

describe("configured models", () => {
  it("keeps Gemma 4 E2B available with its real MLX weight size", () => {
    const model = modelByName(GEMMA_4_E2B_REPO);

    expect(model).toMatchObject({
      label: "Gemma 4 E2B",
      size: GEMMA_4_E2B_SIZE,
      sizeBytes: GEMMA_4_E2B_BYTES,
    });
  });

  it("uses Gemma 4 E4B as the default larger Gemma 4 model", () => {
    expect(configuredModelList({ hasMLX: true }).defaultModel).toBe(
      GEMMA_4_E4B_REPO,
    );
    expect(modelByName(GEMMA_4_E4B_REPO)).toMatchObject({
      label: "Gemma 4 E4B",
      size: GEMMA_4_E4B_SIZE,
      sizeBytes: GEMMA_4_E4B_BYTES,
      recommended: true,
    });
  });

  it("includes supported Gemma 4 QAT comparison models without changing the default", () => {
    expect(configuredModelList({ hasMLX: true }).defaultModel).toBe(
      GEMMA_4_E4B_REPO,
    );
    expect(modelByName(GEMMA_4_E4B_QAT_REPO)).toMatchObject({
      label: "Gemma 4 E4B QAT",
      size: GEMMA_4_E4B_QAT_SIZE,
      sizeBytes: GEMMA_4_E4B_QAT_BYTES,
      runtime: "mlx-lm",
    });
  });

  it("routes Gemma 4 12B QAT through the VLM runtime for gemma4_unified", () => {
    expect(modelByName(GEMMA_4_12B_QAT_REPO)).toMatchObject({
      label: "Gemma 4 12B QAT",
      size: GEMMA_4_12B_QAT_SIZE,
      sizeBytes: GEMMA_4_12B_QAT_BYTES,
      runtime: "mlx-vlm",
    });
  });

  it("offers Ornith 1.0 9B as a local MLX VLM coding model for 16GB Macs", () => {
    expect(modelByName(ORNITH_9B_REPO)).toMatchObject({
      label: "Ornith 1.0 9B",
      size: ORNITH_9B_SIZE,
      sizeBytes: ORNITH_9B_BYTES,
      description: "Agentic coding model. Experimental 9B 4-bit MLX VLM option for 16GB Macs.",
      runtime: "mlx-vlm",
    });
  });

  it("hides local MLX models when MLX is unavailable", () => {
    const list = configuredModelList({ hasMLX: false });

    expect(list.models.some((model) => model.runtime === "mlx-lm")).toBe(false);
    expect(list.models.some((model) => model.runtime === "mlx-vlm")).toBe(false);
    expect(modelByName("north-mini-code-1-0")).toMatchObject({
      runtime: "remote",
      endpoint: {
        kind: "openai-compatible",
        baseUrl: "https://api.cohere.ai/compatibility/v1",
        apiKeyEnv: "COHERE_API_KEY",
      },
    });
    expect(modelByName("gemma-4-31b-it")).toMatchObject({
      runtime: "remote",
      endpoint: {
        kind: "gemini-generate-content",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        apiKeyEnv: "GEMINI_API_KEY",
      },
    });
  });
});

describe("formatModelProvenanceSummary", () => {
  it("prefers upstream last modified date with a short revision", () => {
    expect(
      formatModelProvenanceSummary({
        model: GEMMA_4_E4B_REPO,
        revision: "deb1db712068b1c9f83fb1c97f08c1204b9459a1",
        upstreamLastModified: "2026-05-19T13:18:45.000Z",
        localCachedAt: "2026-06-01T23:20:13.000-04:00",
        weightsBytes: 5_217_361_182,
      }),
    ).toBe("updated May 19, 2026 · deb1db7");
  });

  it("falls back to local cache time when upstream metadata is missing", () => {
    expect(
      formatModelProvenanceSummary({
        model: GEMMA_4_E4B_REPO,
        revision: "deb1db712068b1c9f83fb1c97f08c1204b9459a1",
        upstreamLastModified: null,
        localCachedAt: "2026-06-01T23:20:13.000-04:00",
        weightsBytes: 5_217_361_182,
      }),
    ).toBe("cached Jun 1, 2026 · deb1db7");
  });
});
