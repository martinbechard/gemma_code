import { describe, it, expect } from "vitest";
import { stripPlanArtifacts } from "../../../src/main/plan/stripPlanArtifacts";

describe("stripPlanArtifacts", () => {
  it("returns text unchanged when no plan/verify tags are present", () => {
    expect(stripPlanArtifacts("hello world")).toBe("hello world");
    expect(stripPlanArtifacts("")).toBe("");
  });

  it("removes a single <plan>...</plan> block including inner step bodies", () => {
    const input =
      "intro\n<plan><step name=\"a\"><prompt>do x</prompt><verify>x is done</verify></step></plan>\noutro";
    expect(stripPlanArtifacts(input)).toBe("intro\n\noutro");
  });

  it("removes multiple plan blocks", () => {
    const input =
      "<plan><step name=\"a\"><prompt>p</prompt><verify>v</verify></step></plan>middle<plan><step name=\"b\"><prompt>p2</prompt><verify>v2</verify></step></plan>";
    expect(stripPlanArtifacts(input)).toBe("middle");
  });

  it("removes self-closing <verify .../> tags", () => {
    const input = 'before <verify result="pass"/> after';
    expect(stripPlanArtifacts(input)).toBe("before  after");
  });

  it("removes paired <verify>...</verify> tags outside a plan", () => {
    const input = 'pre <verify result="fail">bad</verify> post';
    expect(stripPlanArtifacts(input)).toBe("pre  post");
  });

  it("collapses runs of blank lines left after stripping", () => {
    const input =
      "line1\n\n<plan><step name=\"a\"><prompt>p</prompt><verify>v</verify></step></plan>\n\nline2";
    expect(stripPlanArtifacts(input)).toBe("line1\n\nline2");
  });

  it("trims leading/trailing whitespace left after stripping", () => {
    const input =
      "<plan><step name=\"a\"><prompt>p</prompt><verify>v</verify></step></plan>";
    expect(stripPlanArtifacts(input)).toBe("");
  });

  it("leaves an unterminated <plan> tag in place (incomplete stream)", () => {
    const input = "narrative <plan><step name=\"a\"><prompt>p";
    expect(stripPlanArtifacts(input)).toBe(input);
  });
});
