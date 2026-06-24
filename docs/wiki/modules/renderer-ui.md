# Renderer UI Design

## Current Understanding

The renderer UI owns setup, chat, model selection, conversation persistence, code/build mode selection, streamed message rendering, execution log viewing, file-context presentation, and workspace interactions.

## Authoritative Sources

- [Renderer app](../../../src/renderer/src/App.tsx)
- [Chat component](../../../src/renderer/src/components/Chat.tsx)
- [Setup component](../../../src/renderer/src/components/Setup.tsx)
- [Conversation store helpers](../../../src/renderer/src/lib/conversationStore.ts)
- [Shared types](../../../src/shared/types.ts)

## Related Code

- [src/renderer/src/App.tsx](../../../src/renderer/src/App.tsx)
- [src/renderer/src/components](../../../src/renderer/src/components)
- [src/renderer/src/lib/conversationStore.ts](../../../src/renderer/src/lib/conversationStore.ts)
- [src/renderer/src/lib/messageTimeline.ts](../../../src/renderer/src/lib/messageTimeline.ts)
- [src/renderer/src/styles.css](../../../src/renderer/src/styles.css)

## Related Tests

- [tests/renderer/components/Setup.test.ts](../../../tests/renderer/components/Setup.test.ts)
- [tests/renderer/components/Message.test.ts](../../../tests/renderer/components/Message.test.ts)
- [tests/renderer/components/ChatLogSummary.test.ts](../../../tests/renderer/components/ChatLogSummary.test.ts)
- [tests/renderer/lib/conversationStore.test.ts](../../../tests/renderer/lib/conversationStore.test.ts)
- [tests/renderer/lib/messageTimeline.test.ts](../../../tests/renderer/lib/messageTimeline.test.ts)
- [tests/renderer/stylesSelection.test.ts](../../../tests/renderer/stylesSelection.test.ts)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Electron App Runtime](../subsystems/electron-app-runtime.md)
- [Electron App Workflows](../functional/electron-app-workflows.md)
- [Local Model Setup](../functional/local-model-setup.md)
- [Preload IPC Bridge](preload-ipc-bridge.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck this page when conversation persistence, setup state, chat stream handling, mode selection, or log viewer behavior changes.

## Runtime Path

Primary implementation: [src/renderer/src/App.tsx](../../../src/renderer/src/App.tsx) and [src/renderer/src/components/Chat.tsx](../../../src/renderer/src/components/Chat.tsx).

## Parent Context

This module implements the UI side of the [Electron App Runtime](../subsystems/electron-app-runtime.md).

## Responsibilities

- Show boot, setup, ready, and model-switching phases.
- Let users select and repair models.
- Manage conversations and persist them in localStorage.
- Distinguish Chat, Build, and Code UI modes.
- Send ChatRequest payloads through preload.
- Consume StreamChunk events into messages, timelines, plan nodes, reviews, tool cards, and activity states.
- Display execution log snapshots and refresh the log viewer.
- Track file context from successful file tool results.

## Callers

- Loaded by the Electron renderer entrypoint.

## Dependencies

- Preload API, shared types, React state/effects, localStorage, renderer components, and static assets.

## Public Contracts

- The renderer uses window.api methods exposed by [Preload IPC Bridge](preload-ipc-bridge.md).
- Persisted conversations use the storage keys defined in [conversationStore](../../../src/renderer/src/lib/conversationStore.ts).

## Internal Data And State

- App owns setup phase state. Chat owns conversations, active id, streaming state, log viewer state, runtime toggles, last working directory, and model provenance cache.

## Processing Rules

- Startup prefers the most recently stamped conversation model when it is locally available.
- Code conversations with a working directory lock mode after messages are exchanged.
- System and harness messages are not sent back as normal conversation history.
- Planning messages can collapse once execution begins.

## Invariants

- Nothing in the renderer calls Node or Electron APIs directly.
- Setup repair UI appears only when setup status includes repair metadata.
- Conversation model stamping drives startup model preference.

## Configuration

- User toggles for execution logging, thinking, and one-shot plan generation are persisted in localStorage.

## External Interfaces

- Browser localStorage, Clipboard API for setup error copy, and preload IPC.

## UI And Notification Behavior

- Shows setup progress, byte counts, repair controls, model provenance summaries, stream content, tool calls, plan views, log entries, and workspace context.

## Error Handling

- Log read failures and setup failures are displayed to the user. Persisted conversation parse failures fall back to an empty list.

## Verification

- Use renderer tests under [tests/renderer](../../../tests/renderer).
