import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("write_file streaming", () => {
  it("previews generated content without mutating the workspace before the final tool call", () => {
    const source = readFileSync(
      join(process.cwd(), "src/main/index.ts"),
      "utf8",
    );

    expect(source).toContain('send("file:streaming"');
    expect(source).not.toContain("wsWriteFile(req.conversationId, livePath, cleaned)");
  });
});
