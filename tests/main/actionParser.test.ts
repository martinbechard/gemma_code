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

  it("ignores action tags quoted inside markdown code fences", () => {
    const response = [
      "Previous action:",
      "```xml",
      '<action name="edit_file">',
      "<path>src/main/tools/index.ts</path>",
      "</action>",
      "```",
      '<action name="read_file">',
      "<path>src/main/tools/index.ts</path>",
      "</action>",
    ].join("\n");

    expect(findNextAction(response)).toMatchObject({
      name: "read_file",
      args: { path: "src/main/tools/index.ts" },
    });
  });

  it("ignores action tags inside thinking blocks", () => {
    const response = [
      "<think>",
      'Maybe I should emit <action name="read_file"><path>old.ts</path></action> first.',
      "</think>",
      '<action name="read_file">',
      "<path>src/main/tools/index.ts</path>",
      "</action>",
    ].join("\n");

    expect(findNextAction(response)).toMatchObject({
      name: "read_file",
      args: { path: "src/main/tools/index.ts" },
    });
  });

  it("does not treat incomplete actions inside thinking blocks as incomplete", () => {
    const response = [
      "<think>",
      'Maybe <action name="read_file">',
      "</think>",
      "No tool yet.",
    ].join("\n");

    expect(findNextAction(response)).toBeNull();
  });

  it("keeps action examples inside old_string from closing the outer action", () => {
    const action = [
      '<action name="edit_file">',
      "<path>src/main/tools/getCurrentWorkingDirectory.ts</path>",
      "<old_string>",
      "example: '<action name=\"get_current_working_directory\"></action>',",
      "</old_string>",
      "<new_string></new_string>",
      "</action>",
    ].join("\n");

    expect(findNextAction(action)).toMatchObject({
      name: "edit_file",
      args: {
        path: "src/main/tools/getCurrentWorkingDirectory.ts",
        old_string:
          'example: \'<action name="get_current_working_directory"></action>\',',
        new_string: "",
      },
    });
  });

  it("recovers write_file content when the action closes before content", () => {
    const action = [
      '<action name="write_file">',
      "<path>src/main/tools/git.ts</path>",
      "<content>",
      'const example = \'<action name="git_command">\\n<command>status</command>\\n</action>\';',
      "export const value = 1;",
      "</action>",
    ].join("\n");

    expect(findNextAction(action)).toMatchObject({
      name: "write_file",
      args: {
        path: "src/main/tools/git.ts",
        content: [
          'const example = \'<action name="git_command">\\n<command>status</command>\\n</action>\';',
          "export const value = 1;",
        ].join("\n"),
      },
    });
  });

  it("does not recover write_file content at an embedded action example", () => {
    const action = [
      '<action name="write_file">',
      "<path>src/main/tools/git.ts</path>",
      "<content>",
      'export const example = \'<action name="git_command">\\n<command>status</command>\\n</action>\',',
    ].join("\n");

    expect(findNextAction(action)).toBe("incomplete");
  });

  it("recovers run_bash command when the action closes before command", () => {
    const action = [
      '<action name="run_bash">',
      "<command>npm test -- tests/main/actionParser.test.ts",
      "</action>",
    ].join("\n");

    expect(findNextAction(action)).toMatchObject({
      name: "run_bash",
      args: {
        command: "npm test -- tests/main/actionParser.test.ts",
      },
    });
  });
});
