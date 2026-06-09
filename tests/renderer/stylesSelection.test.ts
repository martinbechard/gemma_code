import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = join(process.cwd(), "src/renderer/src/styles.css");

describe("renderer text selection styles", () => {
  it("does not disable text selection globally", () => {
    const css = readFileSync(STYLES_PATH, "utf8");
    const bodyRule = css.match(/body\s*\{[\s\S]*?\}/)?.[0] ?? "";

    expect(bodyRule).not.toContain("user-select: none");
  });

  it("keeps draggable chrome non-selectable", () => {
    const css = readFileSync(STYLES_PATH, "utf8");
    const dragRule = css.match(/\.drag\s*\{[\s\S]*?\}/)?.[0] ?? "";

    expect(dragRule).toContain("-webkit-app-region: drag");
    expect(dragRule).toContain("user-select: none");
  });
});
