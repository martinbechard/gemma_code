import { describe, expect, it } from "vitest";
import { AVAILABLE_MODELS, DEFAULT_MODEL } from "../../src/shared/types";

const GEMMA_4_E2B_REPO = "mlx-community/gemma-4-e2b-it-4bit";
const GEMMA_4_E2B_SIZE = "3.6 GB";
const GEMMA_4_E2B_BYTES = 3_580_765_126;
const GEMMA_4_E4B_REPO = "mlx-community/gemma-4-e4b-it-4bit";
const GEMMA_4_E4B_SIZE = "5.2 GB";
const GEMMA_4_E4B_BYTES = 5_216_992_212;

function modelByName(name: string) {
  return AVAILABLE_MODELS.find((model) => model.name === name);
}

describe("AVAILABLE_MODELS", () => {
  it("keeps Gemma 4 E2B available with its real MLX weight size", () => {
    const model = modelByName(GEMMA_4_E2B_REPO);

    expect(model).toMatchObject({
      label: "Gemma 4 E2B",
      size: GEMMA_4_E2B_SIZE,
      sizeBytes: GEMMA_4_E2B_BYTES,
    });
  });

  it("uses Gemma 4 E4B as the default larger Gemma 4 model", () => {
    expect(DEFAULT_MODEL).toBe(GEMMA_4_E4B_REPO);
    expect(modelByName(GEMMA_4_E4B_REPO)).toMatchObject({
      label: "Gemma 4 E4B",
      size: GEMMA_4_E4B_SIZE,
      sizeBytes: GEMMA_4_E4B_BYTES,
      recommended: true,
    });
  });
});
