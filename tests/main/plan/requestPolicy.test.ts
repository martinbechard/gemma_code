import { describe, expect, it } from "vitest";
import {
  buildReadOnlyRequestToolBlockMessage,
  isFileMutationToolName,
  requestForbidsFileMutation,
} from "../../../src/main/plan/requestPolicy";

describe("request policy", () => {
  it("detects read-only user requests", () => {
    expect(
      requestForbidsFileMutation(
        "Read package.json and report the package name. Do not modify files.",
      ),
    ).toBe(true);
    expect(requestForbidsFileMutation("Inspect files in read-only mode.")).toBe(
      true,
    );
    expect(
      requestForbidsFileMutation("Answer from package.json without modifying files."),
    ).toBe(true);
    expect(requestForbidsFileMutation("Update package.json.")).toBe(false);
  });

  it("identifies file mutation tools", () => {
    expect(isFileMutationToolName("write_file")).toBe(true);
    expect(isFileMutationToolName("edit_file")).toBe(true);
    expect(isFileMutationToolName("read_file")).toBe(false);
  });

  it("builds a retry message for blocked mutation tools", () => {
    const message = buildReadOnlyRequestToolBlockMessage("write_file");

    expect(message).toContain("blocked");
    expect(message).toContain("read-only actions");
    expect(message).toContain("without modifying files");
  });
});
