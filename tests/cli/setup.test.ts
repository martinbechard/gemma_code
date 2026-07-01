import { describe, expect, it } from "vitest";
import { formatDownloadProgressLine } from "../../src/cli/setup";

describe("formatDownloadProgressLine", () => {
  it("includes percent, transferred bytes, throughput, and ETA", () => {
    expect(
      formatDownloadProgressLine({
        label: "Gemma 3 Text 12B",
        bytesDone: 3_221_225_472,
        bytesTotal: 6_442_450_944,
        startedBytesDone: 1_073_741_824,
        startedAtMs: 1_000,
        nowMs: 121_000,
      }),
    ).toBe(
      "Gemma 3 Text 12B: 50% (3.0 GB / 6.0 GB), 17.1 MB/s, ETA 3m 0s",
    );
  });
});
