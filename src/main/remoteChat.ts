import {
  endpointForModel,
  validateRemoteModelReady,
} from "./modelConfig";
import { readCredentialEnvValue } from "./envFile";
import { readSSE } from "./sse";
import type {
  GeminiGenerateContentEndpointInfo,
  OpenAiCompatibleEndpointInfo,
} from "../shared/types";
import type {
  MLXChatMessage,
  MLXChatOptions,
  MLXChatRequestMessage,
  MLXChatStreamChunk,
} from "./mlx";

const REMOTE_CHAT_MAX_TOKENS = 8192;
const REMOTE_CHAT_TEMPERATURE = 0.7;
const REMOTE_FIRST_TOKEN_TIMEOUT_MS = 120_000;
const REMOTE_ERROR_TEXT_TAIL_CHARS = 500;
const DEFAULT_CHAT_COMPLETIONS_PATH = "/chat/completions";
const GEMINI_STREAM_GENERATE_CONTENT_ACTION = ":streamGenerateContent";
const GEMINI_STREAM_ALT = "sse";
const GEMINI_API_KEY_QUERY_PARAM = "key";
const REDACTED_QUERY_VALUE = "redacted";

interface OpenAiCompatibleChatRequestBody {
  model: string;
  messages: MLXChatRequestMessage[];
  stream: boolean;
  temperature: number;
  max_tokens: number;
}

interface GeminiTextPart {
  text: string;
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiTextPart[];
}

interface GeminiGenerationConfig {
  temperature: number;
  maxOutputTokens: number;
}

interface GeminiSystemInstruction {
  parts: GeminiTextPart[];
}

interface GeminiGenerateContentRequestBody {
  contents: GeminiContent[];
  generationConfig: GeminiGenerationConfig;
  systemInstruction?: GeminiSystemInstruction;
}

export type RemoteChatRequestBody =
  | OpenAiCompatibleChatRequestBody
  | GeminiGenerateContentRequestBody;

interface RemoteChatDelta {
  content?: string;
  reasoning?: string;
  reasoning_content?: string;
}

interface RemoteChatChoice {
  delta?: RemoteChatDelta;
  finish_reason?: string | null;
}

interface RemoteChatEvent {
  choices?: RemoteChatChoice[];
}

interface GeminiCandidatePart {
  text?: string;
}

interface GeminiCandidateContent {
  parts?: GeminiCandidatePart[];
}

interface GeminiCandidate {
  content?: GeminiCandidateContent;
  finishReason?: string;
}

interface GeminiGenerateContentEvent {
  candidates?: GeminiCandidate[];
}

type RemoteContentChunk = { content: string } | { reasoning: string };

interface RemoteSseEventResult {
  chunks: RemoteContentChunk[];
  done: boolean;
}

export function buildRemoteChatRequestBody(
  opts: MLXChatOptions,
): RemoteChatRequestBody {
  const endpoint = endpointForModel(opts.model);
  if (endpoint?.kind === "gemini-generate-content") {
    return buildGeminiGenerateContentRequestBody(opts);
  }
  return buildOpenAiCompatibleChatRequestBody(opts, endpoint?.model);
}

function buildOpenAiCompatibleChatRequestBody(
  opts: MLXChatOptions,
  endpointModel: string | undefined,
): OpenAiCompatibleChatRequestBody {
  return {
    model: endpointModel ?? opts.model,
    messages: opts.messages.map(remoteMessageFromMlxMessage),
    stream: true,
    temperature: opts.temperature ?? REMOTE_CHAT_TEMPERATURE,
    max_tokens: REMOTE_CHAT_MAX_TOKENS,
  };
}

function buildGeminiGenerateContentRequestBody(
  opts: MLXChatOptions,
): GeminiGenerateContentRequestBody {
  const systemText = opts.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0)
    .join("\n\n");

  return {
    contents: opts.messages
      .filter((message) => message.role !== "system")
      .map(geminiContentFromMlxMessage),
    generationConfig: {
      temperature: opts.temperature ?? REMOTE_CHAT_TEMPERATURE,
      maxOutputTokens: REMOTE_CHAT_MAX_TOKENS,
    },
    ...(systemText.length > 0
      ? { systemInstruction: { parts: [{ text: systemText }] } }
      : {}),
  };
}

export async function* remoteChatStream(
  opts: MLXChatOptions,
): AsyncGenerator<MLXChatStreamChunk> {
  validateRemoteModelReady(opts.model);
  const endpoint = endpointForModel(opts.model);
  if (!endpoint) {
    throw new Error(`${opts.model} does not have endpoint configuration.`);
  }
  const apiKey = readCredentialEnvValue(endpoint.apiKeyEnv);
  if (!apiKey) {
    throw new Error(`${opts.model} requires ${endpoint.apiKeyEnv}.`);
  }
  if (endpoint.kind === "gemini-generate-content") {
    yield* geminiGenerateContentStream(opts, endpoint, apiKey);
    return;
  }
  yield* openAiCompatibleChatStream(opts, endpoint, apiKey);
}

async function* openAiCompatibleChatStream(
  opts: MLXChatOptions,
  endpoint: OpenAiCompatibleEndpointInfo,
  apiKey: string,
): AsyncGenerator<MLXChatStreamChunk> {
  const url = chatCompletionsUrl(
    endpoint.baseUrl,
    endpoint.chatCompletionsPath ?? DEFAULT_CHAT_COMPLETIONS_PATH,
  );
  yield* streamRemoteSse({
    opts,
    url,
    displayUrl: url,
    fetchOptions: {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildRemoteChatRequestBody(opts)),
    },
    parseEvent: parseOpenAiCompatibleChatEvent,
  });
}

async function* geminiGenerateContentStream(
  opts: MLXChatOptions,
  endpoint: GeminiGenerateContentEndpointInfo,
  apiKey: string,
): AsyncGenerator<MLXChatStreamChunk> {
  const url = geminiGenerateContentUrl(
    endpoint.baseUrl,
    endpoint.model ?? opts.model,
    apiKey,
  );
  yield* streamRemoteSse({
    opts,
    url,
    displayUrl: redactedQueryParamUrl(url, GEMINI_API_KEY_QUERY_PARAM),
    fetchOptions: {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(buildRemoteChatRequestBody(opts)),
    },
    parseEvent: parseGeminiGenerateContentEvent,
  });
}

async function* streamRemoteSse({
  opts,
  url,
  displayUrl,
  fetchOptions,
  parseEvent,
}: {
  opts: MLXChatOptions;
  url: string;
  displayUrl: string;
  fetchOptions: RequestInit;
  parseEvent: (event: string) => RemoteSseEventResult;
}): AsyncGenerator<MLXChatStreamChunk> {
  const startedAt = Date.now();
  const abortController = new AbortController();
  let timeoutTriggered = false;
  const handleAbort = (): void => {
    abortController.abort("chat request aborted");
  };

  if (opts.signal) {
    if (opts.signal.aborted) {
      throw new Error("Remote chat request aborted before sending");
    }
    opts.signal.addEventListener("abort", handleAbort);
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  timeoutHandle = setTimeout(() => {
    timeoutTriggered = true;
    abortController.abort("first token timeout");
  }, REMOTE_FIRST_TOKEN_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: abortController.signal,
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      throw new Error(
        remoteErrorMessage(displayUrl, opts.model, startedAt, response, text),
      );
    }

    let receivedFirstEvent = false;
    const stream = response.body as unknown as ReadableStream<Uint8Array>;
    for await (const event of readSSE(stream)) {
      const parsed = parseEvent(event);
      if (parsed.chunks.length > 0) {
        if (!receivedFirstEvent) {
          receivedFirstEvent = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
        }
        for (const chunk of parsed.chunks) {
          yield chunk;
        }
      }
      if (parsed.done) {
        yield { done: true };
        return;
      }
    }
    yield { done: true };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    if (timeoutTriggered) {
      throw new Error(
        `Remote first-token timeout (${REMOTE_FIRST_TOKEN_TIMEOUT_MS}ms): endpoint=${displayUrl} model=${opts.model} elapsedMs=${elapsedMs}`,
      );
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Remote chat request aborted: endpoint=${displayUrl} model=${opts.model} elapsedMs=${elapsedMs}. ${error.message}`,
      );
    }
    if (error instanceof Error) {
      throw new Error(
        `Remote chat stream failed: endpoint=${displayUrl} model=${opts.model} elapsedMs=${elapsedMs} cause=${error.message}`,
      );
    }
    throw error;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (opts.signal) {
      opts.signal.removeEventListener("abort", handleAbort);
    }
  }
}

function remoteMessageFromMlxMessage(
  message: MLXChatMessage,
): MLXChatRequestMessage {
  return {
    role: message.role,
    content: message.content,
  };
}

function geminiContentFromMlxMessage(message: MLXChatMessage): GeminiContent {
  return {
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  };
}

function chatCompletionsUrl(baseUrl: string, path: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

function geminiGenerateContentUrl(
  baseUrl: string,
  model: string,
  apiKey: string,
): string {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const url = new URL(
    `${cleanBase}/models/${encodeURIComponent(model)}${GEMINI_STREAM_GENERATE_CONTENT_ACTION}`,
  );
  url.searchParams.set("alt", GEMINI_STREAM_ALT);
  url.searchParams.set(GEMINI_API_KEY_QUERY_PARAM, apiKey);
  return url.toString();
}

function redactedQueryParamUrl(url: string, queryParam: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has(queryParam)) {
      parsed.searchParams.set(queryParam, REDACTED_QUERY_VALUE);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function parseOpenAiCompatibleChatEvent(event: string): RemoteSseEventResult {
  if (event === "[DONE]") {
    return { chunks: [], done: true };
  }
  const parsed = parseRemoteChatEvent(event);
  const choice = parsed.choices?.[0];
  const chunks: RemoteContentChunk[] = [];
  const reasoning =
    choice?.delta?.reasoning ?? choice?.delta?.reasoning_content;
  if (reasoning) {
    chunks.push({ reasoning });
  }
  if (choice?.delta?.content) {
    chunks.push({ content: choice.delta.content });
  }
  return {
    chunks,
    done:
      choice?.finish_reason === "stop" ||
      choice?.finish_reason === "length",
  };
}

function parseGeminiGenerateContentEvent(event: string): RemoteSseEventResult {
  const parsed = parseGeminiEvent(event);
  const chunks: RemoteContentChunk[] = [];
  let done = false;
  for (const candidate of parsed.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.text && part.text.length > 0) {
        chunks.push({ content: part.text });
      }
    }
    if (
      candidate.finishReason &&
      candidate.finishReason !== "FINISH_REASON_UNSPECIFIED"
    ) {
      done = true;
    }
  }
  return { chunks, done };
}

function parseRemoteChatEvent(event: string): RemoteChatEvent {
  try {
    return JSON.parse(event) as RemoteChatEvent;
  } catch {
    return {};
  }
}

function parseGeminiEvent(event: string): GeminiGenerateContentEvent {
  try {
    return JSON.parse(event) as GeminiGenerateContentEvent;
  } catch {
    return {};
  }
}

function remoteErrorMessage(
  endpoint: string,
  model: string,
  startedAt: number,
  response: Response,
  responseText: string,
): string {
  const elapsedMs = Date.now() - startedAt;
  const detail = responseText
    ? ` response=${responseText.slice(-REMOTE_ERROR_TEXT_TAIL_CHARS)}`
    : "";
  return `endpoint=${endpoint} model=${model} elapsedMs=${elapsedMs} status=${response.status} ${response.statusText}${detail}`;
}
