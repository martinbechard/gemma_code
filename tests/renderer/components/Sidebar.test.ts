import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Sidebar, {
  conversationModeLabel,
  conversationSidebarTitle,
} from "../../../src/renderer/src/components/Sidebar";
import type { ModelInfo } from "../../../src/shared/types";

const TEST_MODELS: ModelInfo[] = [
  {
    name: "mlx-community/gemma-4-e4b-it-4bit",
    label: "Gemma 4 E4B",
    size: "5.2 GB",
    sizeBytes: 5_216_992_212,
    description: "Local model.",
    runtime: "mlx-lm",
  },
];

describe("conversationSidebarTitle", () => {
  it("prefixes stamped conversations with the display model label", () => {
    expect(
      conversationSidebarTitle(
        {
          id: "c1",
          title: "plan to build a CLI runner",
          createdAt: 1,
          mode: "code",
          model: "mlx-community/gemma-4-e4b-it-4bit",
        },
        TEST_MODELS,
      ),
    ).toBe("[Gemma 4 E4B] plan to build a CLI runner");
  });
});

describe("conversationModeLabel", () => {
  it("distinguishes chat, build, and code conversations", () => {
    expect(
      conversationModeLabel({
        id: "chat",
        title: "Chat",
        createdAt: 1,
        mode: "chat",
      }),
    ).toBe("Chat");
    expect(
      conversationModeLabel({
        id: "build",
        title: "Build",
        createdAt: 1,
        mode: "code",
      }),
    ).toBe("Build");
    expect(
      conversationModeLabel({
        id: "code",
        title: "Code",
        createdAt: 1,
        mode: "code",
        workingDir: "/tmp/project",
      }),
    ).toBe("Code");
  });
});

describe("Sidebar", () => {
  it("renders model-prefixed titles and mode metadata", () => {
    const html = renderToStaticMarkup(
      createElement(Sidebar, {
        conversations: [
          {
            id: "c1",
            title: "plan to build a CLI runner",
            createdAt: 1,
            mode: "code",
            model: "mlx-community/gemma-4-e4b-it-4bit",
          },
        ],
        models: TEST_MODELS,
        activeId: "c1",
        onSelect: () => undefined,
        onNew: () => undefined,
        onDelete: () => undefined,
      }),
    );

    expect(html).toContain("[Gemma 4 E4B] plan to build a CLI runner");
    expect(html).toContain("Build");
  });
});
