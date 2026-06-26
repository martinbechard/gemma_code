# Shared Types And Model Registry Design

## Current Understanding

The shared types module defines cross-process contracts for setup status, runtime activity, tool calls, messages, plan nodes, chat requests, stream chunks, model metadata, model endpoint metadata, model provenance, and workspace data. The main-process model configuration module loads the configured model catalog and resolves runtime routing for local and remote models.

## Authoritative Sources

- [Shared types source](../../../src/shared/types.ts)
- [Model configuration file](../../../models.config.json)
- [Model configuration source](../../../src/main/modelConfig.ts)
- [Model chat router](../../../src/main/modelChat.ts)
- [Remote chat source](../../../src/main/remoteChat.ts)
- [Renderer app source](../../../src/renderer/src/App.tsx)
- [Main process source](../../../src/main/index.ts)
- [CLI args source](../../../src/cli/args.ts)
- [Model registry tests](../../../tests/shared/modelRegistry.test.ts)

## Related Code

- [src/shared/types.ts](../../../src/shared/types.ts)
- [models.config.json](../../../models.config.json)
- [src/main/modelConfig.ts](../../../src/main/modelConfig.ts)
- [src/main/modelChat.ts](../../../src/main/modelChat.ts)
- [src/main/remoteChat.ts](../../../src/main/remoteChat.ts)
- [src/cli/args.ts](../../../src/cli/args.ts)
- [src/main/mlx.ts](../../../src/main/mlx.ts)
- [src/renderer/src/components/Setup.tsx](../../../src/renderer/src/components/Setup.tsx)

## Related Tests

- [tests/shared/modelRegistry.test.ts](../../../tests/shared/modelRegistry.test.ts)
- [tests/renderer/components/Setup.test.ts](../../../tests/renderer/components/Setup.test.ts)
- [tests/cli/args.test.ts](../../../tests/cli/args.test.ts)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Local Model Runtime](../subsystems/local-model-runtime.md)
- [Open Decisions](../open-decisions.md)
- [MLX Runtime](mlx-runtime.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck this page when the model configuration file, endpoint metadata, setup states, stream chunk union, or chat request shape changes.

## Runtime Path

Primary implementation: [src/shared/types.ts](../../../src/shared/types.ts).

## Parent Context

This module supplies shared contracts across the [Architecture](../technical/architecture.md).

## Responsibilities

- Define setup, chat, plan, workspace, log, and model contracts shared by main, preload, renderer, and CLI.
- Define model metadata, runtime, endpoint, and provenance contracts.
- Load configured model choices and resolve model runtime mapping in the main process.
- Format provenance summary text for display.
- Return the configured default model after capability filtering.

## Callers

- Main process, preload bridge, renderer, CLI, MLX runtime, remote chat adapter, tests, and model setup UI.

## Dependencies

- TypeScript type system and Intl date formatting.

## Public Contracts

- [models.config.json](../../../models.config.json) is the configured model catalog.
- [src/main/modelConfig.ts](../../../src/main/modelConfig.ts) loads model configuration, applies local capability filtering, resolves default model selection, and validates remote endpoint readiness.
- [ModelInfo](../../../src/shared/types.ts) carries user-visible model metadata plus runtime and optional endpoint metadata.
- [ModelEndpointInfo](../../../src/shared/types.ts) describes provider protocol, base URL, credential environment variable, and optional provider model override.
- [src/main/modelChat.ts](../../../src/main/modelChat.ts) routes chat requests to local MLX or configured remote endpoints.

## Internal Data And State

- The model catalog is read from the configured JSON file.
- GEMMA_MODEL_CONFIG can point to an alternate model catalog.

## Processing Rules

- Unknown model names default to the MLX LM runtime for legacy local paths.
- Local MLX models are filtered out of the displayed model list when the main process reports no local MLX support.
- Remote models are visible when configured, but setup must validate the configured credential environment variable before cloud inference starts.
- Provenance summary returns an empty string when provenance is unavailable.

## Invariants

- Shared stream chunk variants must remain compatible with renderer handling and main emission.
- Model configuration order drives setup display.
- The configured default model is used when it remains visible after capability filtering. Otherwise the first visible configured model becomes the UI default.

## Configuration

- The model configuration file defines user-visible labels, descriptions, sizes, byte estimates, runtime type, recommended status, and endpoint information.

## External Interfaces

- Hugging Face model names are stored as local model ids.
- Remote provider model ids are stored as configured model names or endpoint model overrides.
- Supported endpoint kinds are OpenAI-compatible chat completions and Gemini generateContent streaming.

## UI And Notification Behavior

- Setup and model picker UI render labels, descriptions, sizes, provenance summaries, endpoint credential prompts, and recommended status from configured data.

## Error Handling

- Invalid provenance dates format as empty strings.

## Verification

- Use [tests/shared/modelRegistry.test.ts](../../../tests/shared/modelRegistry.test.ts), [tests/renderer/components/Setup.test.ts](../../../tests/renderer/components/Setup.test.ts), and [tests/cli/args.test.ts](../../../tests/cli/args.test.ts).
