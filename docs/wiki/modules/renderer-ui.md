---
type: "Topic"
title: "Renderer UI Design"
description: "The renderer UI owns setup, configured model selection, chat, conversation persistence, code/build mode selection, streamed message rendering, execution log viewing, file-context..."
tags: ["modules"]
---

# Renderer UI Design

## Current Understanding

The renderer UI owns setup, configured model selection, selected-model preference persistence, cloud credential configuration, chat, conversation persistence, code/build mode selection, streamed message rendering, execution log viewing, file-context presentation, workspace interactions, and renderer-side voice input.

## Authoritative Sources

- [Renderer app](../../../src/renderer/src/App.tsx)
- [Chat component](../../../src/renderer/src/components/Chat.tsx)
- [Composer component](../../../src/renderer/src/components/Composer.tsx)
- [Setup component](../../../src/renderer/src/components/Setup.tsx)
- [Conversation store helpers](../../../src/renderer/src/lib/conversationStore.ts)
- [Whisper helper](../../../src/renderer/src/lib/whisper.ts)
- [Renderer CSP](../../../src/renderer/index.html)
- [Shared types](../../../src/shared/types.ts)

## Related Code

- [src/renderer/src/App.tsx](../../../src/renderer/src/App.tsx)
- [src/renderer/src/components](../../../src/renderer/src/components)
- [src/renderer/src/lib/conversationStore.ts](../../../src/renderer/src/lib/conversationStore.ts)
- [src/renderer/src/lib/whisper.ts](../../../src/renderer/src/lib/whisper.ts)
- [src/renderer/index.html](../../../src/renderer/index.html)
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

- Recheck this page when conversation persistence, selected-model preference behavior, setup state, chat stream handling, mode selection, or log viewer behavior changes.

## Runtime Path

Primary implementation: [src/renderer/src/App.tsx](../../../src/renderer/src/App.tsx), [src/renderer/src/components/Chat.tsx](../../../src/renderer/src/components/Chat.tsx), [src/renderer/src/components/Composer.tsx](../../../src/renderer/src/components/Composer.tsx), and [src/renderer/src/lib/whisper.ts](../../../src/renderer/src/lib/whisper.ts).

## Parent Context

This module implements the UI side of the [Electron App Runtime](../subsystems/electron-app-runtime.md).

## Responsibilities

- Show boot, setup, ready, and model-switching phases.
- Show the cloud credential configuration modal for selected remote models and for missing-key setup errors.
- Let users select configured models and repair local model caches.
- Manage conversations and persist them in localStorage.
- Distinguish Chat, Build, and Code UI modes.
- Send ChatRequest payloads through preload.
- Consume StreamChunk events into messages, timelines, plan nodes, reviews, tool cards, and activity states.
- Display execution log snapshots and refresh the log viewer.
- Track file context from successful file tool results.
- Record microphone audio for voice input and append local speech-to-text output into the composer draft.

## Callers

- Loaded by the Electron renderer entrypoint.

## Dependencies

- Preload API, shared types, React state/effects, localStorage, browser media APIs, Web Audio, Hugging Face Transformers.js, renderer components, and static assets.

## Public Contracts

- The renderer uses window.api methods exposed by [Preload IPC Bridge](preload-ipc-bridge.md).
- The setup UI asks preload for remote credential status and saves provider keys through preload without reading existing secret values.
- Persisted conversations and the selected-model preference use the storage keys defined in [conversationStore](../../../src/renderer/src/lib/conversationStore.ts).
- Voice input is a renderer-side input accessory. [Composer](../../../src/renderer/src/components/Composer.tsx) records microphone audio with browser media APIs, passes the Blob to [transcribeAudioBlob](../../../src/renderer/src/lib/whisper.ts), and appends returned text to the composer draft without sending the message automatically.

## Internal Data And State

- App owns setup phase state and the current selected model preference. Chat owns conversations, active id, conversation model stamping, streaming state, log viewer state, runtime toggles, last working directory, and model provenance cache.

## Processing Rules

- Startup prefers the persisted selected-model preference when it remains available in the filtered configured model list, then falls back to the most recently stamped conversation model, then to the configured default. Local models also need local cache availability for auto-start.
- Empty conversations can switch models before the first sendable message. Model selection stamps the empty conversation before runtime switching starts. Once a conversation has user or assistant history, the model picker becomes read-only and model requests use the conversation-stamped model.
- When startup or setup selects a model that differs from the most-recent started conversation, Chat creates a fresh empty conversation stamped with the selected model instead of reusing the locked conversation.
- Remote model setup surfaces a Configure API key action from the setup picker and a Set API key action from missing-key setup errors.
- Code conversations with a working directory lock mode after messages are exchanged.
- System and harness messages are not sent back as normal conversation history.
- Planning messages can collapse once execution begins.
- Voice transcription uses Hugging Face Transformers.js with the ONNX Whisper model onnx-community/whisper-base.en. It tries WebGPU first and falls back to WASM when WebGPU initialization fails.
- The selected Gemma chat or code model is separate from voice transcription and does not change the Whisper model.

## Invariants

- Nothing in the renderer calls Node or Electron APIs directly.
- Setup repair UI appears only when setup status includes repair metadata.
- The selected-model preference drives startup model preference within the filtered configured model list, and conversation model stamping preserves the runtime for started conversations.
- Voice transcription remains independent of the chat and code model runtime.

## Configuration

- User toggles for execution logging, thinking, and one-shot plan generation are persisted in localStorage.
- The Whisper helper enables the browser cache, disallows bundled local model lookup, and allows first-use model download through the renderer content security policy.

## External Interfaces

- Browser localStorage, preload clipboard bridge for setup error copy, preload remote credential bridge, browser microphone and Web Audio APIs, Hugging Face model download endpoints allowed by the renderer CSP, and preload IPC.

## UI And Notification Behavior

- Shows setup progress, byte counts, repair controls, model provenance summaries, configured endpoint credential prompts, cloud credential modal, read-only model state for started conversations, stream content, tool calls, plan views, log entries, workspace context, voice recording state, Whisper loading progress, and local transcription state.

## Error Handling

- Log read failures, setup failures, microphone access failures, too-short recordings, and transcription failures are displayed to the user. Persisted conversation parse failures fall back to an empty list.

## Verification

- Use renderer tests under [tests/renderer](../../../tests/renderer).
