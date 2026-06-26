import { isLocalMlxRuntime } from "../shared/types";
import {
  buildChatRequestBody,
  chatStream as mlxChatStream,
  type MLXChatOptions,
  type MLXChatRequestBody,
  type MLXChatStreamChunk,
} from "./mlx";
import { modelRuntimeForName } from "./modelConfig";
import {
  buildRemoteChatRequestBody,
  remoteChatStream,
} from "./remoteChat";

export type ModelChatRequestBody =
  | MLXChatRequestBody
  | ReturnType<typeof buildRemoteChatRequestBody>;

export function buildModelChatRequestBody(
  opts: MLXChatOptions,
): ModelChatRequestBody {
  const runtime = modelRuntimeForName(opts.model);
  if (isLocalMlxRuntime(runtime)) {
    return buildChatRequestBody(opts);
  }
  return buildRemoteChatRequestBody(opts);
}

export async function* chatStream(
  opts: MLXChatOptions,
): AsyncGenerator<MLXChatStreamChunk> {
  const runtime = modelRuntimeForName(opts.model);
  if (isLocalMlxRuntime(runtime)) {
    yield* mlxChatStream(opts);
    return;
  }
  yield* remoteChatStream(opts);
}
