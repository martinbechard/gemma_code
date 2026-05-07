import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import type {
  AgentActivity,
  ChatMessage,
  PlanNode,
  ProposedStep,
  ToolCall,
} from "@shared/types";
import gemmaLogoUrl from "../assets/gemma-logo.png";

interface Props {
  message: ChatMessage;
  isLast: boolean;
  streaming: boolean;
  onRegenerate?: () => void;
  onExecutePlan?: () => void;
}

interface Parsed {
  thinking: string;
  thinkingInProgress: boolean;
  visible: string;
}

function parseThinking(content: string): Parsed {
  const openRe = /<think(?:ing)?>/;
  const closeRe = /<\/think(?:ing)?>/;
  const openMatch = content.match(openRe);
  if (!openMatch)
    return { thinking: "", thinkingInProgress: false, visible: content };
  const before = content.slice(0, openMatch.index!);
  const after = content.slice(openMatch.index! + openMatch[0].length);
  const closeMatch = after.match(closeRe);
  if (!closeMatch) {
    return { thinking: after, thinkingInProgress: true, visible: before };
  }
  const thinking = after.slice(0, closeMatch.index!);
  const rest = after.slice(closeMatch.index! + closeMatch[0].length);
  return {
    thinking,
    thinkingInProgress: false,
    visible: (before + rest).trim(),
  };
}

export default function Message({
  message,
  streaming,
  onRegenerate,
  onExecutePlan,
}: Props) {
  const isUser = message.role === "user";
  const isHarness = message.role === "harness";
  const parsed = useMemo(
    () => parseThinking(message.content),
    [message.content],
  );
  const html = useMemo(() => {
    if (!parsed.visible) return "";
    try {
      return marked.parse(parsed.visible, {
        async: false,
        breaks: true,
      }) as string;
    } catch {
      return escapeHtml(parsed.visible).replace(/\n/g, "<br/>");
    }
  }, [parsed.visible]);

  if (message.role === "system") return null;

  if (isHarness) {
    return (
      <div className="flex justify-start">
        <div className="selectable max-w-[86%] rounded-2xl rounded-bl-md border border-amber-300/20 bg-amber-300/[0.07] px-4 py-2.5 text-[13px] leading-relaxed text-amber-50">
          {message.harnessLabel && (
            <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-amber-200/70">
              Harness / {message.harnessLabel}
            </div>
          )}
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="selectable max-w-[78%] rounded-2xl rounded-br-md bg-white/[0.08] px-4 py-2.5 text-[14.5px] leading-relaxed text-white">
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    );
  }

  const isEmpty =
    !parsed.visible && !parsed.thinking && !message.toolCalls?.length;
  const showCursor = streaming && !message.done;
  const showActivity =
    streaming &&
    !message.done &&
    message.activity &&
    message.activity.kind !== "idle";

  return (
    <div className="group flex gap-3">
      <img
        src={gemmaLogoUrl}
        alt="Gemma"
        className="mt-0.5 h-7 w-7 shrink-0 rounded-full object-cover"
      />
      <div className="selectable min-w-0 flex-1">
        {parsed.thinking && (
          <ThinkingBlock
            content={parsed.thinking}
            inProgress={parsed.thinkingInProgress}
          />
        )}

        {message.systemPrompts?.map((prompt, index) => (
          <SystemPromptView
            key={`${prompt.label}-${index}`}
            label={prompt.label}
            content={prompt.content}
          />
        ))}

        {message.proposedPlan && message.proposedPlan.length > 0 && (
          <PlanProposalView
            steps={message.proposedPlan}
            executed={!!message.planExecuted}
            onExecute={onExecutePlan}
          />
        )}

        {message.planNodes && message.planNodes.length > 0 && (
          <PlanView
            nodes={message.planNodes}
            toolCalls={message.toolCalls ?? []}
          />
        )}

        {message.toolCalls
          ?.filter((tc) => !tc.parentStepId)
          .map((tc) => (
            <ToolCallView key={tc.id} call={tc} />
          ))}

        {!isEmpty && (
          <div
            className="markdown-body text-[14.5px] text-ink-100"
            dangerouslySetInnerHTML={{
              __html:
                html +
                (showCursor && parsed.visible
                  ? '<span class="anim-caret">▍</span>'
                  : ""),
            }}
          />
        )}

        {showActivity && (
          <ActivityBar
            activity={message.activity!}
            startedAt={message.createdAt}
            toolCalls={message.toolCalls}
          />
        )}

        {isEmpty && showCursor && !showActivity && (
          <div className="dot-flashing text-ink-400">
            <span />
            <span />
            <span />
          </div>
        )}

        {onRegenerate && (
          <div className="mt-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
            <button
              onClick={onRegenerate}
              className="rounded-md px-2 py-1 text-[11px] text-ink-400 hover:bg-white/5 hover:text-white"
            >
              ↻ Regenerate
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(parsed.visible)}
              className="rounded-md px-2 py-1 text-[11px] text-ink-400 hover:bg-white/5 hover:text-white"
            >
              Copy
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const THINKING_VERBS = [
  "Thinking",
  "Considering",
  "Planning",
  "Pondering",
  "Reasoning",
  "Sketching",
];
const GENERATING_VERBS = ["Writing", "Composing", "Drafting"];

function ActivityBar({
  activity,
  startedAt,
  toolCalls,
}: {
  activity: AgentActivity;
  startedAt: number;
  toolCalls?: ToolCall[];
}) {
  const [elapsed, setElapsed] = useState(() =>
    Math.floor((Date.now() - startedAt) / 1000),
  );
  const verbIdxRef = useRef(0);
  const [verbIdx, setVerbIdx] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  useEffect(() => {
    if (activity.kind === "thinking" || activity.kind === "generating") {
      const id = window.setInterval(() => {
        verbIdxRef.current++;
        setVerbIdx(verbIdxRef.current);
      }, 3500);
      return () => window.clearInterval(id);
    }
    return undefined;
  }, [activity.kind]);

  const label = useMemo(() => {
    if (activity.kind === "thinking") {
      const verbs = THINKING_VERBS;
      return verbs[verbIdx % verbs.length];
    }
    if (activity.kind === "generating") {
      const verbs = GENERATING_VERBS;
      return verbs[verbIdx % verbs.length];
    }
    if (activity.kind === "runtime") {
      return activity.detail
        ? `${activity.label} · ${activity.detail}`
        : activity.label;
    }
    if (activity.kind === "tool") {
      const verb = toolVerb(activity.tool);
      return activity.target ? `${verb} ${activity.target}` : verb;
    }
    return "";
  }, [activity, verbIdx]);

  // Hide if there's already a running tool card that conveys the same state
  const hasRunningTool = toolCalls?.some((t) => t.running);
  if (hasRunningTool && activity.kind === "tool") return null;

  const chars = (activity as { chars?: number }).chars;
  const elapsedSeconds =
    activity.kind === "runtime" ? activity.elapsedSeconds : undefined;
  return (
    <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-400">
      <span className="shimmer-text">{label}…</span>
      <span className="tabular-nums text-ink-400/70">
        {chars != null && chars > 0 ? `${chars.toLocaleString()} chars · ` : ""}
        {formatElapsed(elapsedSeconds ?? elapsed)}
      </span>
      {activity.kind === "runtime" && activity.model && (
        <span className="truncate font-mono text-ink-400">
          {activity.model}
        </span>
      )}
    </div>
  );
}

function toolVerb(name: string): string {
  switch (name) {
    case "write_file":
      return "Writing";
    case "read_file":
      return "Reading";
    case "edit_file":
      return "Editing";
    case "delete_file":
      return "Deleting";
    case "list_files":
      return "Listing";
    case "run_bash":
      return "Running";
    case "run_project_script":
      return "Running script";
    case "list_background_tasks":
      return "Listing tasks";
    case "kill_background_task":
      return "Killing task";
    case "open_preview":
      return "Revealing preview";
    case "web_search":
      return "Searching";
    case "fetch_url":
      return "Fetching";
    case "calc":
      return "Calculating";
    default:
      return "Running " + name;
  }
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function SystemPromptView({
  label,
  content,
}: {
  label: string;
  content: string;
}) {
  return (
    <details className="mb-3 rounded-lg border border-white/10 bg-black/20">
      <summary className="cursor-pointer px-3 py-2 text-[12px] font-medium text-ink-300">
        System prompt: {label}
      </summary>
      <pre className="max-h-[420px] overflow-auto border-t border-white/10 px-3 py-2 text-[11px] leading-relaxed text-ink-200">
        {content}
      </pre>
    </details>
  );
}

function ThinkingBlock({
  content,
  inProgress,
}: {
  content: string;
  inProgress: boolean;
}) {
  const [open, setOpen] = useState(inProgress);
  const labelClass = inProgress ? "shimmer-text" : "";
  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-white/5 bg-white/[0.02]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-ink-400 hover:text-ink-100"
      >
        <svg
          viewBox="0 0 12 12"
          className={`h-2.5 w-2.5 transition ${open ? "rotate-90" : ""}`}
          fill="currentColor"
        >
          <path d="M4 2l4 4-4 4V2z" />
        </svg>
        <span className={labelClass}>
          {inProgress ? "Thinking…" : "Thought process"}
        </span>
      </button>
      {open && (
        <div className="whitespace-pre-wrap border-t border-white/5 px-3 py-2 text-[12.5px] leading-relaxed text-ink-400">
          {content}
        </div>
      )}
    </div>
  );
}

function toolLabel(call: ToolCall): { verb: string; target: string } {
  const a = call.args;
  switch (call.name) {
    case "write_file":
      return { verb: "Writing", target: String(a.path ?? "") };
    case "read_file":
      return { verb: "Reading", target: String(a.path ?? "") };
    case "edit_file":
      return { verb: "Editing", target: String(a.path ?? "") };
    case "delete_file":
      return { verb: "Deleting", target: String(a.path ?? "") };
    case "list_files":
      return { verb: "Listing", target: "workspace" };
    case "run_bash":
      return { verb: "Running", target: String(a.command ?? "").slice(0, 80) };
    case "run_project_script":
      return { verb: "Running script", target: String(a.script ?? "") };
    case "list_background_tasks":
      return { verb: "Listing", target: "background tasks" };
    case "kill_background_task":
      return { verb: "Killing task", target: String(a.id ?? "") };
    case "open_preview":
      return { verb: "Opening", target: "preview" };
    case "web_search":
      return { verb: "Searching", target: String(a.query ?? "") };
    case "fetch_url":
      return { verb: "Fetching", target: String(a.url ?? "") };
    case "calc":
      return { verb: "Calculating", target: String(a.expression ?? "") };
    default:
      return { verb: call.name, target: "" };
  }
}

function toolIcon(name: string): string {
  switch (name) {
    case "write_file":
      return "✎";
    case "read_file":
      return "⇠";
    case "edit_file":
      return "✂";
    case "delete_file":
      return "⊗";
    case "list_files":
      return "☰";
    case "run_bash":
      return "▸";
    case "run_project_script":
      return "▸";
    case "list_background_tasks":
      return "☰";
    case "kill_background_task":
      return "■";
    case "open_preview":
      return "◉";
    case "web_search":
      return "⌕";
    case "fetch_url":
      return "↗";
    case "calc":
      return "∑";
    default:
      return "·";
  }
}

function ToolCallView({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const running = !!call.running;
  const { verb, target } = toolLabel(call);
  const ico = toolIcon(call.name);
  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-white/5 bg-white/[0.02]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] text-ink-100 hover:bg-white/[0.02]"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center font-mono text-[13px]">
          {running ? (
            <svg
              className="h-3.5 w-3.5 animate-spin text-white/70"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
                strokeDasharray="40 100"
              />
            </svg>
          ) : call.error ? (
            <span className="text-red-400">×</span>
          ) : (
            <span className="text-emerald-400/90">{ico}</span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className={running ? "shimmer-text" : "text-ink-100"}>
            {running ? `${verb}…` : verb}
          </span>
          {target && (
            <span className="truncate font-mono text-[11.5px] text-ink-400">
              {target}
            </span>
          )}
        </span>
        <svg
          viewBox="0 0 12 12"
          className={`h-2.5 w-2.5 shrink-0 text-ink-400 transition ${open ? "rotate-90" : ""}`}
          fill="currentColor"
        >
          <path d="M4 2l4 4-4 4V2z" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-white/5 px-3 py-2 font-mono text-[11.5px] text-ink-400">
          {call.name === "write_file" &&
          typeof call.args.content === "string" ? (
            <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-words text-ink-200">
              {String(call.args.content).slice(0, 4000)}
              {String(call.args.content).length > 4000 ? "\n…" : ""}
            </pre>
          ) : (
            <div className="mb-1 text-ink-400/80">
              args: {JSON.stringify(call.args).slice(0, 400)}
              {JSON.stringify(call.args).length > 400 ? "…" : ""}
            </div>
          )}
          {call.result && (
            <pre className="mt-2 max-h-[260px] overflow-auto whitespace-pre-wrap break-words text-ink-200">
              {call.result}
            </pre>
          )}
          {call.error && <div className="text-red-400">{call.error}</div>}
        </div>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface PlanTreeNode {
  node: PlanNode;
  children: PlanTreeNode[];
}

function buildPlanTree(nodes: PlanNode[]): PlanTreeNode[] {
  const byId = new Map<string, PlanTreeNode>();
  for (const n of nodes) byId.set(n.id, { node: n, children: [] });
  const roots: PlanTreeNode[] = [];
  for (const n of nodes) {
    const t = byId.get(n.id)!;
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    if (parent) parent.children.push(t);
    else roots.push(t);
  }
  return roots;
}

function planStatusGlyph(status: PlanNode["status"]): string {
  if (status === "ok") return "✓";
  if (status === "failed") return "×";
  return "•";
}

function planStatusColor(status: PlanNode["status"]): string {
  if (status === "ok") return "text-emerald-400";
  if (status === "failed") return "text-red-400";
  return "text-ink-400";
}

function PlanRow({
  tree,
  depth,
  toolCalls,
}: {
  tree: PlanTreeNode;
  depth: number;
  toolCalls: ToolCall[];
}) {
  const { node, children } = tree;
  const running = node.status === "running";
  const isStep = node.kind === "step";
  const isVerify = node.kind === "verify";
  const stepCalls = isStep
    ? toolCalls.filter((tc) => tc.parentStepId === node.id)
    : [];
  const expandable =
    (isStep && !!node.prompt) ||
    (isVerify && (!!node.criterion || !!node.reason));
  const [open, setOpen] = useState(running);

  const label =
    node.kind === "plan"
      ? "Plan"
      : node.kind === "step"
        ? node.name
          ? `Step: ${node.name}`
          : "Step"
        : node.status === "failed"
          ? "Verify: fail"
          : node.status === "ok"
            ? "Verify: pass"
            : "Verify";

  const headerInner = (
    <>
      <span
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center font-mono ${planStatusColor(node.status)}`}
      >
        {running ? (
          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray="40 100"
            />
          </svg>
        ) : (
          <span>{planStatusGlyph(node.status)}</span>
        )}
      </span>
      <span className={running ? "shimmer-text" : "text-ink-100"}>{label}</span>
      {expandable && (
        <svg
          viewBox="0 0 12 12"
          className={`h-2.5 w-2.5 shrink-0 text-ink-400 transition ${open ? "rotate-90" : ""}`}
          fill="currentColor"
        >
          <path d="M4 2l4 4-4 4V2z" />
        </svg>
      )}
    </>
  );

  const bodyPad = (depth + 1) * 14;
  const showDetails = !expandable || open;

  return (
    <>
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 py-0.5 text-left text-[12.5px] hover:bg-white/[0.02]"
          style={{ paddingLeft: depth * 14 }}
        >
          {headerInner}
        </button>
      ) : (
        <div
          className="flex items-center gap-2 py-0.5 text-[12.5px]"
          style={{ paddingLeft: depth * 14 }}
        >
          {headerInner}
        </div>
      )}
      {showDetails && (
        <>
          {isStep && node.prompt && (
            <div style={{ paddingLeft: bodyPad }} className="my-1">
              <div className="rounded-md border border-white/5 bg-black/20 px-2.5 py-1.5">
                <div className="mb-0.5 text-[10.5px] uppercase tracking-wide text-ink-400/80">
                  Prompt
                </div>
                <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-200">
                  {node.prompt}
                </div>
              </div>
            </div>
          )}
          {isVerify && (node.criterion || node.reason) && (
            <div style={{ paddingLeft: bodyPad }} className="my-1">
              <div className="rounded-md border border-white/5 bg-black/20 px-2.5 py-1.5">
                {node.criterion && (
                  <>
                    <div className="mb-0.5 text-[10.5px] uppercase tracking-wide text-ink-400/80">
                      Criterion
                    </div>
                    <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-200">
                      {node.criterion}
                    </div>
                  </>
                )}
                {node.reason && (
                  <>
                    <div className="mb-0.5 mt-2 text-[10.5px] uppercase tracking-wide text-red-400/80">
                      Fail reason
                    </div>
                    <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-red-300">
                      {node.reason}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
      {/* Tool calls stay outside showDetails so repeated actions remain separate timeline bubbles. */}
      {stepCalls.length > 0 && (
        <div style={{ paddingLeft: bodyPad }} className="my-1">
          {stepCalls.map((tc) => (
            <ToolCallView key={tc.id} call={tc} />
          ))}
        </div>
      )}
      {children.map((c) => (
        <PlanRow
          key={c.node.id}
          tree={c}
          depth={depth + 1}
          toolCalls={toolCalls}
        />
      ))}
    </>
  );
}

function PlanView({
  nodes,
  toolCalls,
}: {
  nodes: PlanNode[];
  toolCalls: ToolCall[];
}) {
  const trees = useMemo(() => buildPlanTree(nodes), [nodes]);
  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
      {trees.map((t) => (
        <PlanRow key={t.node.id} tree={t} depth={0} toolCalls={toolCalls} />
      ))}
    </div>
  );
}

function PlanProposalView({
  steps,
  executed,
  onExecute,
}: {
  steps: ProposedStep[];
  executed: boolean;
  onExecute?: () => void;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-amber-300/20 bg-amber-300/[0.04] px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-[12px] font-medium text-amber-200/90">
          {executed ? "Plan approved" : "Proposed plan"}
          <span className="ml-1.5 text-[11px] text-ink-400">
            ({steps.length} {steps.length === 1 ? "step" : "steps"})
          </span>
        </div>
        {!executed && onExecute && (
          <button
            type="button"
            onClick={onExecute}
            className="rounded-md bg-amber-300/15 px-2.5 py-1 text-[11.5px] font-medium text-amber-100 transition hover:bg-amber-300/25"
          >
            Execute Plan
          </button>
        )}
      </div>
      <ol className="flex flex-col gap-0.5">
        {steps.map((s, i) => {
          const open = openIdx === i;
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => setOpenIdx(open ? null : i)}
                className="flex w-full items-center gap-2 py-0.5 text-left text-[12.5px] hover:bg-white/[0.02]"
              >
                <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center font-mono text-ink-400">
                  {i + 1}.
                </span>
                <span className="text-ink-100">{s.name}</span>
                <svg
                  viewBox="0 0 12 12"
                  className={`h-2.5 w-2.5 shrink-0 text-ink-400 transition ${open ? "rotate-90" : ""}`}
                  fill="currentColor"
                >
                  <path d="M4 2l4 4-4 4V2z" />
                </svg>
              </button>
              {open && (
                <div className="my-1 ml-6 rounded-md border border-white/5 bg-black/20 px-2.5 py-1.5">
                  <div className="mb-0.5 text-[10.5px] uppercase tracking-wide text-ink-400/80">
                    Prompt
                  </div>
                  <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-200">
                    {s.prompt}
                  </div>
                  <div className="mb-0.5 mt-2 text-[10.5px] uppercase tracking-wide text-ink-400/80">
                    Verify
                  </div>
                  <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-200">
                    {s.verify}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
