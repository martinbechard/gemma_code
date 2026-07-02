---
type: "Topic"
title: "Electron App Workflows Functional Specification"
description: "The Electron app lets users set up a configured model, chat, use voice input, run code workflows in sandbox or working-directory mode, inspect generated plans, execute plans, view..."
tags: ["functional"]
---

# Electron App Workflows Functional Specification

## Current Understanding

The Electron app lets users set up a configured model, chat, use voice input, run code workflows in sandbox or working-directory mode, inspect generated plans, execute plans, view tool calls, inspect logs, and switch models.

## Authoritative Sources

- [README app workflow](../../../README.md)
- [Renderer app](../../../src/renderer/src/App.tsx)
- [Chat component](../../../src/renderer/src/components/Chat.tsx)
- [Composer component](../../../src/renderer/src/components/Composer.tsx)
- [Whisper helper](../../../src/renderer/src/lib/whisper.ts)
- [Main process](../../../src/main/index.ts)
- [Preload bridge](../../../src/preload/index.ts)

## Related Code

- [src/renderer/src/App.tsx](../../../src/renderer/src/App.tsx)
- [src/renderer/src/components/Chat.tsx](../../../src/renderer/src/components/Chat.tsx)
- [src/renderer/src/components/Composer.tsx](../../../src/renderer/src/components/Composer.tsx)
- [src/renderer/src/components/Message.tsx](../../../src/renderer/src/components/Message.tsx)
- [src/renderer/src/components/Sidebar.tsx](../../../src/renderer/src/components/Sidebar.tsx)
- [src/renderer/src/lib/whisper.ts](../../../src/renderer/src/lib/whisper.ts)
- [src/preload/index.ts](../../../src/preload/index.ts)
- [src/main/index.ts](../../../src/main/index.ts)

## Related Tests

- [tests/renderer/components/Message.test.ts](../../../tests/renderer/components/Message.test.ts)
- [tests/renderer/components/ChatLogSummary.test.ts](../../../tests/renderer/components/ChatLogSummary.test.ts)
- [tests/renderer/lib/conversationStore.test.ts](../../../tests/renderer/lib/conversationStore.test.ts)
- [tests/renderer/lib/messageTimeline.test.ts](../../../tests/renderer/lib/messageTimeline.test.ts)

## Related Backlog Items

- Not yet identified.

## Related Wiki Pages

- [Electron App Runtime](../subsystems/electron-app-runtime.md)
- [Renderer UI](../modules/renderer-ui.md)
- [Preload IPC Bridge](../modules/preload-ipc-bridge.md)
- [Code Task Execution](code-task-execution.md)

## Open Questions

No open wiki questions are recorded for this topic.

## Maintenance Notes

- Recheck when chat mode selection, conversation persistence, log viewer, or stream chunk rendering changes.

## Parent Workflow

This page belongs to [Functional Workflows](index.md).

## Actors

- User chats, records voice input, selects modes, chooses directories, starts code tasks, approves plans, switches models, and reads logs.
- Renderer persists UI state and conversations.
- Main process executes runtime behavior and streams chunks.

## Entry Points

- App startup.
- Setup completion.
- Composer send action.
- Composer voice input action.
- Mode pills for chat, build, and code.
- Directory chooser.
- Execute Plan affordance.
- Execution log viewer.
- Model selector.

## Scope

Includes conversation management, chat, renderer-side voice input, build/code workflows, plan display, tool display, configured model switching, workspace preview, file-context display, and execution log reading.

## Concepts

- Chat mode: general assistant conversation.
- Build mode: code workflow in per-conversation sandbox.
- Code mode: code workflow in a user-selected working directory.
- Plan review: structured review returned before execution.
- Execution log: local JSONL trace of prompts, chunks, tools, and evidence.

## Workflows

1. User reaches ready app state after setup.
2. User creates or selects a conversation.
3. User chooses chat, build, or code mode.
4. User optionally records voice input, which is transcribed locally into the composer draft without submitting the message.
5. User sends a prompt.
6. Renderer sends a ChatRequest through preload.
7. Main process streams chunks.
8. Renderer updates message content, tool cards, plan nodes, reviews, activity labels, and done/error state.

## States And Rules

- Conversations persist in localStorage.
- Code mode with a working directory locks mode after messages are exchanged.
- System and harness messages are not resent as normal user-visible conversation history.
- Model selection and saved-conversation selection update renderer state without preparing runtime. The preparation overlay appears when sending a prompt or executing an approved plan needs local runtime setup or remote endpoint validation for the request model.
- Execution log viewer polls while open.
- Voice input transcribes in the renderer with Whisper and stays independent of the selected Gemma chat or code model.

## Edge Cases

- Persisted conversation parse failures fall back to an empty list.
- Log read failures display a log viewer error.
- Chat abort marks active request as stopped through main process.
- Setup repair returns the user to setup flow.
- Microphone access, too-short recording, and transcription failures display composer-level errors.

## Verification

Type: Testable

Test files: [tests/renderer](../../../tests/renderer)

Status: Present

Scenario: Renderer state helpers and display components represent conversations, messages, setup, and logs.

Steps:

1. Run renderer component and library tests.
2. Exercise setup status rendering.
3. Exercise message timeline and log summary rendering.

Assertions:

- Conversation filtering and persistence helpers behave as expected.
- Message and log UI can render structured harness data.
- Setup UI shows expected state.
