import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AVAILABLE_MODELS,
  type AgentMode,
  type ChatMessage,
  type CodeSubmode,
  type ToolCall,
  type StreamChunk,
} from "@shared/types";
import gemmaLogoUrl from "../assets/gemma-logo.png";
import Composer from "./Composer";
import Message from "./Message";
import Sidebar from "./Sidebar";
import Canvas from "./Canvas";
import {
  STORAGE_KEY,
  isModeLocked,
  shouldDisplayConversationMessage,
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
    .filter(shouldDisplayConversationMessage)
    .map((m) => ({
      role: m.role as Exclude<ChatMessage["role"], "harness"> | "user",
      content: m.content,
      toolCalls: m.toolCalls,
    }));
}

export default function Chat({ model, onSwitchModel }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const loaded = loadConversations();
    return loaded.length ? loaded : [newConversation()];
  });
  const [activeId, setActiveId] = useState<string>(() => conversations[0].id);
  const [streaming, setStreaming] = useState(false);
  const streamRef = useRef<{ abort: boolean }>({ abort: false });

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? conversations[0],
    [conversations, activeId],
  );

  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

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

  // Three-way pill selector. "code" prompts the user for a working directory
  // via the native dialog; cancelling leaves the current pill active.
  // Once a Code conversation has at least one message (isModeLocked), the
  // chat / build branches no-op so the agent can't be swapped onto a
  // different sandbox underneath an in-flight Code session.
  async function selectMode(next: PillKey): Promise<void> {
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
    const path = await window.api.chooseDirectory(
      activeConversation.workingDir,
    );
    if (!path) return;
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

  async function handleSend(input: string): Promise<void> {
    if (!input.trim() || streaming) return;

    const conv = conversations.find((c) => c.id === activeId)!;

    const userMsg: ChatMessage = {
      id: newId("m"),
      role: "user",
      content: input,
      createdAt: Date.now(),
    };
    const assistantMsg: ChatMessage = {
      id: newId("m"),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      model,
      toolCalls: [],
      activity: { kind: "thinking" },
    };

    updateActive((c) => {
      const title =
        !c.messages.some((m) => m.role === "user")
          ? input.slice(0, 48) + (input.length > 48 ? "…" : "")
          : c.title;
      // Stamp the current global model on the conversation so it can be
      // auto-loaded next time the conversation is opened.
      return {
        ...c,
        title,
        model,
        messages: [...c.messages, userMsg, assistantMsg],
      };
    });

    const history = requestHistory([...conv.messages, userMsg]);

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
        } else if (chunk.type === "plan_proposed") {
          msgs[msgs.length - 1] = {
            ...last,
            proposedPlan: chunk.steps,
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

  async function handleRegenerate(): Promise<void> {
    if (streaming) return;
    const conv = conversations.find((c) => c.id === activeId);
    if (!conv) return;
    const lastUser = [...conv.messages]
      .reverse()
      .find((m) => m.role === "user");
    if (!lastUser) return;
    updateActive((c) => {
      const msgs = [...c.messages];
      while (msgs.length && msgs[msgs.length - 1].role !== "user") {
        msgs.pop();
      }
      return { ...c, messages: msgs.slice(0, -1) };
    });
    setTimeout(() => handleSend(lastUser.content), 0);
  }

  async function handleExecutePlan(messageId: string): Promise<void> {
    if (streaming) return;
    const conv = conversations.find((c) => c.id === activeId);
    if (!conv) return;
    const proposalMsg = conv.messages.find((m) => m.id === messageId);
    if (!proposalMsg || !proposalMsg.proposedPlan || proposalMsg.planExecuted)
      return;

    const assistantMsg: ChatMessage = {
      id: newId("m"),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      model,
      toolCalls: [],
      activity: { kind: "thinking" },
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
            onSelectCodeSubmode={selectCodeSubmode}
            onToggleCanvas={toggleCanvas}
            onSwitchModel={onSwitchModel}
          />
          <MessageList
            messages={activeConversation.messages}
            streaming={streaming}
            mode={activeConversation.mode}
            onRegenerate={handleRegenerate}
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

function Header({
  model,
  pillKey,
  workingDir,
  codeSubmode,
  canvasOpen,
  modeLocked,
  onSelectMode,
  onSelectCodeSubmode,
  onToggleCanvas,
  onSwitchModel,
}: {
  model: string;
  pillKey: PillKey;
  workingDir?: string;
  codeSubmode: CodeSubmode;
  canvasOpen: boolean;
  modeLocked: boolean;
  onSelectMode: (next: PillKey) => void;
  onSelectCodeSubmode: (next: CodeSubmode) => void;
  onToggleCanvas: () => void;
  onSwitchModel: (model: string) => void;
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
          <span title={workingDir}>📁 {dirBasename(workingDir)}</span>
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
          onClick={() => onSelectMode("code")}
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
  onRegenerate,
  onExecutePlan,
}: {
  messages: ChatMessage[];
  streaming: boolean;
  mode: AgentMode;
  onRegenerate: () => void;
  onExecutePlan: (messageId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

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

  const visibleMessages = messages.filter(shouldDisplayConversationMessage);
  const empty = visibleMessages.length === 0;

  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto">
      {empty ? (
        <EmptyState mode={mode} />
      ) : (
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
          {visibleMessages.map((m, i) => (
            <div
              key={m.id}
              className="anim-float-in"
              style={{ animationDelay: `${Math.min(i * 30, 150)}ms` }}
            >
              <Message
                message={m}
                isLast={i === visibleMessages.length - 1}
                streaming={streaming && i === visibleMessages.length - 1}
                onRegenerate={
                  !streaming &&
                  m.role === "assistant" &&
                  i === visibleMessages.length - 1
                    ? onRegenerate
                    : undefined
                }
                onExecutePlan={
                  !streaming && m.role === "assistant" && !!m.proposedPlan
                    ? () => onExecutePlan(m.id)
                    : undefined
                }
              />
            </div>
          ))}
        </div>
      )}
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
