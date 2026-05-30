import { describe, expect, it } from "vitest";
import {
  buildPlanInspectionToolBlockMessage,
  buildReadOnlyRequestToolBlockMessage,
  isFileMutationToolName,
  isPlanInspectionToolAction,
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

  it("allows only planning inspection tools during plan assembly", () => {
    expect(isPlanInspectionToolAction("read_file", { path: "Gemma.plan.md" })).toBe(
      true,
    );
    expect(isPlanInspectionToolAction("search_files", { query: "Gemma" })).toBe(
      true,
    );
    expect(isPlanInspectionToolAction("list_files", {})).toBe(true);
    expect(isPlanInspectionToolAction("fetch_url", { url: "https://example.com" })).toBe(
      true,
    );
    expect(isPlanInspectionToolAction("web_search", { query: "docs" })).toBe(
      true,
    );
    expect(isPlanInspectionToolAction("run_bash", { command: "ls src/main" })).toBe(
      true,
    );
    expect(isPlanInspectionToolAction("write_file", { path: "Gemma.plan.md" })).toBe(
      false,
    );
    expect(isPlanInspectionToolAction("run_project_script", { script: "build" })).toBe(
      false,
    );
  });

  it("blocks mutating bash commands during plan assembly", () => {
    expect(isPlanInspectionToolAction("run_bash", { command: "rm -rf dist" })).toBe(
      false,
    );
    expect(
      isPlanInspectionToolAction("run_bash", {
        command: "sed -i '' 's/a/b/' Gemma.plan.md",
      }),
    ).toBe(false);
    expect(
      isPlanInspectionToolAction("run_bash", { command: "git checkout -- Gemma.plan.md" }),
    ).toBe(false);
    expect(isPlanInspectionToolAction("run_bash", { command: "touch new-file" })).toBe(
      false,
    );
  });

  it("builds a retry message for blocked planning tools", () => {
    const message = buildPlanInspectionToolBlockMessage("write_file");

    expect(message).toContain("planning may only inspect");
    expect(message).toContain("read-only inspection action");
    expect(message).toContain("<Step>...</Step>");
    expect(message).toContain("<Question>...</Question>");
  });
});
