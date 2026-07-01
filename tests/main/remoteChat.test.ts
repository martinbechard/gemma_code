import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRemoteChatRequestBody,
  remoteChatStream,
} from "../../src/main/remoteChat";
import { setRuntimePaths } from "../../src/main/runtimePaths";

const NORTH_MODEL = "north-mini-code-1-0";
const GEMMA_REMOTE_MODEL = "gemma-4-31b-it";
const REMOTE_CHAT_TEST_PREFIX = "gemma-remote-chat-";
const MODEL_CONFIG_PATH = join(process.cwd(), "models.config.json");
const TEMP_DIRS: string[] = [];

function isolateCredentialEnv(): void {
  const appRoot = mkdtempSync(join(tmpdir(), REMOTE_CHAT_TEST_PREFIX));
  TEMP_DIRS.push(appRoot);
  vi.stubEnv("GEMMA_MODEL_CONFIG", MODEL_CONFIG_PATH);
  vi.stubEnv("COHERE_API_KEY", "");
  setRuntimePaths({
    appRoot,
    packaged: false,
    userData: appRoot,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setRuntimePaths({
    appRoot: process.cwd(),
    packaged: false,
    userData: process.cwd(),
  });
  for (const dir of TEMP_DIRS.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("remoteChatStream", () => {
  it("requires the configured endpoint key", async () => {
    isolateCredentialEnv();

    await expect(async () => {
      for await (const _chunk of remoteChatStream({
        model: NORTH_MODEL,
        messages: [{ role: "user", content: "hello" }],
      })) {
        // no-op
      }
    }).rejects.toThrow("COHERE_API_KEY");
  });

  it("streams OpenAI-compatible reasoning and content chunks", async () => {
    vi.stubEnv("COHERE_API_KEY", "test-key");
    const fetchMock = vi.fn(async () => {
      return new Response(
        sseStream([
          { choices: [{ delta: { reasoning_content: "think" } }] },
          { choices: [{ delta: { content: "hello" } }] },
          "[DONE]",
        ]),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const chunks = [];
    for await (const chunk of remoteChatStream({
      model: NORTH_MODEL,
      messages: [{ role: "user", content: "hello" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { reasoning: "think" },
      { content: "hello" },
      { done: true },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cohere.ai/compatibility/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-key",
        }),
      }),
    );
  });

  it("streams Gemini generateContent text chunks", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const fetchMock = vi.fn(async () => {
      return new Response(
        sseStream([
          {
            candidates: [
              { content: { parts: [{ text: "hello" }] } },
            ],
          },
          { candidates: [{ finishReason: "STOP" }] },
        ]),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const chunks = [];
    for await (const chunk of remoteChatStream({
      model: GEMMA_REMOTE_MODEL,
      messages: [
        { role: "system", content: "You are concise." },
        { role: "user", content: "hello" },
      ],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ content: "hello" }, { done: true }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:streamGenerateContent?alt=sse&key=test-key",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
        }),
      }),
    );
    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      systemInstruction: { parts: [{ text: "You are concise." }] },
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      generationConfig: { maxOutputTokens: 8192 },
    });
  });

  it("redacts Gemini API keys from remote errors", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 401 })),
    );

    await expect(async () => {
      for await (const _chunk of remoteChatStream({
        model: GEMMA_REMOTE_MODEL,
        messages: [{ role: "user", content: "hello" }],
      })) {
        // no-op
      }
    }).rejects.toThrow("key=redacted");
    await expect(async () => {
      for await (const _chunk of remoteChatStream({
        model: GEMMA_REMOTE_MODEL,
        messages: [{ role: "user", content: "hello" }],
      })) {
        // no-op
      }
    }).rejects.not.toThrow("test-key");
  });
});

describe("buildRemoteChatRequestBody", () => {
  it("uses the configured remote model id", () => {
    expect(
      buildRemoteChatRequestBody({
        model: NORTH_MODEL,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).toMatchObject({
      model: NORTH_MODEL,
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("builds Gemini generateContent request bodies", () => {
    expect(
      buildRemoteChatRequestBody({
        model: GEMMA_REMOTE_MODEL,
        messages: [
          { role: "system", content: "You are concise." },
          { role: "assistant", content: "Hi" },
          { role: "user", content: "hello" },
        ],
      }),
    ).toMatchObject({
      systemInstruction: { parts: [{ text: "You are concise." }] },
      contents: [
        { role: "model", parts: [{ text: "Hi" }] },
        { role: "user", parts: [{ text: "hello" }] },
      ],
    });
  });
});

function sseStream(
  events: Array<Record<string, unknown> | string>,
): ReadableStream {
  const body = events
    .map((event) =>
      typeof event === "string"
        ? `data: ${event}\n\n`
        : `data: ${JSON.stringify(event)}\n\n`,
    )
    .join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
}
