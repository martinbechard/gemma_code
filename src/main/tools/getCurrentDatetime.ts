import { timezone } from "./time";
import type { ToolSpec } from "./types";

export const getCurrentDatetimeTool: ToolSpec = {
  name: "get_current_datetime",
  description:
    "Return the current app date and time during inference, including ISO, local time, Unix milliseconds, and timezone.",
  params: [],
  example: '<action name="get_current_datetime"></action>',
  mode: "both",
  run: getCurrentDatetime,
};

async function getCurrentDatetime(
  _args: Record<string, unknown>,
): Promise<string> {
  const now = new Date();
  return [
    `ISO: ${now.toISOString()}`,
    `Unix milliseconds: ${now.getTime()}`,
    `Timezone: ${timezone()}`,
    `Local: ${now.toLocaleString("en-US", {
      dateStyle: "full",
      timeStyle: "long",
    })}`,
  ].join("\n");
}
