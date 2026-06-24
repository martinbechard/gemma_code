# Shared Types And Model Registry Design

## Current Understanding

The shared types module defines cross-process contracts for setup status, runtime activity, tool calls, messages, plan nodes, chat requests, stream chunks, model metadata, model provenance, workspace data, and model runtime lookup.

## Authoritative Sources

- [Shared types source](../../../src/shared/types.ts)
- [Renderer app source](../../../src/renderer/src/App.tsx)
- [Main process source](../../../src/main/index.ts)
- [CLI args source](../../../src/cli/args.ts)
- [Model registry tests](../../../tests/shared/modelRegistry.test.ts)

## Related Code

- [src/shared/types.ts](../../../src/shared/types.ts)
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

- Recheck this page when the model registry, setup states, stream chunk union, or chat request shape changes.

## Runtime Path

Primary implementation: [src/shared/types.ts](../../../src/shared/types.ts).

## Parent Context

This module supplies shared contracts across the [Architecture](../technical/architecture.md).

## Responsibilities

- Define setup, chat, plan, workspace, log, and model contracts shared by main, preload, renderer, and CLI.
- Register available Gemma model choices and model runtime mapping.
- Format provenance summary text for display.
- Export the shared app default model.

## Callers

- Main process, preload bridge, renderer, CLI, MLX runtime, tests, and model setup UI.

## Dependencies

- TypeScript type system and Intl date formatting.

## Public Contracts

- [AVAILABLE_MODELS](../../../src/shared/types.ts) is the shared model registry.
- [DEFAULT_MODEL](../../../src/shared/types.ts) is the shared app default model.
- [modelRuntimeForName](../../../src/shared/types.ts) chooses MLX LM or MLX VLM runtime.

## Internal Data And State

- Model repo ids and byte sizes are constants.

## Processing Rules

- Unknown model names default to the MLX LM runtime.
- Provenance summary returns an empty string when provenance is unavailable.

## Invariants

- Shared stream chunk variants must remain compatible with renderer handling and main emission.
- Model registry order drives default UI selection and setup display.

## Configuration

- Model registry constants define user-visible labels, descriptions, sizes, byte estimates, runtime type, and recommended status.

## External Interfaces

- Hugging Face model names are stored as registry ids.

## UI And Notification Behavior

- Setup and model picker UI render labels, descriptions, sizes, provenance summaries, and recommended status from shared data.

## Error Handling

- Invalid provenance dates format as empty strings.

## Verification

- Use [tests/shared/modelRegistry.test.ts](../../../tests/shared/modelRegistry.test.ts), [tests/renderer/components/Setup.test.ts](../../../tests/renderer/components/Setup.test.ts), and [tests/cli/args.test.ts](../../../tests/cli/args.test.ts).
