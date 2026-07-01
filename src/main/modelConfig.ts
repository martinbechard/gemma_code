import { existsSync, readFileSync } from "fs";
import { isAbsolute, join } from "path";
import { appRootDir } from "./runtimePaths";
import {
  isLocalMlxRuntime,
  type ModelEndpointInfo,
  type ModelInfo,
  type ModelListResult,
  type ModelRuntime,
} from "../shared/types";
import { readCredentialEnvValue } from "./envFile";

const MODEL_CONFIG_ENV = "GEMMA_MODEL_CONFIG";
const DEFAULT_MODEL_CONFIG_FILE = "models.config.json";
const DEFAULT_MODEL_RUNTIME: ModelRuntime = "mlx-lm";

interface ModelConfigFile {
  defaultModel: string;
  models: ModelInfo[];
}

interface ModelVisibilityOptions {
  hasMLX: boolean;
}

export function configuredModelList(
  options: ModelVisibilityOptions,
): ModelListResult {
  const config = loadModelConfig();
  const models = filterModelsForCapabilities(config.models, options);
  return {
    models,
    defaultModel: resolveDefaultModel(config.defaultModel, models),
  };
}

export function allConfiguredModels(): ModelInfo[] {
  return loadModelConfig().models;
}

export function modelInfoForName(model: string): ModelInfo | undefined {
  return allConfiguredModels().find((candidate) => candidate.name === model);
}

export function modelRuntimeForName(model: string): ModelRuntime {
  return modelInfoForName(model)?.runtime ?? DEFAULT_MODEL_RUNTIME;
}

export function endpointForModel(model: string): ModelEndpointInfo | undefined {
  return modelInfoForName(model)?.endpoint;
}

export function isLocalModel(model: string): boolean {
  return isLocalMlxRuntime(modelRuntimeForName(model));
}

export function validateRemoteModelReady(model: string): void {
  const info = modelInfoForName(model);
  if (!info) {
    throw new Error(`Unknown model: ${model}`);
  }
  if (isLocalMlxRuntime(info.runtime)) {
    return;
  }
  if (!info.endpoint) {
    throw new Error(`${info.label} does not have endpoint configuration.`);
  }
  const token = readCredentialEnvValue(info.endpoint.apiKeyEnv);
  if (!token || token.trim().length === 0) {
    throw new Error(
      `${info.label} requires ${info.endpoint.apiKeyEnv} before it can use cloud inference.`,
    );
  }
}

export function filterModelsForCapabilities(
  models: ModelInfo[],
  options: ModelVisibilityOptions,
): ModelInfo[] {
  return models.filter(
    (model) => !isLocalMlxRuntime(model.runtime) || options.hasMLX,
  );
}

function loadModelConfig(): ModelConfigFile {
  const configPath = resolveModelConfigPath();
  const raw = readFileSync(configPath, "utf8");
  return parseModelConfig(JSON.parse(raw) as unknown, configPath);
}

function resolveModelConfigPath(): string {
  const configuredPath = process.env[MODEL_CONFIG_ENV];
  if (configuredPath && configuredPath.trim().length > 0) {
    return isAbsolute(configuredPath)
      ? configuredPath
      : join(appRootDir(), configuredPath);
  }
  const defaultPath = join(appRootDir(), DEFAULT_MODEL_CONFIG_FILE);
  if (existsSync(defaultPath)) return defaultPath;
  return join(process.cwd(), DEFAULT_MODEL_CONFIG_FILE);
}

function parseModelConfig(value: unknown, source: string): ModelConfigFile {
  const record = requireRecord(value, source);
  const defaultModel = requireString(record, "defaultModel", source);
  const rawModels = requireArray(record, "models", source);
  const models = rawModels.map((rawModel, index) =>
    parseModelInfo(rawModel, `${source}:models[${index}]`),
  );
  if (!models.some((model) => model.name === defaultModel)) {
    throw new Error(`${source}: defaultModel does not match a configured model`);
  }
  return { defaultModel, models };
}

function parseModelInfo(value: unknown, source: string): ModelInfo {
  const record = requireRecord(value, source);
  const runtime = parseRuntime(requireString(record, "runtime", source), source);
  const endpoint = parseEndpoint(record.endpoint, source);
  return {
    name: requireString(record, "name", source),
    label: requireString(record, "label", source),
    size: requireString(record, "size", source),
    sizeBytes: requireNumber(record, "sizeBytes", source),
    description: requireString(record, "description", source),
    runtime,
    ...(endpoint ? { endpoint } : {}),
    ...(record.recommended === true ? { recommended: true } : {}),
  };
}

function parseRuntime(value: string, source: string): ModelRuntime {
  if (
    value === "mlx-lm" ||
    value === "mlx-vlm" ||
    value === "remote"
  ) {
    return value;
  }
  throw new Error(`${source}: unsupported runtime ${value}`);
}

function parseEndpoint(
  value: unknown,
  source: string,
): ModelEndpointInfo | undefined {
  if (value == null) return undefined;
  const record = requireRecord(value, `${source}:endpoint`);
  const kind = requireString(record, "kind", `${source}:endpoint`);
  if (kind !== "openai-compatible" && kind !== "gemini-generate-content") {
    throw new Error(`${source}:endpoint unsupported endpoint kind ${kind}`);
  }
  const base = {
    kind,
    baseUrl: requireString(record, "baseUrl", `${source}:endpoint`),
    apiKeyEnv: requireString(record, "apiKeyEnv", `${source}:endpoint`),
    ...(typeof record.model === "string" ? { model: record.model } : {}),
  };
  const endpoint: ModelEndpointInfo =
    kind === "openai-compatible"
      ? {
          ...base,
          kind,
          ...(typeof record.chatCompletionsPath === "string"
            ? { chatCompletionsPath: record.chatCompletionsPath }
            : {}),
        }
      : {
          ...base,
          kind,
        };
  return endpoint;
}

function resolveDefaultModel(defaultModel: string, models: ModelInfo[]): string {
  if (models.some((model) => model.name === defaultModel)) return defaultModel;
  return models[0]?.name ?? defaultModel;
}

function requireRecord(
  value: unknown,
  source: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    throw new Error(`${source}: expected object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(
  record: Record<string, unknown>,
  key: string,
  source: string,
): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`${source}: expected ${key} array`);
  }
  return value;
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  source: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${source}: expected ${key} string`);
  }
  return value;
}

function requireNumber(
  record: Record<string, unknown>,
  key: string,
  source: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${source}: expected ${key} number`);
  }
  return value;
}
