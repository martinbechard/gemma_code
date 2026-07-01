---
type: "Topic"
title: "Preload IPC Bridge Design"
description: "The preload bridge exposes a typed renderer API over Electron IPC while preserving context isolation."
tags: ["modules"]
---

# Preload IPC Bridge Design

## Current Understanding

The preload bridge exposes a typed renderer API while preserving context isolation. It is the renderer-facing bridge to setup, configured model listing, model switching, chat, debug log, tools, workspace, directory picker, clipboard writes, file streaming, raw chunk, and an audio transcription IPC method.

## Authoritative Sources

- [Preload implementation](../../../src/preload/index.ts)
- [Preload type declaration](../../../src/preload/index.d.ts)
- [Main process IPC handlers](../../../src/main/index.ts)
- [Shared types](../../../src/shared/types.ts)

## Related Code

- [src/preload/index.ts](../../../src/preload/index.ts)
- [src/preload/index.d.ts](../../../src/preload/index.d.ts)
- [src/main/index.ts](../../../src/main/index.ts)
- [src/renderer/src/App.tsx](../../../src/renderer/src/App.tsx)
- [src/renderer/src/components/Chat.tsx](../../../src/renderer/src/components/Chat.tsx)

## Related Tests

- Not yet identified.

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Electron App Runtime](../subsystems/electron-app-runtime.md)
- [Main Process](main-process.md)
- [Renderer UI](renderer-ui.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Add focused preload/API parity tests if IPC surface churn becomes risky.
- The active voice input UI transcribes in the renderer; recheck this page if the composer starts using the audio transcription IPC method.

## Runtime Path

Primary implementation: [src/preload/index.ts](../../../src/preload/index.ts).

## Parent Context

This module implements the bridge between the [Renderer UI](renderer-ui.md) and [Main Process](main-process.md).

## Responsibilities

- Expose setup, model list, model switching, chat, log, tools, workspace, dialog, clipboard, streaming, and audio transcription methods on window.api.
- Register and unregister event listeners for setup status, workspace changes, raw chunks, and file streaming.
- Convert chat:send into a per-request stream subscription.

## Callers

- Renderer components call window.api.
- Main process handles all invoked channels and sends event channels.

## Dependencies

- Electron contextBridge, clipboard, ipcRenderer, and shared TypeScript types.

## Public Contracts

- The exposed Api type is exported from preload and declared for renderer use.
- listModels resolves a ModelListResult filtered by main-process capability detection.
- copyTextToClipboard writes text through Electron clipboard so context-isolated renderer components do not call Electron APIs directly.
- sendChat resolves when a done or error chunk arrives.
- transcribeAudio invokes the audio:transcribe IPC channel with base64 audio and a model name, but the current composer voice-input path uses renderer-side Whisper transcription instead.

## Internal Data And State

- The bridge does not own persistent state; it creates per-call listeners and cleanup functions.

## Processing Rules

- Event listener registration returns an unsubscribe function.
- Chat stream listeners are removed when terminal chunks arrive.

## Invariants

- Renderer receives only the exposed API, not raw ipcRenderer access.
- Shared types should stay aligned across preload, main, and renderer.

## Configuration

- Not applicable.

## External Interfaces

- Electron IPC and Electron clipboard.

## UI And Notification Behavior

- No direct UI; it supplies data and event streams consumed by renderer components.

## Error Handling

- invoke failures reject promises to the renderer caller.

## Verification

- Preload parity is indirectly covered by renderer and main tests. Setup error copy is covered by [Setup component tests](../../../tests/renderer/components/Setup.test.ts).
