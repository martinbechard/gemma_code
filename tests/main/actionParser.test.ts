import { describe, expect, it } from "vitest";
import { findNextAction } from "../../src/main/tools";

describe("findNextAction", () => {
  it("parses paired no-argument action tags", () => {
    expect(findNextAction('<action name="list_files"></action>')).toMatchObject({
      name: "list_files",
      args: {},
      raw: '<action name="list_files"></action>',
    });
  });

  it("parses self-closing no-argument action tags", () => {
    expect(findNextAction('<action name="list_files"/>')).toMatchObject({
      name: "list_files",
      args: {},
      raw: '<action name="list_files"/>',
    });
    expect(findNextAction("<action name='get_current_datetime' />")).toMatchObject({
      name: "get_current_datetime",
      args: {},
    });
    expect(findNextAction("<action name=list_files />")).toMatchObject({
      name: "list_files",
      args: {},
    });
  });

  it("keeps parsing paired actions with parameters", () => {
    expect(
      findNextAction(
        '<action name="read_file"><path>src/main/tools.ts</path></action>',
      ),
    ).toMatchObject({
      name: "read_file",
      args: { path: "src/main/tools.ts" },
    });
  });

  it("returns incomplete for unclosed paired actions", () => {
    expect(findNextAction('<action name="list_files">')).toBe("incomplete");
  });
});
