import { afterEach, describe, expect, it, vi } from "vitest";
import { chatStream, warmupInference } from "../../src/main/mlx";

const TEST_MODEL = "test-model";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chatStream", () => {
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
