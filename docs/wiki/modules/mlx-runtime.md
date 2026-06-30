---
type: "Topic"
title: "MLX Runtime Design"
description: "The MLX runtime module supervises the app-managed Python environment, model cache inspection, MLX server process, runtime patching, local chat-completion requests, warmup..."
tags: ["modules"]
---

# MLX Runtime Design

## Current Understanding

The MLX runtime module supervises the app-managed Python environment, model cache inspection, MLX server process, runtime patching, local chat-completion requests, warmup inference, model provenance, and local cache reuse.

## Authoritative Sources

- [MLX runtime source](../../../src/main/mlx.ts)
- [Model configuration source](../../../src/main/modelConfig.ts)
- [Shared model contracts](../../../src/shared/types.ts)
- [MLX runtime transparency implementation plan](../../../design/mlx-transparency-implementation-plan.md)
- [README model runtime section](../../../README.md)
- [MLX patch notes](../../../resources/mlx-patches/README.md)

## Related Code

- [src/main/mlx.ts](../../../src/main/mlx.ts)
- [src/main/modelConfig.ts](../../../src/main/modelConfig.ts)
- [src/main/runtimePaths.ts](../../../src/main/runtimePaths.ts)
- [src/shared/types.ts](../../../src/shared/types.ts)
- [resources/mlx-patches](../../../resources/mlx-patches)

## Related Tests

- [tests/main/mlxChatStream.test.ts](../../../tests/main/mlxChatStream.test.ts)
- [tests/main/mlxServerPatch.test.ts](../../../tests/main/mlxServerPatch.test.ts)
- [tests/shared/modelRegistry.test.ts](../../../tests/shared/modelRegistry.test.ts)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Local Model Runtime](../subsystems/local-model-runtime.md)
- [Main Process](main-process.md)
- [Shared Types And Model Registry](shared-types-and-model-registry.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck this page when MLX package versions, Gemma model runtime mapping, cache inspection, or runtime patching changes.

## Runtime Path

Primary implementation: [src/main/mlx.ts](../../../src/main/mlx.ts).

## Parent Context

This module implements the [Local Model Runtime](../subsystems/local-model-runtime.md).

## Responsibilities

- Locate or create a compatible Python 3.10 through 3.13 environment.
- Install MLX packages into the managed venv.
- Apply local upstream-runtime patches when needed.
- Inspect Hugging Face model cache folders and validate inference readiness.
- Reuse global Hugging Face cache entries by symlink or copy.
- Start, stop, and monitor the MLX server process.
- Send local chat-completion requests and report useful failure context.
- Fetch model provenance for UI display.

## Callers

- [Main Process](main-process.md) calls setup, model switch, cache repair, warmup, and chat streaming APIs.
- [CLI Runtime](cli-runtime.md) calls setup/status and shared chat runtime APIs.

## Dependencies

- Node child process, filesystem, OS home directory, and fetch APIs.
- [runtimePaths](../../../src/main/runtimePaths.ts) for app data paths.
- [Shared Types And Model Registry](shared-types-and-model-registry.md) for configured model metadata and local runtime lookup.

## Public Contracts

- Setup functions return Python/runtime status or throw typed errors.
- Cache inspection returns status, snapshots, weight bytes, incomplete blobs, and readiness inputs.
- Local chat streaming yields model content and reasoning chunks.

## Internal Data And State

- Holds the active server child process, current model, recent log buffer, server log stream, and last server command.

## Processing Rules

- Existing venvs are reused only when the runtime import check passes.
- Incomplete model caches are not considered ready for inference.
- Warmup inference is the final setup proof.
- MLX server failures include recent log tail and request context.

## Invariants

- Runtime files live under the configured app user-data directory.
- Patch functions are content-detected and skip already-compatible upstream files.
- A model cache with incomplete blobs or missing weights must not be treated as ready.

## Configuration

- Model runtime mapping comes from the configured model catalog.
- Gemma 4 12B QAT and Ornith 1.0 9B route through the MLX VLM server path; standard text-compatible local models route through the MLX LM server path.
- Environment variables can tune MLX VLM KV cache size, KV bits, and quantization scheme.
- The canonical server port is exported as [MLX_SERVER_PORT](../../../src/main/mlx.ts).

## External Interfaces

- Python, pip, MLX packages, Hugging Face cache folders, local MLX HTTP server, and Hugging Face model API.

## UI And Notification Behavior

- Setup progress is surfaced through callers as setup status and runtime activity chunks.

## Error Handling

- Process, HTTP, first-token, cache, and warmup failures are wrapped with endpoint, model, elapsed time, response detail, and recent logs when available.

## Verification

- Use [tests/main/mlxChatStream.test.ts](../../../tests/main/mlxChatStream.test.ts), [tests/main/mlxServerPatch.test.ts](../../../tests/main/mlxServerPatch.test.ts), and [tests/shared/modelRegistry.test.ts](../../../tests/shared/modelRegistry.test.ts).
