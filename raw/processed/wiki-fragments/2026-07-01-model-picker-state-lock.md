# Renderer model picker state lock

Source files:

- src/renderer/src/App.tsx
- src/renderer/src/components/Chat.tsx
- src/renderer/src/lib/appState.ts
- src/renderer/src/lib/conversationStore.ts
- tests/renderer/lib/appState.test.ts
- tests/renderer/lib/conversationStore.test.ts

Extracted facts:

- App keeps the Chat component mounted while a model switch is in progress, so the active conversation and its pre-prompt selected model are not lost during runtime setup.
- App ignores setup-status events once chat is already ready, so late global setup or warmup status events cannot reset the renderer to the configured default model.
- Chat reconciles a selected model change against the actual active conversation id. Empty conversations are stamped with the selected model before the first prompt.
- If the active conversation already has sendable history and the selected model differs, Chat starts a new empty conversation stamped with the selected model.
- Once a conversation has a user, assistant, or other sendable non-system and non-harness message, the model picker is read-only for that conversation.
- A failed runtime switch shows setup error state for the target model instead of silently restoring the previous model in the renderer.

Wiki target:

- docs/wiki/modules/renderer-ui.md
