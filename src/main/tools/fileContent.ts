export function cleanFileContent(raw: string, path: string): string {
  let content = raw;

  const full = content
    .trim()
    .match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```[\s\S]*$/);
  if (full) {
    content = full[1];
  } else {
    const lead = content.match(/^\s*```[a-zA-Z0-9_-]*\n/);
    if (lead) {
      content = content.slice(lead[0].length);
      const trail = content.search(/\n```(?:\s|$)/);
      if (trail >= 0) content = content.slice(0, trail);
    }
  }

  const lower = path.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    const end = content.toLowerCase().lastIndexOf("</html>");
    if (end >= 0) content = content.slice(0, end + "</html>".length) + "\n";
  } else if (lower.endsWith(".svg")) {
    const end = content.toLowerCase().lastIndexOf("</svg>");
    if (end >= 0) content = content.slice(0, end + "</svg>".length) + "\n";
  } else if (lower.endsWith(".json")) {
    const trimmed = content.trim();
    const lastBrace = Math.max(
      trimmed.lastIndexOf("}"),
      trimmed.lastIndexOf("]"),
    );
    if (lastBrace >= 0) content = trimmed.slice(0, lastBrace + 1) + "\n";
  }

  return content;
}
