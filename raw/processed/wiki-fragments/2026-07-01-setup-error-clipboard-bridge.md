# Wiki Fragment: Setup Error Clipboard Bridge

## Source Files

- src/preload/index.ts
- src/renderer/src/components/Setup.tsx
- tests/renderer/components/Setup.test.ts

## Extracted Facts

- The setup error copy action is exposed through the preload API as copyTextToClipboard.
- The preload implementation writes text with Electron clipboard support.
- The Setup component formats setup error details, then calls the preload clipboard bridge before showing the copied confirmation.
- The renderer keeps a browser clipboard fallback for non-Electron contexts.

## Candidate Wiki Pages

- docs/wiki/modules/renderer-ui.md
- docs/wiki/modules/preload-ipc-bridge.md

## Processing Notes

- The candidate wiki pages reflect the preload clipboard bridge and wiki lint passed before this fragment was processed.
