import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { COMMON_INSTRUCTIONS_FILE } from "./constants";
import { appRootDir, isPackaged } from "../runtimePaths";
import type { ProjectInstructionOptions, PromptMode } from "./types";

function readInstructionsFile(filename: string): string | null {
  const candidates = isPackaged()
    ? [join(process.resourcesPath, filename)]
    : [join(appRootDir(), filename)];
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const text = readFileSync(path, "utf-8").trim();
        return text.length > 0 ? text : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function loadProjectInstructions(
  mode?: PromptMode | PromptMode[],
  opts: ProjectInstructionOptions = {},
): string | null {
  const includeCommon = opts.includeCommon ?? true;
  const common = readInstructionsFile(COMMON_INSTRUCTIONS_FILE);
  const modes = Array.isArray(mode) ? mode : mode ? [mode] : [];
  const parts: string[] = [];
  if (includeCommon && common) parts.push(common);
  for (const currentMode of modes) {
    const modeFile = readInstructionsFile(`Gemma.${currentMode}.md`);
    if (modeFile) parts.push(modeFile);
  }
  if (parts.length === 0) return null;
  return parts.join("\n\n");
}
