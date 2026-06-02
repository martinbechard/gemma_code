import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AVAILABLE_MODELS,
  type AgentMode,
  type ChatMessage,
  type CodeSubmode,
  type ExecutionLogEntry,
  type ExecutionLogSnapshot,
  type ToolCall,
  type StreamChunk,
} from "@shared/types";
import gemmaLogoUrl from "../assets/gemma-logo.png";
import Composer from "./Composer";
import Message from "./Message";
import Sidebar from "./Sidebar";
import Canvas from "./Canvas";
import {
  LAST_WORKING_DIR_STORAGE_KEY,
  STORAGE_KEY,
  buildMessageRenderItems,
  hasSystemPromptSnapshot,
  isClearCommand,
  isModeLocked,
  pickLastWorkingDir,
  rewindToUserRequest,
  shouldSendConversationMessage,
} from "../lib/conversationStore";

interface Props {
  model: string;
  onSwitchModel: (model: string) => void;
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  mode: AgentMode;
  canvasOpen?: boolean;
  // Distinguishes "Code" (user-chosen working directory) from "Build"
  // (per-conversation sandbox) within mode==='code'. Undefined => sandbox.
  workingDir?: string;
  // The model this conversation was last sent with. Stamped on every send so
  // the app can auto-load the right runtime when the conversation is reopened
  // and so switching conversations swaps the active model accordingly.
  model?: string;
  codeSubmode?: CodeSubmode;
}

// "Build" and "Code" both map to AgentMode==='code' on the wire; the pill key
// is the UI-level discriminant the renderer carries around.
type PillKey = "chat" | "build" | "code";
const DEFAULT_CODE_SUBMODE: CodeSubmode = "auto";
const EXECUTION_LOGGING_STORAGE_KEY = "gemma-code:execution-logging";
const THINKING_ENABLED_STORAGE_KEY = "gemma-code:thinking-enabled";
const LOG_VIEWER_REFRESH_MS = 2_000;
const LOG_DETAIL_PREVIEW_MAX_CHARS = 220;
const FILE_CONTEXT_TOOL_NAMES = new Set([
  "read_file",
  "edit_file",
  "write_file",
]);
const FILE_CONTEXT_HEADING = "Files in context:";
const CURRENT_FILE_LINE_PREFIX = "Current file:";
const TOOL_RESULT_ERROR_RE =
  /^(Error\b|Error reading|Error editing|Error writing|Error deleting|Error fetching)/i;

function pillKeyOf(c: Pick<Conversation, "mode" | "workingDir">): PillKey {
  if (c.mode === "chat") return "chat";
  return c.workingDir ? "code" : "build";
}

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Conversation[];
    return arr.map((c) => ({ ...c, mode: c.mode ?? "code" }));
  } catch {
    return [];
  }
}

function saveConversations(cs: Conversation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cs));
  } catch {
    // ignore
  }
}

function loadLastWorkingDir(): string | null {
  try {
    const path = localStorage.getItem(LAST_WORKING_DIR_STORAGE_KEY);
    return path && path.trim().length > 0 ? path : null;
  } catch {
    return null;
  }
}

function saveLastWorkingDir(path: string): void {
  try {
    localStorage.setItem(LAST_WORKING_DIR_STORAGE_KEY, path);
  } catch {
    // ignore
  }
}

function newConversation(
  mode: AgentMode = "code",
  workingDir?: string,
  codeSubmode?: CodeSubmode,
): Conversation {
  return {
    id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: "New chat",
    messages: [],
    createdAt: Date.now(),
    mode,
    canvasOpen: mode === "code",
    workingDir,
    codeSubmode: workingDir ? (codeSubmode ?? DEFAULT_CODE_SUBMODE) : undefined,
  };
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Last path segment, used to render a compact label for the working directory.
function dirBasename(p: string): string {
  const s = p.replace(/[/\\]+$/, "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i >= 0 ? s.slice(i + 1) : s;
}

function codeSubmodeOf(c: Conversation): CodeSubmode {
  return c.workingDir
    ? (c.codeSubmode ?? DEFAULT_CODE_SUBMODE)
    : DEFAULT_CODE_SUBMODE;
}

function requestHistory(messages: ChatMessage[]): Array<{
  role: Exclude<ChatMessage["role"], "harness"> | "user";
  content: string;
  toolCalls?: ToolCall[];
}> {
  return messages
    .filter(shouldSendConversationMessage)
    .map((m) => ({
      role: m.role as Exclude<ChatMessage["role"], "harness"> | "user",
      content: m.content,
      toolCalls: m.toolCalls,
    }));
}

function collectFilesInContext(messages: ChatMessage[]): string[] {
  const paths = new Set<string>();
  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      if (!isSuccessfulFileContextToolCall(toolCall)) continue;
      for (const path of fileContextPathsFromResult(toolCall.result ?? "")) {
        paths.add(path);
      }
      const path = fileContextPathFromArgs(toolCall.args);
      if (path) paths.add(path);
    }
  }
  return [...paths];
}

function isSuccessfulFileContextToolCall(toolCall: ToolCall): boolean {
  if (!FILE_CONTEXT_TOOL_NAMES.has(toolCall.name)) return false;
  if (toolCall.error) return false;
  if (typeof toolCall.result !== "string") return false;
  return !TOOL_RESULT_ERROR_RE.test(toolCall.result.trimStart());
}

function fileContextPathFromArgs(args: Record<string, unknown>): string | null {
  const path = args.path;
  if (typeof path !== "string") return null;
  const trimmed = path.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function fileContextPathsFromResult(result: string): string[] {
  const paths: string[] = [];
  let inFilesList = false;
  for (const line of result.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === FILE_CONTEXT_HEADING) {
      inFilesList = true;
      continue;
    }
    if (inFilesList) {
      if (!trimmed) {
        inFilesList = false;
        continue;
      }
      if (trimmed.startsWith("- ")) {
        paths.push(trimmed.slice(2).trim());
        continue;
      }
      inFilesList = false;
    }
    if (trimmed.startsWith(CURRENT_FILE_LINE_PREFIX)) {
      paths.push(trimmed.slice(CURRENT_FILE_LINE_PREFIX.length).trim());
    }
  }
  return paths.filter((path) => path.length > 0);
}

export default function Chat({ model, onSwitchModel }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const loaded = loadConversations();
    return loaded.length ? loaded : [newConversation()];
  });
  const [activeId, setActiveId] = useState<string>(() => conversations[0].id);
  const [streaming, setStreaming] = useState(false);
  const [executionLogging, setExecutionLogging] = useState<boolean>(() => {
    try {
      return localStorage.getItem(EXECUTION_LOGGING_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [thinkingEnabled, setThinkingEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(THINKING_ENABLED_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [executionLogPath, setExecutionLogPath] = useState("");
  const [executionLogViewerError, setExecutionLogViewerError] = useState("");
  const [logViewerOpen, setLogViewerOpen] = useState(false);
  const [logViewerAutoScroll, setLogViewerAutoScroll] = useState(true);
  const [executionLogSnapshot, setExecutionLogSnapshot] =
    useState<ExecutionLogSnapshot | null>(null);
  const [lastWorkingDir, setLastWorkingDir] = useState<string | null>(
    () => loadLastWorkingDir() ?? pickLastWorkingDir(conversations),
  );
  const logViewerEndRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<{ abort: boolean }>({ abort: false });

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? conversations[0],
    [conversations, activeId],
  );

  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    try {
      localStorage.setItem(
        EXECUTION_LOGGING_STORAGE_KEY,
        executionLogging ? "true" : "false",
      );
    } catch {
      // ignore
    }
  }, [executionLogging]);

  useEffect(() => {
    try {
      localStorage.setItem(
        THINKING_ENABLED_STORAGE_KEY,
        thinkingEnabled ? "true" : "false",
      );
    } catch {
      // ignore
    }
  }, [thinkingEnabled]);

  useEffect(() => {
    window.api
      .executionLogPath()
      .then(setExecutionLogPath)
      .catch(() => setExecutionLogPath(""));
  }, []);

  const loadExecutionLog = useCallback(async (): Promise<void> => {
    setExecutionLogViewerError("");
    try {
      const snapshot = await window.api.readExecutionLog();
      setExecutionLogSnapshot(snapshot);
      setExecutionLogPath(snapshot.path);
    } catch (error) {
      setExecutionLogViewerError(
        error instanceof Error ? error.message : "Could not read execution log.",
      );
    }
  }, []);

  const handleOpenExecutionLog = useCallback(async (): Promise<void> => {
    setLogViewerOpen(true);
    await loadExecutionLog();
  }, [loadExecutionLog]);

  useEffect(() => {
    if (!logViewerOpen) return;
    void loadExecutionLog();
    const refresh = window.setInterval(() => {
      void loadExecutionLog();
    }, LOG_VIEWER_REFRESH_MS);
    return () => window.clearInterval(refresh);
  }, [loadExecutionLog, logViewerOpen]);

  useEffect(() => {
    if (!logViewerOpen || !logViewerAutoScroll) return;
    logViewerEndRef.current?.scrollIntoView({ block: "end" });
  }, [
    executionLogSnapshot?.entries.length,
    logViewerAutoScroll,
    logViewerOpen,
  ]);

  function updateActive(fn: (c: Conversation) => Conversation): void {
    setConversations((cs) => cs.map((c) => (c.id === activeId ? fn(c) : c)));
  }

  function createConversation(
    mode: AgentMode = "code",
    workingDir?: string,
    codeSubmode?: CodeSubmode,
  ): void {
    const c = newConversation(mode, workingDir, codeSubmode);
    setConversations((cs) => [c, ...cs]);
    setActiveId(c.id);
  }

  function rememberWorkingDir(path: string): void {
    setLastWorkingDir(path);
    saveLastWorkingDir(path);
  }

  function deleteConversation(id: string): void {
    setConversations((cs) => {
      const filtered = cs.filter((c) => c.id !== id);
      if (filtered.length === 0) {
        const nc = newConversation();
        setActiveId(nc.id);
        return [nc];
      }
      if (id === activeId) setActiveId(filtered[0].id);
      return filtered;
    });
  }

  // Three-way pill selector. "code" reuses the conversation or remembered
  // working directory. The folder picker only opens from Change folder.
  // Once a Code conversation has at least one message (isModeLocked), the
  // chat / build branches no-op so the agent can't be swapped onto a
  // different sandbox underneath an in-flight Code session.
  async function selectMode(
    next: PillKey,
    options: { chooseFolder?: boolean } = {},
  ): Promise<void> {
    const locked = isModeLocked(activeConversation);
    if (next === "chat") {
      if (locked) return;
      updateActive((c) => ({ ...c, mode: "chat", canvasOpen: false }));
      return;
    }
    if (next === "build") {
      if (locked) return;
      updateActive((c) => ({
        ...c,
        mode: "code",
        workingDir: undefined,
        canvasOpen: true,
      }));
      return;
    }
    const reusablePath = activeConversation.workingDir ?? lastWorkingDir;
    if (reusablePath && !options.chooseFolder) {
      updateActive((c) => ({
        ...c,
        mode: "code",
        workingDir: reusablePath,
        canvasOpen: true,
        codeSubmode: c.codeSubmode ?? DEFAULT_CODE_SUBMODE,
      }));
      rememberWorkingDir(reusablePath);
      return;
    }

    const path = await window.api.chooseDirectory(reusablePath ?? undefined);
    if (!path) return;
    rememberWorkingDir(path);
    updateActive((c) => ({
      ...c,
      mode: "code",
      workingDir: path,
      canvasOpen: true,
      codeSubmode: c.codeSubmode ?? DEFAULT_CODE_SUBMODE,
    }));
  }

  function selectCodeSubmode(next: CodeSubmode): void {
    if (activeConversation.workingDir) {
      updateActive((c) => ({ ...c, codeSubmode: next }));
    }
  }

  function toggleCanvas(): void {
    updateActive((c) => ({ ...c, canvasOpen: !c.canvasOpen }));
  }

  function clearActiveConversation(): void {
    updateActive((c) => ({
      ...c,
      title: "New chat",
      messages: [],
      model,
    }));
  }

  // Keep the main-process workspace override in sync with the active
  // conversation so workspace:info / list / open-external resolve to the
  // user-chosen directory in Code mode and to the sandbox otherwise.
  useEffect(() => {
    if (activeConversation.workingDir) {
      window.api
        .setWorkspaceOverride(activeId, activeConversation.workingDir)
        .catch(() => {
          /* non-fatal */
        });
    } else {
      window.api.clearWorkspaceOverride(activeId).catch(() => {
        /* non-fatal */
      });
    }
  }, [activeId, activeConversation.workingDir]);

  async function handleSend(
    input: string,
    priorMessagesOverride?: ChatMessage[],
  ): Promise<void> {
    if (!input.trim() || streaming) return;
    if (!priorMessagesOverride && isClearCommand(input)) {
      clearActiveConversation();
      return;
    }

    const conv = conversations.find((c) => c.id === activeId)!;
    const priorMessages = priorMessagesOverride ?? conv.messages;
    const codeSubmode = codeSubmodeOf(conv);
    const phase =
      conv.workingDir && (codeSubmode === "plan" || codeSubmode === "auto")
        ? "planning"
        : undefined;

    const userMsg: ChatMessage = {
      id: newId("m"),
      role: "user",
      content: input,
      createdAt: Date.now(),
      phase,
    };
    const assistantMsg: ChatMessage = {
      id: newId("m"),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      model,
      toolCalls: [],
      activity: { kind: "thinking" },
      phase,
    };

    updateActive((c) => {
      const title =
        !priorMessages.some((m) => m.role === "user")
          ? input.slice(0, 48) + (input.length > 48 ? "…" : "")
          : c.title;
      // Stamp the current global model on the conversation so it can be
      // auto-loaded next time the conversation is opened.
      return {
        ...c,
        title,
        model,
        messages: [...priorMessages, userMsg, assistantMsg],
      };
    });

    const history = requestHistory([...priorMessages, userMsg]);

    setStreaming(true);
    streamRef.current.abort = false;

    try {
      await window.api.sendChat(
        {
          conversationId: activeId,
          messages: history,
          model,
          enableTools: true,
          mode: conv.mode,
          workingDir: conv.workingDir,
          codeSubmode: conv.workingDir ? codeSubmode : undefined,
          debugLogging: executionLogging,
          enableThinking: thinkingEnabled,
        },
        (chunk: StreamChunk) => onStreamChunk(activeId, chunk),
      );
    } finally {
      setStreaming(false);
    }
  }

  function onStreamChunk(targetId: string, chunk: StreamChunk): void {
    if (streamRef.current.abort) return;
    setConversations((cs) =>
      cs.map((c) => {
        if (c.id !== targetId) return c;
        const msgs = [...c.messages];
        const last = msgs[msgs.length - 1];
        if (!last || last.role !== "assistant") return c;
        if (chunk.type === "token") {
          msgs[msgs.length - 1] = {
            ...last,
            content: last.content + chunk.text,
          };
        } else if (chunk.type === "system_prompt") {
          const snapshot = { label: chunk.label, content: chunk.content };
          if (hasSystemPromptSnapshot(msgs, snapshot)) return c;
          msgs[msgs.length - 1] = {
            ...last,
            systemPrompts: [...(last.systemPrompts ?? []), snapshot],
          };
        } else if (chunk.type === "tool_call") {
          const tc: ToolCall = { ...chunk.call, running: true };
          msgs[msgs.length - 1] = {
            ...last,
            toolCalls: [...(last.toolCalls ?? []), tc],
          };
        } else if (chunk.type === "tool_result") {
          const tcs = (last.toolCalls ?? []).map((t) =>
            t.id === chunk.id
              ? {
                  ...t,
                  running: false,
                  result: chunk.result,
                  error: chunk.error,
                }
              : t,
          );
          msgs[msgs.length - 1] = { ...last, toolCalls: tcs };
        } else if (chunk.type === "plan_node_start") {
          const nodes = [...(last.planNodes ?? [])];
          nodes.push({
            id: chunk.id,
            kind: chunk.kind,
            parentId: chunk.parentId,
            name: chunk.name,
            status: "running",
            prompt: chunk.prompt,
            criterion: chunk.criterion,
          });
          msgs[msgs.length - 1] = { ...last, planNodes: nodes };
        } else if (chunk.type === "plan_node_end") {
          const nodes = (last.planNodes ?? []).map((n) =>
            n.id === chunk.id
              ? {
                  ...n,
                  status: chunk.status,
                  ...(chunk.reason ? { reason: chunk.reason } : {}),
                }
              : n,
          );
          msgs[msgs.length - 1] = { ...last, planNodes: nodes };
        } else if (chunk.type === "set_assistant_content") {
          msgs[msgs.length - 1] = { ...last, content: chunk.text };
        } else if (chunk.type === "harness_message") {
          const harnessMsg: ChatMessage = {
            id: newId("m"),
            role: "harness",
            content: chunk.content,
            createdAt: Date.now(),
            model,
            phase: chunk.phase,
            harnessLabel: chunk.label,
          };
          const nextAssistantMsg: ChatMessage = {
            id: newId("m"),
            role: "assistant",
            content: "",
            createdAt: Date.now(),
            model,
            toolCalls: [],
            activity: { kind: "thinking" },
            phase: chunk.phase,
          };
          msgs.push(harnessMsg, nextAssistantMsg);
        } else if (chunk.type === "plan_proposed") {
          msgs[msgs.length - 1] = {
            ...last,
            proposedPlan: chunk.steps,
          };
        } else if (chunk.type === "plan_reviewed") {
          msgs[msgs.length - 1] = {
            ...last,
            planReview: chunk.review,
          };
        } else if (chunk.type === "activity") {
          msgs[msgs.length - 1] = { ...last, activity: chunk.activity };
        } else if (chunk.type === "done") {
          msgs[msgs.length - 1] = {
            ...last,
            done: true,
            activity: { kind: "idle" },
          };
        } else if (chunk.type === "error") {
          msgs[msgs.length - 1] = {
            ...last,
            done: true,
            activity: { kind: "idle" },
            content:
              last.content + (last.content ? "\n\n" : "") + `⚠️ ${chunk.error}`,
          };
        }
        return { ...c, messages: msgs };
      }),
    );
  }

  async function handleStop(): Promise<void> {
    streamRef.current.abort = true;
    await window.api.abortChat(activeId);
    setStreaming(false);
  }

  async function handleRegenerateFromMessage(messageId: string): Promise<void> {
    if (streaming) return;
    const conv = conversations.find((c) => c.id === activeId);
    if (!conv) return;
    const rewind = rewindToUserRequest(conv.messages, messageId);
    if (!rewind) return;
    await handleSend(rewind.request.content, rewind.priorMessages);
  }

  async function handleExecutePlan(messageId: string): Promise<void> {
    if (streaming) return;
    const conv = conversations.find((c) => c.id === activeId);
    if (!conv) return;
    const proposalMsg = conv.messages.find((m) => m.id === messageId);
    if (!proposalMsg || !proposalMsg.proposedPlan) return;

    const assistantMsg: ChatMessage = {
      id: newId("m"),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      model,
      toolCalls: [],
      activity: { kind: "thinking" },
      phase: "execution",
    };

    updateActive((c) => ({
      ...c,
      messages: [
        ...c.messages.map((m) =>
          m.id === messageId ? { ...m, planExecuted: true } : m,
        ),
        assistantMsg,
      ],
    }));

    const history = requestHistory(conv.messages);

    setStreaming(true);
    streamRef.current.abort = false;

    try {
      await window.api.sendChat(
        {
          conversationId: activeId,
          messages: history,
          model,
          enableTools: true,
          mode: conv.mode,
          workingDir: conv.workingDir,
          codeSubmode: conv.workingDir ? codeSubmodeOf(conv) : undefined,
          executePlan: true,
          executePlanSteps: proposalMsg.proposedPlan,
          debugLogging: executionLogging,
          enableThinking: thinkingEnabled,
        },
        (chunk: StreamChunk) => onStreamChunk(activeId, chunk),
      );
    } finally {
      setStreaming(false);
    }
  }

  const canvasVisible =
    (activeConversation.mode === "code" ||
      activeConversation.canvasOpen === true) &&
    activeConversation.canvasOpen !== false;

  // When the user clicks a different conversation, swap to that conversation's
  // stamped model if it differs from the current one. Conversations without a
  // stamped model inherit the current global model on their next send.
  function selectConversation(nextId: string): void {
    setActiveId(nextId);
    const next = conversations.find((c) => c.id === nextId);
    if (next?.model && next.model !== model) {
      onSwitchModel(next.model);
    }
  }

  const modeLocked = isModeLocked(activeConversation);
  const filesInContext = useMemo(
    () => collectFilesInContext(activeConversation.messages),
    [activeConversation.messages],
  );

  return (
    <div className="flex h-full w-full">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={selectConversation}
        onNew={() =>
          createConversation(
            activeConversation.mode,
            activeConversation.workingDir,
            activeConversation.codeSubmode,
          )
        }
        onDelete={deleteConversation}
      />
      <div className="flex min-w-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            model={model}
            pillKey={pillKeyOf(activeConversation)}
            workingDir={activeConversation.workingDir}
            codeSubmode={codeSubmodeOf(activeConversation)}
            canvasOpen={!!activeConversation.canvasOpen}
            modeLocked={modeLocked}
            onSelectMode={selectMode}
            onChangeWorkingDir={() =>
              selectMode("code", { chooseFolder: true })
            }
            onSelectCodeSubmode={selectCodeSubmode}
            onToggleCanvas={toggleCanvas}
            onSwitchModel={onSwitchModel}
            executionLogging={executionLogging}
            executionLogPath={executionLogPath}
            executionLogOpenError={executionLogViewerError}
            thinkingEnabled={thinkingEnabled}
            onToggleExecutionLogging={() =>
              setExecutionLogging((current) => !current)
            }
            onToggleThinking={() => setThinkingEnabled((current) => !current)}
            onOpenExecutionLog={handleOpenExecutionLog}
          />
          {(activeConversation.mode === "code" || filesInContext.length > 0) && (
            <FileContextZone paths={filesInContext} />
          )}
          <MessageList
            messages={activeConversation.messages}
            streaming={streaming}
            mode={activeConversation.mode}
            codeSubmode={codeSubmodeOf(activeConversation)}
            onRegenerateMessage={handleRegenerateFromMessage}
            onExecutePlan={handleExecutePlan}
          />
          <Composer
            onSend={handleSend}
            onStop={handleStop}
            streaming={streaming}
            disabled={false}
            model={model}
            placeholder={
              activeConversation.mode === "code"
                ? "Describe what to build — a webpage, component, or script…"
                : "Message Gemma…"
            }
          />
        </div>
        {canvasVisible && (
          <ResizableCanvas
            conversationId={activeId}
            streaming={streaming}
            onClose={() => updateActive((c) => ({ ...c, canvasOpen: false }))}
          />
        )}
      </div>
      {logViewerOpen && (
        <ExecutionLogViewer
          snapshot={executionLogSnapshot}
          error={executionLogViewerError}
          autoScroll={logViewerAutoScroll}
          onAutoScrollChange={setLogViewerAutoScroll}
          onRefresh={loadExecutionLog}
          onClose={() => setLogViewerOpen(false)}
          endRef={logViewerEndRef}
        />
      )}
    </div>
  );
}

function ResizableCanvas({
  conversationId,
  streaming,
  onClose,
}: {
  conversationId: string;
  streaming: boolean;
  onClose: () => void;
}) {
  const [width, setWidth] = useState(520);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startW.current = width;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [width],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = startX.current - e.clientX;
    const next = Math.max(320, Math.min(startW.current + delta, 900));
    setWidth(next);
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div className="anim-slide-right relative shrink-0" style={{ width }}>
      {/* Drag handle */}
      <div
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize select-none transition-colors hover:bg-white/10 active:bg-white/20"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ touchAction: "none" }}
      />
      <Canvas
        conversationId={conversationId}
        streaming={streaming}
        onClose={onClose}
      />
    </div>
  );
}

function FileContextZone({ paths }: { paths: string[] }) {
  return (
    <div className="border-b border-white/[0.06] bg-black/[0.12] px-4 py-2">
      <div className="mx-auto flex max-w-3xl items-start gap-3">
        <div className="shrink-0 pt-1 text-[11px] font-medium uppercase tracking-wide text-ink-500">
          Files in context
        </div>
        {paths.length === 0 ? (
          <div className="min-w-0 flex-1 rounded-md border border-dashed border-white/[0.08] px-2.5 py-1 text-[11.5px] text-ink-500">
            No files read yet.
          </div>
        ) : (
          <div className="flex max-h-24 min-w-0 flex-1 flex-wrap gap-1.5 overflow-y-auto">
            {paths.map((path) => (
              <span
                key={path}
                title={path}
                className="max-w-full truncate rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-ink-200"
              >
                {path}
              </span>
            ))}
          </div>
        )}
        {paths.length > 0 && (
          <div className="shrink-0 rounded-md border border-white/[0.08] px-2 py-1 text-[11px] tabular-nums text-ink-400">
            {paths.length}
          </div>
        )}
      </div>
    </div>
  );
}

function ExecutionLogViewer({
  snapshot,
  error,
  autoScroll,
  onAutoScrollChange,
  onRefresh,
  onClose,
  endRef,
}: {
  snapshot: ExecutionLogSnapshot | null;
  error: string;
  autoScroll: boolean;
  onAutoScrollChange: (enabled: boolean) => void;
  onRefresh: () => void;
  onClose: () => void;
  endRef: React.RefObject<HTMLDivElement | null>;
}) {
  const entries = snapshot?.entries ?? [];
  return (
    <div className="no-drag fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex h-[78vh] w-[min(980px,calc(100vw-2rem))] flex-col rounded-lg border border-white/10 bg-[#111111] shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-ink-100">
              Execution log
            </div>
            <div className="mt-0.5 truncate text-[11px] text-ink-500">
              {snapshot?.path ?? "Loading log path..."}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label className="flex h-7 items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 text-[11.5px] text-ink-300">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(event) =>
                  onAutoScrollChange(event.currentTarget.checked)
                }
                className="h-3.5 w-3.5 accent-emerald-400"
              />
              Auto-scroll
            </label>
            <button
              type="button"
              onClick={onRefresh}
              className="h-7 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 text-[11.5px] text-ink-300 transition hover:bg-white/[0.06] hover:text-ink-100"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close execution log viewer"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.03] text-ink-300 transition hover:bg-white/[0.06] hover:text-ink-100"
            >
              <svg
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
              >
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-2 text-[11px] text-ink-500">
          <span>{snapshot?.totalLines ?? 0} lines</span>
          <span>{entries.length} shown</span>
          {snapshot?.truncated && (
            <span className="text-amber-200">Older entries hidden</span>
          )}
          {error && <span className="text-red-200">{error}</span>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {entries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-[12px] text-ink-500">
              No execution log entries yet.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {entries.map((entry) => (
                <details
                  key={entry.line}
                  className={`group rounded-lg border bg-white/[0.025] ${executionLogEventClass(entry)}`}
                >
                  <summary className="grid cursor-pointer grid-cols-[12px_76px_150px_minmax(0,1fr)_56px] items-center gap-3 px-3 py-2 text-[11.5px] marker:hidden">
                    <svg
                      viewBox="0 0 12 12"
                      className="h-2.5 w-2.5 text-ink-500 transition group-open:rotate-90"
                      fill="currentColor"
                    >
                      <path d="M4 2l4 4-4 4V2z" />
                    </svg>
                    <span className="font-mono text-ink-500">
                      {entryTimeLabel(entry)}
                    </span>
                    <span className="truncate font-medium text-ink-100">
                      {entry.event}
                    </span>
                    <span className="truncate text-ink-300">
                      {executionLogSummary(entry)}
                    </span>
                    <span className="text-right font-mono text-ink-600">
                      #{entry.line}
                    </span>
                  </summary>
                  <ExecutionLogEntryDetails entry={entry} />
                </details>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ExecutionLogEntryDetails({
  entry,
}: {
  entry: ExecutionLogEntry;
}) {
  const data = isLogRecord(entry.data) ? entry.data : null;
  if (entry.event === "model_request" && data) {
    return <ModelRequestLogDetails entry={entry} data={data} />;
  }
  if (entry.event === "model_response" && data) {
    return <ModelResponseLogDetails entry={entry} data={data} />;
  }
  return (
    <pre className="selectable mx-3 mb-3 max-h-80 overflow-auto rounded-md border border-white/[0.07] bg-black/35 p-3 text-[11px] leading-5 text-ink-200">
      {executionLogDetails(entry)}
    </pre>
  );
}

function ModelRequestLogDetails({
  entry,
  data,
}: {
  entry: ExecutionLogEntry;
  data: Record<string, unknown>;
}) {
  const messages = logRecordArrayField(data, "messages");
  const newMessages = logRecordArrayField(data, "newMessages");
  const fullMessages = logRecordArrayField(data, "fullMessages");
  const newFullMessages = logRecordArrayField(data, "newFullMessages");
  const requestBody = logRecordField(data, "requestBody");
  const [showAll, setShowAll] = useState(false);
  const allRecords = fullMessages.length > 0 ? fullMessages : messages;
  const newRecords =
    newFullMessages.length > 0 || fullMessages.length > 0
      ? newFullMessages
      : newMessages;
  const visibleMessages =
    showAll || newRecords.length === 0 ? allRecords : newRecords;
  const visibleLabel =
    showAll || newRecords.length === 0 ? "all messages" : "new messages";
  return (
    <div className="mx-3 mb-3 overflow-hidden rounded-md border border-white/[0.07] bg-black/25 text-[11px] text-ink-200">
      <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-3 py-2">
        <div className="min-w-0">
          <div className="font-medium text-ink-100">Model request context</div>
          <div className="mt-0.5 break-all text-ink-500">
            Snapshot file is overwritten each request:{" "}
            {logStringField(data, "promptPath")}
          </div>
        </div>
        {allRecords.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className="shrink-0 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[11px] text-ink-300 transition hover:bg-white/[0.08] hover:text-ink-100"
          >
            {showAll
              ? `Show new messages (${newRecords.length})`
              : `Show all ${allRecords.length} messages`}
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 border-b border-white/[0.06] px-3 py-2 text-ink-400">
        <span>source: {logStringField(data, "requestSource") || "unknown"}</span>
        <span>total: {String(data.messageCount ?? "")}</span>
        <span>added: {String(data.newMessageCount ?? "")}</span>
      </div>
      <div className="border-b border-white/[0.06] px-3 py-2 text-ink-500">
        Showing exact {visibleLabel}. These are hidden model-context messages; many
        are system, harness, tool-result, or retry messages that are not shown
        as separate bubbles in the main chat.
      </div>
      <div className="border-b border-sky-300/10 bg-sky-300/[0.035] px-3 py-2 text-sky-100/80">
        Tool calls appear as separate tool_call and tool_result log entries.
        The next model_request includes the tool result as a hidden user
        message beginning with [ok] or [error].
      </div>
      <div className="selectable max-h-80 overflow-auto px-3 py-2">
        {visibleMessages.length === 0 ? (
          <div className="text-ink-500">
            No per-message summary was logged for this entry.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {visibleMessages.map((message) => (
              <div
                key={`${String(message.index)}-${logStringField(message, "role")}`}
                className="rounded border border-white/[0.05] bg-black/25 px-2 py-1.5"
              >
                <div className="mb-1 flex items-center gap-2 text-ink-500">
                  <span className="font-mono">#{String(message.index)}</span>
                  <span className="rounded border border-white/[0.08] px-1.5 py-0.5 uppercase text-ink-300">
                    {logStringField(message, "role") || "message"}
                  </span>
                  <span>{String(message.chars ?? 0)} chars</span>
                </div>
                <div className="whitespace-pre-wrap break-words leading-5 text-ink-200">
                  {logStringField(message, "content") ||
                    logStringField(message, "preview")}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {requestBody && (
        <details className="border-t border-white/[0.06]">
          <summary className="cursor-pointer px-3 py-2 text-ink-400 marker:text-ink-600">
            Exact request body
          </summary>
          <pre className="selectable max-h-80 overflow-auto border-t border-white/[0.06] bg-black/35 p-3 text-[11px] leading-5 text-ink-200">
            {JSON.stringify(requestBody, null, 2)}
          </pre>
        </details>
      )}
      <details className="border-t border-white/[0.06]">
        <summary className="cursor-pointer px-3 py-2 text-ink-400 marker:text-ink-600">
          Raw JSON
        </summary>
        <pre className="selectable max-h-80 overflow-auto border-t border-white/[0.06] bg-black/35 p-3 text-[11px] leading-5 text-ink-200">
          {executionLogDetailsJson(entry)}
        </pre>
      </details>
    </div>
  );
}

function ModelResponseLogDetails({
  entry,
  data,
}: {
  entry: ExecutionLogEntry;
  data: Record<string, unknown>;
}) {
  return (
    <div className="mx-3 mb-3 overflow-hidden rounded-md border border-white/[0.07] bg-black/25 text-[11px] text-ink-200">
      <div className="grid grid-cols-3 gap-2 border-b border-white/[0.06] px-3 py-2 text-ink-400">
        <span>call: {logStringField(data, "callId") || "unknown"}</span>
        <span>source: {logStringField(data, "requestSource") || "unknown"}</span>
        <span>chars: {String(data.chars ?? 0)}</span>
      </div>
      <div className="border-b border-white/[0.06] px-3 py-2 text-ink-500">
        Exact assistant response assembled from the streamed chunks for this
        model call.
      </div>
      <pre className="selectable max-h-96 overflow-auto whitespace-pre-wrap border-b border-white/[0.06] bg-black/25 p-3 text-[11px] leading-5 text-ink-200">
        {logStringField(data, "content")}
      </pre>
      <details>
        <summary className="cursor-pointer px-3 py-2 text-ink-400 marker:text-ink-600">
          Raw JSON
        </summary>
        <pre className="selectable max-h-80 overflow-auto border-t border-white/[0.06] bg-black/35 p-3 text-[11px] leading-5 text-ink-200">
          {executionLogDetailsJson(entry)}
        </pre>
      </details>
    </div>
  );
}

function isLogRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function logRecordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key];
  return isLogRecord(value) ? value : null;
}

function logRecordArrayField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter(isLogRecord);
}

function logStringField(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function logNumberField(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compactLogText(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= LOG_DETAIL_PREVIEW_MAX_CHARS) return oneLine;
  return `${oneLine.slice(0, LOG_DETAIL_PREVIEW_MAX_CHARS)}...`;
}

export function executionLogSummary(entry: ExecutionLogEntry): string {
  const data = isLogRecord(entry.data) ? entry.data : null;
  if (!data) return compactLogText(String(entry.data ?? ""));
  switch (entry.event) {
    case "tool_call":
      return compactLogText(
        `${logStringField(data, "name")} ${JSON.stringify(data.args ?? {})}`,
      );
    case "tool_result":
      return compactLogText(
        `${logStringField(data, "tool")} ${logStringField(data, "error") || logStringField(data, "result")}`,
      );
    case "plan_blocked":
    case "plan_step_failed":
    case "step_incomplete":
      return compactLogText(logStringField(data, "reason"));
    case "verify_result":
      return compactLogText(
        `${logStringField(data, "result")} ${logStringField(data, "reason")}`,
      );
    case "harness_prompt":
    case "system_prompt":
      return compactLogText(
        `${logStringField(data, "label")} ${logStringField(data, "content")}`,
      );
    case "model_request":
      return modelRequestSummary(data);
    case "model_response":
      return modelResponseSummary(data);
    case "model_chunk":
      return modelChunkSummary(data);
    case "stream_chunk":
      return streamChunkSummary(data);
    default:
      return compactLogText(JSON.stringify(data));
  }
}

export function executionLogDetails(entry: ExecutionLogEntry): string {
  const data = isLogRecord(entry.data) ? entry.data : null;
  if (entry.event === "model_request" && data) {
    return modelRequestDetails(entry, data);
  }
  if (entry.event === "model_response" && data) {
    return modelResponseDetails(entry, data);
  }
  return JSON.stringify(
    {
      line: entry.line,
      timestamp: entry.timestamp,
      conversationId: entry.conversationId,
      mode: entry.mode,
      model: entry.model,
      event: entry.event,
      data: entry.data,
      raw: entry.raw,
    },
    null,
    2,
  );
}

function modelRequestSummary(data: Record<string, unknown>): string {
  const messageCount = String(data.messageCount ?? "");
  const newMessageCount = String(data.newMessageCount ?? "");
  const messages = logRecordArrayField(data, "messages");
  const newMessages = logRecordArrayField(data, "newMessages");
  const latestMessage =
    newMessages[newMessages.length - 1] ?? messages[messages.length - 1];
  if (!latestMessage) {
    return compactLogText(
      `${messageCount} messages ${logStringField(data, "promptPath")}`,
    );
  }
  const role = logStringField(latestMessage, "role") || "message";
  const preview = logStringField(latestMessage, "preview");
  return compactLogText(
    `${messageCount} messages | ${newMessageCount} new | latest ${role}: ${preview}`,
  );
}

function modelResponseSummary(data: Record<string, unknown>): string {
  return compactLogText(
    `${String(data.chars ?? 0)} chars ${logStringField(data, "content")}`,
  );
}

function modelChunkSummary(data: Record<string, unknown>): string {
  if (data.done === true) return "done";
  return compactLogText(logStringField(data, "content"));
}

function streamChunkSummary(data: Record<string, unknown>): string {
  const type = logStringField(data, "type");
  switch (type) {
    case "token":
      return compactLogText(`token ${logStringField(data, "text")}`);
    case "system_prompt":
      return compactLogText(
        `system prompt ${logStringField(data, "label")}: ${logStringField(data, "content")}`,
      );
    case "tool_call": {
      const call = logRecordField(data, "call");
      if (!call) return "tool call";
      return compactLogText(
        `tool call ${logStringField(call, "name")} ${JSON.stringify(call.args ?? {})}`,
      );
    }
    case "tool_result":
      return compactLogText(
        `tool result ${logStringField(data, "id")} ${logStringField(data, "error") || logStringField(data, "result")}`,
      );
    case "activity": {
      const activity = logRecordField(data, "activity");
      if (!activity) return "activity";
      return compactLogText(
        `activity ${logStringField(activity, "kind")} ${logStringField(activity, "label")} ${logStringField(activity, "detail")}`,
      );
    }
    case "plan_node_start":
      return compactLogText(
        `start ${logStringField(data, "kind")} ${logStringField(data, "name") || logStringField(data, "criterion") || logStringField(data, "prompt")}`,
      );
    case "plan_node_end":
      return compactLogText(
        `end ${logStringField(data, "kind")} ${logStringField(data, "status")} ${logStringField(data, "reason")}`,
      );
    case "set_assistant_content":
      return compactLogText(
        logStringField(data, "text")
          ? `assistant content ${logStringField(data, "text")}`
          : "assistant content cleared",
      );
    case "harness_message":
      return compactLogText(
        `harness ${logStringField(data, "label")} ${logStringField(data, "phase")}: ${logStringField(data, "content")}`,
      );
    case "plan_proposed": {
      const steps = logRecordArrayField(data, "steps");
      const names = steps.map((step) => logStringField(step, "name")).join(", ");
      return compactLogText(`plan proposed ${steps.length} steps ${names}`);
    }
    case "plan_reviewed": {
      const review = logRecordField(data, "review");
      if (!review) return "plan reviewed";
      return compactLogText(
        `plan reviewed ${logStringField(review, "verdict")} ${logStringField(review, "summary")}`,
      );
    }
    case "done":
      return "done";
    case "error":
      return compactLogText(`error ${logStringField(data, "error")}`);
    default:
      return compactLogText(JSON.stringify(data));
  }
}

function modelRequestDetails(
  entry: ExecutionLogEntry,
  data: Record<string, unknown>,
): string {
  const fullMessages = logRecordArrayField(data, "fullMessages");
  const messages =
    fullMessages.length > 0 ? fullMessages : logRecordArrayField(data, "messages");
  const lines = [
    `line: ${entry.line}`,
    `timestamp: ${entry.timestamp}`,
    `conversationId: ${entry.conversationId ?? ""}`,
    `mode: ${entry.mode ?? ""}`,
    `model: ${entry.model ?? ""}`,
    `promptPath: ${logStringField(data, "promptPath")}`,
    `messageCount: ${String(data.messageCount ?? "")}`,
    "",
    "messages:",
  ];
  if (messages.length === 0) {
    lines.push("  No per-message summary was logged for this entry.");
  } else {
    for (const message of messages) {
      const index = logNumberField(message, "index");
      const role = logStringField(message, "role") || "message";
      const chars = logNumberField(message, "chars");
      lines.push(
        `  ${index ?? "?"}. ${role} (${chars ?? 0} chars)`,
        `     ${logStringField(message, "content") || logStringField(message, "preview")}`,
      );
    }
  }
  lines.push("", "raw:", executionLogDetailsJson(entry));
  return lines.join("\n");
}

function modelResponseDetails(
  entry: ExecutionLogEntry,
  data: Record<string, unknown>,
): string {
  return [
    `line: ${entry.line}`,
    `timestamp: ${entry.timestamp}`,
    `conversationId: ${entry.conversationId ?? ""}`,
    `mode: ${entry.mode ?? ""}`,
    `model: ${entry.model ?? ""}`,
    `callId: ${logStringField(data, "callId")}`,
    `requestSource: ${logStringField(data, "requestSource")}`,
    `outcome: ${logStringField(data, "outcome")}`,
    `chars: ${String(data.chars ?? 0)}`,
    "",
    "content:",
    logStringField(data, "content"),
    "",
    "raw:",
    executionLogDetailsJson(entry),
  ].join("\n");
}

function executionLogDetailsJson(entry: ExecutionLogEntry): string {
  return JSON.stringify(
    {
      line: entry.line,
      timestamp: entry.timestamp,
      conversationId: entry.conversationId,
      mode: entry.mode,
      model: entry.model,
      event: entry.event,
      data: entry.data,
      raw: entry.raw,
    },
    null,
    2,
  );
}

function entryTimeLabel(entry: ExecutionLogEntry): string {
  if (!entry.timestamp) return "--:--:--";
  const date = new Date(entry.timestamp);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function executionLogEventClass(entry: ExecutionLogEntry): string {
  if (
    entry.event.includes("blocked") ||
    entry.event.includes("failed") ||
    entry.event.includes("error")
  ) {
    return "border-red-400/20";
  }
  if (entry.event === "tool_call" || entry.event === "tool_result") {
    return "border-sky-300/15";
  }
  if (entry.event === "verify_result" || entry.event === "plan_event") {
    return "border-amber-300/15";
  }
  return "border-white/[0.07]";
}

function Header({
  model,
  pillKey,
  workingDir,
  codeSubmode,
  canvasOpen,
  modeLocked,
  onSelectMode,
  onChangeWorkingDir,
  onSelectCodeSubmode,
  onToggleCanvas,
  onSwitchModel,
  executionLogging,
  executionLogPath,
  executionLogOpenError,
  thinkingEnabled,
  onToggleExecutionLogging,
  onToggleThinking,
  onOpenExecutionLog,
}: {
  model: string;
  pillKey: PillKey;
  workingDir?: string;
  codeSubmode: CodeSubmode;
  canvasOpen: boolean;
  modeLocked: boolean;
  onSelectMode: (next: PillKey) => void;
  onChangeWorkingDir: () => void;
  onSelectCodeSubmode: (next: CodeSubmode) => void;
  onToggleCanvas: () => void;
  onSwitchModel: (model: string) => void;
  executionLogging: boolean;
  executionLogPath: string;
  executionLogOpenError: string;
  thinkingEnabled: boolean;
  onToggleExecutionLogging: () => void;
  onToggleThinking: () => void;
  onOpenExecutionLog: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    function handleClick(e: MouseEvent): void {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [pickerOpen]);

  const currentLabel =
    AVAILABLE_MODELS.find((m) => m.name === model)?.label ?? model;

  return (
    <div className="drag flex h-11 shrink-0 items-center justify-between border-b border-white/[0.06] px-4">
      <div className="no-drag min-w-[8rem] truncate text-[11px] text-ink-400">
        {pillKey === "code" && workingDir ? (
          <span className="flex min-w-0 items-center gap-2" title={workingDir}>
            <span className="min-w-0 truncate">📁 {dirBasename(workingDir)}</span>
            <button
              type="button"
              onClick={onChangeWorkingDir}
              className="shrink-0 rounded border border-white/[0.08] px-1.5 py-0.5 text-[10.5px] text-ink-300 transition hover:bg-white/[0.05] hover:text-ink-100"
            >
              Change
            </button>
          </span>
        ) : null}
      </div>
      <div className="no-drag flex items-center gap-1 rounded-lg bg-white/[0.04] p-0.5 text-[12px]">
        <ModePill
          active={pillKey === "chat"}
          disabled={modeLocked && pillKey !== "chat"}
          title={
            modeLocked && pillKey !== "chat"
              ? "Mode locked: this Code conversation has its own working directory and sandbox. Start a new conversation to chat."
              : undefined
          }
          onClick={() => pillKey !== "chat" && onSelectMode("chat")}
        >
          Chat
        </ModePill>
        <ModePill
          active={pillKey === "build"}
          disabled={modeLocked && pillKey !== "build"}
          title={
            modeLocked && pillKey !== "build"
              ? "Mode locked: this Code conversation has its own working directory and sandbox. Start a new conversation to use Build."
              : undefined
          }
          onClick={() => pillKey !== "build" && onSelectMode("build")}
        >
          Build
        </ModePill>
        <ModePill
          active={pillKey === "code"}
          onClick={() => pillKey !== "code" && onSelectMode("code")}
        >
          Code
        </ModePill>
      </div>
      <div className="no-drag flex shrink-0 items-center justify-end gap-2">
        {pillKey === "code" && workingDir && (
          <label className="flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11.5px] text-ink-300">
            <span className="text-ink-500">Mode</span>
            <select
              value={codeSubmode}
              onChange={(e) =>
                onSelectCodeSubmode(e.target.value as CodeSubmode)
              }
              className="bg-transparent text-ink-100 outline-none"
            >
              <option className="bg-[#1a1a1a]" value="discuss">
                discuss
              </option>
              <option className="bg-[#1a1a1a]" value="plan">
                plan
              </option>
              <option className="bg-[#1a1a1a]" value="execute">
                execute
              </option>
              <option className="bg-[#1a1a1a]" value="auto">
                auto
              </option>
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={onToggleThinking}
          title={
            thinkingEnabled
              ? "Thinking output on: MLX-LM reasoning chunks will be shown in assistant thinking blocks."
              : "Thinking output off: MLX-LM reasoning chunks stay disabled."
          }
          className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] transition ${
            thinkingEnabled
              ? "border-sky-300/30 bg-sky-300/10 text-sky-100"
              : "border-white/[0.08] bg-white/[0.03] text-ink-400 hover:bg-white/[0.05] hover:text-ink-100"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              thinkingEnabled ? "bg-sky-200" : "bg-ink-500"
            }`}
          />
          Think
        </button>
        <button
          type="button"
          onClick={onToggleExecutionLogging}
          title={
            executionLogging
              ? `Execution logging on: ${executionLogPath}`
              : `Execution logging off: ${executionLogPath}`
          }
          className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] transition ${
            executionLogging
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
              : "border-white/[0.08] bg-white/[0.03] text-ink-400 hover:bg-white/[0.05] hover:text-ink-100"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              executionLogging ? "bg-emerald-300" : "bg-ink-500"
            }`}
          />
          Log
        </button>
        {executionLogging && (
          <button
            type="button"
            onClick={onOpenExecutionLog}
            disabled={!executionLogPath}
            aria-label="Open execution log viewer"
            title={
              executionLogOpenError ||
              (executionLogPath
                ? `Open execution log viewer: ${executionLogPath}`
                : "Execution log path unavailable")
            }
            className="flex h-7 w-7 items-center justify-center rounded-md border border-emerald-400/25 bg-emerald-400/10 text-emerald-100 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.03] disabled:text-ink-500"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M5 2.5h4l3 3V13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" />
              <path d="M9 2.5V6h3" />
              <path d="M6.5 9h3M6.5 11h2" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[11.5px] text-ink-400 transition-all duration-200 hover:bg-white/[0.05] hover:text-ink-100"
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {currentLabel}
            <svg
              viewBox="0 0 16 16"
              className={`h-3 w-3 transition-transform duration-200 ${pickerOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path
                d="M4 6l4 4 4-4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {pickerOpen && (
            <div className="anim-fade-scale absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-white/10 bg-[#1a1a1a] p-1.5 shadow-2xl backdrop-blur-xl">
              <div className="mb-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-400">
                Switch model
              </div>
              {AVAILABLE_MODELS.map((m) => (
                <button
                  key={m.name}
                  onClick={() => {
                    setPickerOpen(false);
                    if (m.name !== model) onSwitchModel(m.name);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-all duration-150 ${
                    m.name === model
                      ? "bg-white/[0.07] text-white"
                      : "text-ink-200 hover:bg-white/[0.04]"
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
                      {m.label}
                      {m.recommended && (
                        <span className="rounded-full bg-white/10 px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-wider text-ink-200">
                          rec
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-400">
                      {m.size}
                    </div>
                  </div>
                  {m.name === model && (
                    <svg
                      viewBox="0 0 16 16"
                      className="h-3.5 w-3.5 text-emerald-400"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path
                        d="M3 8.5l3 3 7-7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        {pillKey !== "chat" && (
          <button
            onClick={onToggleCanvas}
            title={canvasOpen ? "Hide canvas" : "Show canvas"}
            className={`flex h-7 w-7 items-center justify-center rounded-md transition ${
              canvasOpen
                ? "bg-white/10 text-white"
                : "text-ink-400 hover:bg-white/5 hover:text-white"
            }`}
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="2" y="3" width="12" height="10" rx="1.5" />
              <path d="M9 3v10" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function ModePill({
  active,
  onClick,
  disabled,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-md px-3 py-1 font-medium transition-all duration-200 ease-out ${
        active
          ? "bg-white/10 text-white shadow-sm scale-[1.02]"
          : disabled
            ? "text-ink-500 opacity-40 cursor-not-allowed"
            : "text-ink-400 hover:text-ink-100 scale-100"
      }`}
    >
      {children}
    </button>
  );
}

function MessageList({
  messages,
  streaming,
  mode,
  codeSubmode,
  onRegenerateMessage,
  onExecutePlan,
}: {
  messages: ChatMessage[];
  streaming: boolean;
  mode: AgentMode;
  codeSubmode: CodeSubmode;
  onRegenerateMessage: (messageId: string) => void;
  onExecutePlan: (messageId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [expandedPlanningSummaryIds, setExpandedPlanningSummaryIds] = useState<
    Set<string>
  >(() => new Set());

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = (): void => {
      atBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (atBottomRef.current && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [messages]);

  const togglePlanningSummary = useCallback((summaryId: string): void => {
    setExpandedPlanningSummaryIds((current) => {
      const next = new Set(current);
      if (next.has(summaryId)) {
        next.delete(summaryId);
      } else {
        next.add(summaryId);
      }
      return next;
    });
  }, []);

  const renderItems = buildMessageRenderItems(
    messages,
    codeSubmode === "auto",
    expandedPlanningSummaryIds,
  );
  const empty = renderItems.length === 0;

  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto">
      {empty ? (
        <EmptyState mode={mode} />
      ) : (
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
          {renderItems.map((item, i) => {
            if (item.kind === "planning-summary") {
              return (
                <PlanningSummary
                  key={item.id}
                  messages={item.messages}
                  expanded={item.expanded}
                  onToggle={() => togglePlanningSummary(item.id)}
                />
              );
            }
            if (item.kind === "execution-separator") {
              return <ExecutionSeparator key={item.id} />;
            }

            const m = item.message;
            const isLast = i === renderItems.length - 1;
            const canExecutePlan =
              m.role === "assistant" && !!m.proposedPlan && !m.planExecuted;
            return (
              <div
                key={m.id}
                className="anim-float-in"
                style={{ animationDelay: `${Math.min(i * 30, 150)}ms` }}
              >
                <Message
                  message={m}
                  isLast={isLast}
                  streaming={streaming && isLast}
                  onRegenerate={
                    !streaming && m.role === "user"
                      ? () => onRegenerateMessage(m.id)
                      : undefined
                  }
                  onExecutePlan={
                    !streaming && canExecutePlan
                      ? () => onExecutePlan(m.id)
                      : undefined
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlanningSummary({
  messages,
  expanded,
  onToggle,
}: {
  messages: ChatMessage[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const assistantCount = messages.filter(
    (message) => message.role === "assistant",
  ).length;
  const actionLabel = expanded ? "Hide planning" : "Show planning";
  return (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11.5px] text-ink-300 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-ink-100"
        title={actionLabel}
      >
        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
        <span>
          Planning collapsed after execution started / {messages.length} messages /{" "}
          {assistantCount} model responses
        </span>
        <span className="border-l border-white/10 pl-2 text-ink-200">
          {actionLabel}
        </span>
      </button>
    </div>
  );
}

function ExecutionSeparator() {
  return (
    <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-ink-500">
      <div className="h-px flex-1 border-t border-dotted border-white/20" />
      <span>Execution started</span>
      <div className="h-px flex-1 border-t border-dotted border-white/20" />
    </div>
  );
}

function EmptyState({ mode }: { mode: AgentMode }) {
  const chatSuggestions = [
    {
      title: "Search the web",
      prompt: "What are the top AI news stories this week?",
    },
    {
      title: "Explain a concept",
      prompt: "Explain the transformer architecture in plain English.",
    },
    {
      title: "Plan a trip",
      prompt: "Help me plan a weekend trip to Tokyo for 4 days.",
    },
    {
      title: "Debug code",
      prompt: "Why is this JS promise not resolving? (paste code)",
    },
  ];
  const codeSuggestions = [
    {
      title: "Landing page",
      prompt:
        "Build a one-page landing site for a fake AI dog-walking app. Modern design, dark mode.",
    },
    {
      title: "Pomodoro timer",
      prompt:
        "Build a pomodoro timer web app with start/pause/reset buttons and a minimal UI.",
    },
    {
      title: "Retro snake game",
      prompt:
        "Make a playable snake game in a single index.html with keyboard controls.",
    },
    {
      title: "Markdown preview",
      prompt:
        "Build a live markdown editor — textarea on the left, rendered output on the right.",
    },
  ];
  const suggestions = mode === "code" ? codeSuggestions : chatSuggestions;
  return (
    <div className="anim-fade-in flex h-full flex-col items-center justify-center px-8">
      <div className="anim-fade-up mb-12 text-center">
        <img
          src={gemmaLogoUrl}
          alt="Gemma"
          className="mx-auto mb-6 h-20 w-20"
          draggable={false}
        />
        <div className="mb-3 text-[32px] font-semibold tracking-tight text-white">
          {mode === "code" ? "What should we build?" : "How can I help?"}
        </div>
        <div className="text-sm text-ink-400">
          {mode === "code"
            ? "Gemma will write files into a workspace and show a live preview on the right."
            : "Running locally. Your messages never leave your Mac."}
        </div>
      </div>
      <div className="anim-stagger grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s.title}
            onClick={() => {
              const ta =
                document.querySelector<HTMLTextAreaElement>("[data-composer]");
              if (ta) {
                const setter = Object.getOwnPropertyDescriptor(
                  window.HTMLTextAreaElement.prototype,
                  "value",
                )?.set;
                setter?.call(ta, s.prompt);
                ta.dispatchEvent(new Event("input", { bubbles: true }));
                ta.focus();
              }
            }}
            className="anim-fade-up rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-left transition hover:border-white/10 hover:bg-white/[0.04] active:scale-[0.98]"
          >
            <div className="text-sm font-medium text-white">{s.title}</div>
            <div className="mt-0.5 text-[12.5px] text-ink-400">{s.prompt}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
