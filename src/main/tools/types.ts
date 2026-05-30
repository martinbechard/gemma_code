export type PromptMode = "chat" | "code" | "build" | "plan" | "execute";

export interface ProjectInstructionOptions {
  includeCommon?: boolean;
}

export interface ToolContext {
  conversationId: string;
  onFileChange?: () => void;
}

export interface ToolSpec {
  name: string;
  description: string;
  params: Array<{
    name: string;
    description: string;
    required?: boolean;
    multiline?: boolean;
  }>;
  example: string;
  mode: "chat" | "code" | "both";
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}
