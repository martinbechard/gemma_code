import { USER_AGENT } from "./constants";
import { stripTags } from "./webText";
import type { ToolSpec } from "./types";

export const webSearchTool: ToolSpec = {
  name: "web_search",
  description:
    "Search the web via DuckDuckGo. Returns a numbered list of results.",
  params: [
    { name: "query", description: "what to search for", required: true },
  ],
  example:
    '<action name="web_search">\n<query>latest tensorflow release notes</query>\n</action>',
  mode: "both",
  run: webSearch,
};

async function webSearch(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query ?? "").trim();
  if (!query) return "Error: missing query";
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
  });
  if (!res.ok) return `Search failed: ${res.status} ${res.statusText}`;
  const html = await res.text();
  const results = parseDuckDuckGoResults(html).slice(0, 6);
  if (results.length === 0) return "No results found.";
  return results
    .map((result, index) => {
      return `[${index + 1}] ${result.title}\n${result.url}\n${result.snippet}`;
    })
    .join("\n\n");
}

function parseDuckDuckGoResults(
  html: string,
): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const blockRe =
    /<div class="result[^"]*?"[^>]*>([\s\S]*?)<div class="clear"/g;
  const titleRe =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/;

  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html))) {
    const block = match[1];
    const titleMatch = titleRe.exec(block);
    const snippetMatch = snippetRe.exec(block);
    if (!titleMatch) continue;
    const rawUrl = decodeURIComponent(
      titleMatch[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, ""),
    )
      .split("&rut=")[0]
      .split("&amp;")[0];
    const cleanUrl = rawUrl.split("&")[0];
    const title = stripTags(titleMatch[2]).trim();
    const snippet = snippetMatch ? stripTags(snippetMatch[1]).trim() : "";
    if (title && cleanUrl.startsWith("http")) {
      results.push({ title, url: cleanUrl, snippet });
    }
    if (results.length >= 10) break;
  }
  return results;
}
