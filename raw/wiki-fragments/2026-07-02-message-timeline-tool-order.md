---
source: src/shared/types.ts, src/renderer/src/lib/messageTimeline.ts, src/renderer/src/components/Chat.tsx, src/renderer/src/components/Message.tsx
target: docs/wiki/modules/renderer-ui.md
---

# Message Timeline Tool Order

Extracted facts:

- Streamed assistant token chunks are recorded as visible text timeline items.
- Tool-call chunks are recorded as tool-call timeline items between the visible text chunks that arrive before and after the tool call.
- Message rendering uses the timeline to interleave visible markdown, thinking blocks, and tool cards in stream order.
- When assistant content is explicitly replaced by the harness, the renderer rebuilds the visible text timeline from the replacement text so stripped plan or verify control text does not remain visible.
- This keeps a tool card at the point where the assistant invoked the tool instead of moving the card above the surrounding assistant prose.
