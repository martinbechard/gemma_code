// Standalone MLX-LM smoke test. Mirrors src/main/mlx.ts server args and env.
// Usage: node scripts/test-mlx.mjs [model]

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = 11434;
const URL = `http://127.0.0.1:${PORT}`;
const APP_DATA = join(
  homedir(),
  "Library",
  "Application Support",
  "gemma-chat",
  "mlx",
);
const VENV_PY = join(APP_DATA, "venv", "bin", "python3");
const MODELS_DIR = join(APP_DATA, "models");
const MODEL = process.argv[2] ?? "mlx-community/gemma-3-text-4b-it-4bit";
const HEALTH_TIMEOUT_MS = 600_000;
const FIRST_TOKEN_TIMEOUT_MS = 120_000;

function write(stream, message) {
  stream.write(`[test-mlx] ${message}\n`);
}

function messageFor(error) {
  if (!(error instanceof Error)) return String(error);
  const cause =
    error.cause instanceof Error ? ` cause=${error.cause.message}` : "";
  return `${error.message}${cause}`;
}

if (!existsSync(VENV_PY)) {
  write(process.stderr, `Venv python not found at ${VENV_PY}`);
  process.exit(2);
}

const args = [
  "-m",
  "mlx_lm",
  "server",
  "--model",
  MODEL,
  "--port",
  String(PORT),
];
write(process.stdout, `python : ${VENV_PY}`);
write(process.stdout, `model  : ${MODEL}`);
write(process.stdout, `HF_HOME: ${MODELS_DIR}`);
write(process.stdout, `spawn  : ${VENV_PY} ${args.join(" ")}`);

const proc = spawn(VENV_PY, args, {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    HF_HOME: MODELS_DIR,
    TRANSFORMERS_CACHE: MODELS_DIR,
    HF_HUB_DISABLE_TELEMETRY: "1",
  },
});

let earlyExit = null;
proc.stdout.on("data", (d) => process.stdout.write(`[mlx-stdout] ${d}`));
proc.stderr.on("data", (d) => process.stderr.write(`[mlx-stderr] ${d}`));
proc.on("exit", (code, signal) => {
  earlyExit = { code, signal };
  write(process.stdout, `server exited code=${code} signal=${signal}`);
});

function shutdown(exitCode) {
  if (!proc.killed) {
    write(process.stdout, "killing server (SIGTERM)");
    proc.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 500);
}

async function waitForHealth() {
  const start = Date.now();
  while (Date.now() - start < HEALTH_TIMEOUT_MS) {
    if (earlyExit)
      throw new Error(`server exited early code=${earlyExit.code}`);
    try {
      const response = await fetch(`${URL}/v1/models`);
      if (response.ok) {
        const data = await response.json();
        write(
          process.stdout,
          `healthy after ${Date.now() - start}ms ${JSON.stringify(data).slice(0, 220)}`,
        );
        return;
      }
    } catch {
      // The HTTP listener is not available until mlx_lm finishes startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`server not healthy within ${HEALTH_TIMEOUT_MS}ms`);
}

async function nonStreaming() {
  write(process.stdout, "non-streaming completion");
  const start = Date.now();
  const response = await fetch(`${URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: "Say hello in one short sentence." }],
      stream: false,
      temperature: 0,
      max_tokens: 32,
    }),
  });
  const text = await response.text();
  write(
    process.stdout,
    `status=${response.status} elapsedMs=${Date.now() - start}`,
  );
  if (!response.ok)
    throw new Error(`non-streaming failed body=${text.slice(0, 500)}`);
  const content = JSON.parse(text)?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error(
      `non-streaming returned empty content body=${text.slice(0, 500)}`,
    );
  }
  write(process.stdout, `content => ${content.trim()}`);
}

async function streaming() {
  write(process.stdout, "streaming completion");
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort("first-token timeout"),
    FIRST_TOKEN_TIMEOUT_MS,
  );
  try {
    const response = await fetch(`${URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: "Count from 1 to 5." }],
        stream: true,
        temperature: 0,
        max_tokens: 64,
      }),
      signal: controller.signal,
    });
    write(
      process.stdout,
      `stream status=${response.status} elapsedMs=${Date.now() - start}`,
    );
    if (!response.ok || !response.body)
      throw new Error(`stream failed status=${response.status}`);
    await readStream(response.body);
    write(process.stdout, `stream done totalMs=${Date.now() - start}`);
  } finally {
    clearTimeout(timer);
  }
}

async function readStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pieces = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = drainSse(buffer);
    buffer = parsed.remainder;
    pieces += parsed.pieces;
  }
  process.stdout.write("\n");
  if (pieces === 0) throw new Error("stream produced no tokens");
}

function drainSse(buffer) {
  let pieces = 0;
  let index = buffer.indexOf("\n\n");
  while (index >= 0) {
    const block = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 2);
    for (const line of block.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") {
        pieces += 1;
        process.stdout.write(delta);
      }
    }
    index = buffer.indexOf("\n\n");
  }
  return { pieces, remainder: buffer };
}

try {
  await waitForHealth();
  await nonStreaming();
  await streaming();
  write(
    process.stdout,
    "SUCCESS — model + server + chat completion all working",
  );
  shutdown(0);
} catch (error) {
  write(process.stderr, `FAILURE: ${messageFor(error)}`);
  shutdown(1);
}
