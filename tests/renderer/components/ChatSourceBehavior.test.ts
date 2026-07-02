import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CHAT_SOURCE = readFileSync(
  join(process.cwd(), "src/renderer/src/components/Chat.tsx"),
  "utf8",
);

describe("Chat runtime preparation behavior", () => {
  it("does not switch runtime merely when selecting a saved conversation", () => {
    const selectConversation = CHAT_SOURCE.match(
      /function selectConversation[\s\S]*?const modeLocked =/,
    )?.[0];

    expect(selectConversation).toBeDefined();
    expect(selectConversation).not.toContain("onSwitchModel");
  });

  it("prepares the requested model before sending chat requests", () => {
    const sendBody = CHAT_SOURCE.match(
      /async function handleSend[\s\S]*?function onStreamChunk/,
    )?.[0];

    expect(sendBody).toBeDefined();
    expect(sendBody).toMatch(
      /await onEnsureModelReady\(requestModel\)[\s\S]*await window\.api\.sendChat/,
    );
  });

  it("prepares the requested model before executing approved plans", () => {
    const executeBody = CHAT_SOURCE.match(
      /async function handleExecutePlan[\s\S]*?const canvasVisible =/,
    )?.[0];

    expect(executeBody).toBeDefined();
    expect(executeBody).toMatch(
      /await onEnsureModelReady\(requestModel\)[\s\S]*await window\.api\.sendChat/,
    );
  });
});
