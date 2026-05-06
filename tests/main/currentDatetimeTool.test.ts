import { afterEach, describe, expect, it, vi } from "vitest";
import { chatSystemPrompt, codeSystemPrompt, runTool } from "../../src/main/tools";

const TEST_CONVERSATION_ID = "current-datetime-tool-test";
const FIXED_NOW = new Date("2026-05-06T01:23:45.678Z");

afterEach(() => {
  vi.useRealTimers();
});

describe("get_current_datetime tool", () => {
  it("returns the current app datetime during inference", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);

    const result = await runTool(
      "get_current_datetime",
      {},
      { conversationId: TEST_CONVERSATION_ID },
    );

    expect(result).toContain("ISO: 2026-05-06T01:23:45.678Z");
    expect(result).toContain("Unix milliseconds: 1778030625678");
    expect(result).toContain("Timezone:");
    expect(result).toContain("Local:");
  });

  it("is advertised in chat and code system prompts", () => {
    expect(chatSystemPrompt(true)).toContain("### get_current_datetime");
    expect(codeSystemPrompt("/tmp/workspace", "http://127.0.0.1")).toContain(
      "### get_current_datetime",
    );
  });
});
