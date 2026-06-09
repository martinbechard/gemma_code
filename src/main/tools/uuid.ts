import { randomUUID } from "crypto";
import type { ToolSpec } from "./types";

export function generateUuid(): string {
  return randomUUID();
}

export const generateUuidTool: ToolSpec = {
  name: "generate_uuid",
  description: "Generate a random UUID string.",
  params: [],
  example: '<action name="generate_uuid"></action>',
  mode: "both",
  run: generateUuidResult,
};

async function generateUuidResult(): Promise<string> {
  return generateUuid();
}
