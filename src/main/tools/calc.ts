import type { ToolSpec } from "./types";

export const calcTool: ToolSpec = {
  name: "calc",
  description: "Evaluate a numeric expression.",
  params: [
    { name: "expression", description: "math expression", required: true },
  ],
  example:
    '<action name="calc">\n<expression>2 + 2 * 3</expression>\n</action>',
  mode: "both",
  run: calc,
};

async function calc(args: Record<string, unknown>): Promise<string> {
  const expr = String(args.expression ?? "").trim();
  if (!expr) return "Error: missing expression";
  if (!/^[0-9+\-*/().\s^%,eE]*$/.test(expr)) {
    return "Error: only numeric expressions allowed";
  }
  try {
    const sanitized = expr.replace(/\^/g, "**");
    const result = Function(`"use strict"; return (${sanitized})`)();
    return String(result);
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}
