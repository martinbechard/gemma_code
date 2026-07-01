import {
  defaultEnvFilePath,
  readCredentialEnvValue,
  writeEnvFileValue,
} from "./envFile";
import { isLocalMlxRuntime, type RemoteCredentialStatus } from "../shared/types";
import { modelInfoForName } from "./modelConfig";

export function remoteCredentialStatusForModel(
  model: string,
): RemoteCredentialStatus {
  const info = modelInfoForName(model);
  if (!info) {
    throw new Error(`Unknown model: ${model}`);
  }
  if (isLocalMlxRuntime(info.runtime) || !info.endpoint) {
    throw new Error(`${info.label} does not use cloud credentials.`);
  }
  const value = readCredentialEnvValue(info.endpoint.apiKeyEnv);
  return {
    model,
    label: info.label,
    apiKeyEnv: info.endpoint.apiKeyEnv,
    hasCredential: value != null && value.length > 0,
    envFilePath: defaultEnvFilePath(),
  };
}

export function saveRemoteCredentialForModel(
  model: string,
  value: string,
): RemoteCredentialStatus {
  const info = modelInfoForName(model);
  if (!info) {
    throw new Error(`Unknown model: ${model}`);
  }
  if (isLocalMlxRuntime(info.runtime) || !info.endpoint) {
    throw new Error(`${info.label} does not use cloud credentials.`);
  }
  writeEnvFileValue(info.endpoint.apiKeyEnv, value);
  return remoteCredentialStatusForModel(model);
}
