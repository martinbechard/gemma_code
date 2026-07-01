import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildChatRequestBody,
  buildServerEnv,
  buildServerArgs,
  buildSnapshotDownloadArgs,
  chatStream,
  warmupInference,
} from "../../src/main/mlx";

const TEST_MODEL = "test-model";
const ORNITH_9B_REPO = "mlx-community/Ornith-1.0-9B-4bit";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("chatStream", () => {
  it("sends thinking in both OpenAI and chat-template request fields", () => {
    expect(
      buildChatRequestBody({
        model: TEST_MODEL,
        messages: [{ role: "user", content: "Think out loud." }],
        enableThinking: true,
      }),
    ).toMatchObject({
      enable_thinking: true,
      chat_template_kwargs: {
        enable_thinking: true,
      },
    });
  });

  it("keeps reasoning separate from visible content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          sseStream([
            {
              choices: [
                {
                  delta: {
                    reasoning: "I should inspect the registry first.",
                  },
                },
              ],
            },
            {
              choices: [
                {
                  delta: {
                    content:
                      '<action name="read_file"><path>src/main/tools/index.ts</path></action>',
                  },
                },
              ],
            },
            "[DONE]",
          ]),
          { status: 200 },
        );
      }),
    );

    const chunks = [];
    for await (const chunk of chatStream({
      model: TEST_MODEL,
      messages: [{ role: "user", content: "Read the tool registry." }],
      enableThinking: true,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { reasoning: "I should inspect the registry first." },
      {
        content:
          '<action name="read_file"><path>src/main/tools/index.ts</path></action>',
      },
      { done: true },
    ]);
  });
});

describe("buildServerArgs", () => {
  it("uses mlx-lm server for standard Gemma text-compatible models", () => {
    expect(buildServerArgs("mlx-community/gemma-4-E4B-it-qat-4bit")).toEqual([
      "-m",
      "mlx_lm",
      "server",
      "--model",
      "mlx-community/gemma-4-E4B-it-qat-4bit",
      "--port",
      "11435",
      "--chat-template-args",
      "{\"enable_thinking\": false}",
    ]);
  });

  it("uses mlx-vlm server for Gemma unified models", () => {
    expect(buildServerArgs("mlx-community/gemma-4-12B-it-qat-4bit")).toEqual([
      "-m",
      "mlx_vlm.server",
      "--model",
      "mlx-community/gemma-4-12B-it-qat-4bit",
      "--host",
      "127.0.0.1",
      "--port",
      "11435",
    ]);
  });

  it("uses mlx-vlm server for Ornith 9B", () => {
    expect(buildServerArgs(ORNITH_9B_REPO)).toEqual([
      "-m",
      "mlx_vlm.server",
      "--model",
      ORNITH_9B_REPO,
      "--host",
      "127.0.0.1",
      "--port",
      "11435",
    ]);
  });

  it("adds max KV size for Gemma unified models when configured", () => {
    vi.stubEnv("GEMMA_MLX_VLM_MAX_KV_SIZE", "12288");

    expect(buildServerArgs("mlx-community/gemma-4-12B-it-qat-4bit")).toEqual([
      "-m",
      "mlx_vlm.server",
      "--model",
      "mlx-community/gemma-4-12B-it-qat-4bit",
      "--host",
      "127.0.0.1",
      "--port",
      "11435",
      "--max-kv-size",
      "12288",
    ]);
  });

  it("adds turboquant KV cache settings for Gemma unified models when configured", () => {
    vi.stubEnv("GEMMA_MLX_VLM_MAX_KV_SIZE", "12288");
    vi.stubEnv("GEMMA_MLX_VLM_KV_BITS", "8");
    vi.stubEnv("GEMMA_MLX_VLM_KV_QUANT_SCHEME", "turboquant");

    expect(buildServerArgs("mlx-community/gemma-4-12B-it-qat-4bit")).toEqual([
      "-m",
      "mlx_vlm.server",
      "--model",
      "mlx-community/gemma-4-12B-it-qat-4bit",
      "--host",
      "127.0.0.1",
      "--port",
      "11435",
      "--max-kv-size",
      "12288",
      "--kv-bits",
      "8",
      "--kv-quant-scheme",
      "turboquant",
    ]);
  });
});

describe("buildServerEnv", () => {
  it("uses the app cache and resilient Hugging Face download settings", () => {
    const env = buildServerEnv();

    expect(env.HF_HOME).toContain("gemma-code");
    expect(env.TRANSFORMERS_CACHE).toBe(env.HF_HOME);
    expect(env.HF_HUB_DISABLE_TELEMETRY).toBe("1");
    expect(env.HF_HUB_DISABLE_XET).toBe("1");
    expect(env.HF_HUB_DOWNLOAD_TIMEOUT).toBe("600");
  });
});

describe("buildSnapshotDownloadArgs", () => {
  it("calls Hugging Face snapshot_download against the app cache", () => {
    const args = buildSnapshotDownloadArgs(TEST_MODEL);

    expect(args[0]).toBe("-c");
    expect(args[1]).toContain("snapshot_download");
    expect(args[2]).toBe(TEST_MODEL);
    expect(args[3]).toContain("gemma-code");
    expect(args[3]).toContain("mlx/models");
  });
});

describe("warmupInference", () => {
  it("reports MLX server JSON errors as the warmup failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error:
              "Missing 54 parameters: language_model.model.layers.24.self_attn.k_norm.weight",
          }),
          { status: 404, statusText: "Not Found" },
        );
      }),
    );

    await expect(warmupInference(TEST_MODEL)).rejects.toThrow(
      "MLX warmup failed: serverError=Missing 54 parameters: language_model.model.layers.24.self_attn.k_norm.weight",
    );
  });
});

function sseStream(events: Array<Record<string, unknown> | string>): ReadableStream {
  const body = events
    .map((event) =>
      typeof event === "string" ? `data: ${event}\n\n` : `data: ${JSON.stringify(event)}\n\n`,
    )
    .join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
}
