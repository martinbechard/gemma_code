import { describe, it, expect } from "vitest";
import { parseVerifyResult } from "../../../src/main/plan/parser";

describe("parseVerifyResult — pass", () => {
  it("returns pass for <verify result=\"pass\">…</verify>", () => {
    expect(parseVerifyResult('<verify result="pass">looks good</verify>')).toEqual({
      result: "pass",
    });
  });

  it("returns pass for self-closing <verify result=\"pass\"/>", () => {
    expect(parseVerifyResult('<verify result="pass"/>')).toEqual({
      result: "pass",
    });
  });

  it("ignores text before and after the verify tag", () => {
    const text = "Looking at the result, it matches.\n<verify result=\"pass\"/>\nDone.";
    expect(parseVerifyResult(text)).toEqual({ result: "pass" });
  });

  it("tolerates attribute quote variations", () => {
    expect(parseVerifyResult("<verify result='pass'/>")).toEqual({ result: "pass" });
    expect(parseVerifyResult("<verify result=pass/>")).toEqual({ result: "pass" });
    expect(parseVerifyResult('<verify  result = "pass" />')).toEqual({ result: "pass" });
  });
});

describe("parseVerifyResult — fail", () => {
  it("captures reason from the attribute", () => {
    const text = '<verify result="fail" reason="missing agent.ts in listing"/>';
    expect(parseVerifyResult(text)).toEqual({
      result: "fail",
      reason: "missing agent.ts in listing",
    });
  });

  it("captures reason from the element body when no reason attribute", () => {
    const text = '<verify result="fail">file list did not include agent.ts</verify>';
    expect(parseVerifyResult(text)).toEqual({
      result: "fail",
      reason: "file list did not include agent.ts",
    });
  });

  it("prefers reason attribute over body when both present", () => {
    const text = '<verify result="fail" reason="attr wins">body text</verify>';
    expect(parseVerifyResult(text)).toEqual({
      result: "fail",
      reason: "attr wins",
    });
  });

  it("returns fail with empty reason when neither attr nor body provide one", () => {
    expect(parseVerifyResult('<verify result="fail"/>')).toEqual({
      result: "fail",
      reason: "",
    });
  });

  it("trims whitespace from body reason", () => {
    const text = '<verify result="fail">\n  the file is empty\n</verify>';
    expect(parseVerifyResult(text)).toEqual({
      result: "fail",
      reason: "the file is empty",
    });
  });
});

describe("parseVerifyResult — null cases", () => {
  it("returns null when no <verify ...> tag is present", () => {
    expect(parseVerifyResult("just some text")).toBeNull();
    expect(parseVerifyResult("")).toBeNull();
  });

  it("returns null when the result attribute is missing", () => {
    expect(parseVerifyResult("<verify>something</verify>")).toBeNull();
  });

  it("returns null for unknown result values", () => {
    expect(parseVerifyResult('<verify result="maybe"/>')).toBeNull();
    expect(parseVerifyResult('<verify result=""/>')).toBeNull();
  });
});
