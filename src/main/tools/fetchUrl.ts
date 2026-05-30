import { USER_AGENT } from "./constants";
import { htmlToText } from "./webText";
import type { ToolSpec } from "./types";

const FETCH_TEXT_MAX_CHARS = 8_000;

export const fetchUrlTool: ToolSpec = {
  name: "fetch_url",
  description:
    "Fetch a web page and return its text content (truncated to ~8KB).",
  params: [
    { name: "url", description: "absolute http(s) URL", required: true },
  ],
  example:
    '<action name="fetch_url">\n<url>https://example.com</url>\n</action>',
  mode: "both",
  run: fetchUrl,
};

async function fetchUrl(args: Record<string, unknown>): Promise<string> {
  const url = String(args.url ?? "").trim();
  if (!url) return "Error: missing url";
  if (!/^https?:\/\//.test(url)) return "Error: url must be http(s)";
  try {
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
    if (!res.ok) return `Fetch failed: ${res.status} ${res.statusText}`;
    const contentType = res.headers.get("content-type") || "";
    const text = await res.text();
    if (contentType.includes("html")) {
      return htmlToText(text).slice(0, FETCH_TEXT_MAX_CHARS);
    }
    return text.slice(0, FETCH_TEXT_MAX_CHARS);
  } catch (error) {
    return `Error fetching: ${(error as Error).message}`;
  }
}
