export async function* readSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundaryIndex: number;
    while ((boundaryIndex = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, boundaryIndex).trim();
      buffer = buffer.slice(boundaryIndex + 2);
      if (!block) continue;
      yield* readSSEBlock(block);
    }
  }

  if (buffer.trim()) {
    yield* readSSEBlock(buffer.trim());
  }
}

function* readSSEBlock(block: string): Generator<string> {
  for (const line of block.split("\n")) {
    if (line.startsWith("data: ")) {
      const data = line.slice(6).trim();
      if (data) yield data;
    }
  }
}
