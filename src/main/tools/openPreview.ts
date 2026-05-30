import { previewUrl } from "../workspace";
import type { ToolContext, ToolSpec } from "./types";

export const openPreviewTool: ToolSpec = {
  name: "open_preview",
  description:
    "Reveal the Canvas preview. Call after creating or updating index.html so the user sees the result.",
  params: [],
  example: '<action name="open_preview"></action>',
  mode: "code",
  run: openPreview,
};

async function openPreview(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const url = previewUrl(ctx.conversationId);
  return `Preview is live at ${url}. The Canvas pane on the right shows it.`;
}
