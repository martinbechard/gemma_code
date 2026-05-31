import { describe, expect, it } from "vitest";
import {
  findCliCleanupTargets,
  parseProcessList,
} from "../../src/cli/processCleanup";

describe("parseProcessList", () => {
  it("parses ps pid, ppid, command output", () => {
    const processes = parseProcessList(`
      10     1 node /repo/node_modules/.bin/tsx src/cli/index.ts code hello
      11    10 /path/python -m mlx_lm server --model model --port 11435
    `);

    expect(processes).toEqual([
      {
        pid: 10,
        ppid: 1,
        command: "node /repo/node_modules/.bin/tsx src/cli/index.ts code hello",
      },
      {
        pid: 11,
        ppid: 10,
        command: "/path/python -m mlx_lm server --model model --port 11435",
      },
    ]);
  });
});

describe("findCliCleanupTargets", () => {
  it("selects CLI roots and descendants", () => {
    const targets = findCliCleanupTargets(
      [
        {
          pid: 10,
          ppid: 1,
          command: "node /repo/node_modules/.bin/tsx src/cli/index.ts code hi",
        },
        {
          pid: 11,
          ppid: 10,
          command: "/path/python -m mlx_lm server --model model --port 11435",
        },
        {
          pid: 12,
          ppid: 11,
          command: "worker child",
        },
      ],
      999,
    );

    expect(targets.map((target) => target.pid)).toEqual([12, 11, 10]);
  });

  it("selects orphan MLX server processes on the CLI port", () => {
    const targets = findCliCleanupTargets(
      [
        {
          pid: 20,
          ppid: 1,
          command: "/path/python -m mlx_lm server --model model --port 11435",
        },
      ],
      999,
    );

    expect(targets.map((target) => target.pid)).toEqual([20]);
  });

  it("does not select the cleanup process itself", () => {
    const targets = findCliCleanupTargets(
      [
        {
          pid: 30,
          ppid: 1,
          command: "node /repo/node_modules/.bin/tsx src/cli/index.ts code hi",
        },
      ],
      30,
    );

    expect(targets).toEqual([]);
  });
});
