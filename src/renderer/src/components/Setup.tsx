import React, { useEffect, useState } from "react";
import {
  AVAILABLE_MODELS,
  formatModelProvenanceSummary,
  type ModelProvenance,
  type SetupStatus,
} from "@shared/types";
import gemmaLogoUrl from "../assets/gemma-logo.png";

const ERROR_COPY_CONFIRM_MS = 1500;

interface Props {
  status: SetupStatus;
  model: string;
  onModelChange: (m: string) => void;
  onStart: (model: string) => void;
  onRepairModel?: (model: string) => void;
}

function formatBytes(n?: number): string {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function setupErrorClipboardText(status: SetupStatus): string {
  return [
    status.error ? `Error: ${status.error}` : "",
    status.repair?.reason ? `Cause: ${status.repair.reason}` : "",
    status.command ? `Command: ${status.command}` : "",
    status.logFile ? `Log file: ${status.logFile}` : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export default function Setup({
  status,
  model,
  onModelChange,
  onStart,
  onRepairModel,
}: Props) {
  const isWorking =
    status.stage === "checking" ||
    status.stage === "installing-mlx" ||
    status.stage === "validating-model" ||
    status.stage === "starting-mlx" ||
    status.stage === "repairing-model" ||
    status.stage === "downloading-model" ||
    status.stage === "warming-model";
  const isRepairable = !!status.repair?.model && onRepairModel != null;
  const [copiedError, setCopiedError] = useState(false);

  if (status.stage === "checking" && status.message === "Welcome") {
    return (
      <WelcomeScreen
        model={model}
        onModelChange={onModelChange}
        onStart={onStart}
      />
    );
  }

  return (
    <div className="drag flex h-full w-full flex-col">
      <div className="h-9" />
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="no-drag w-full max-w-md">
          <div className="mb-8 text-center">
            <GemmaLogo className="mx-auto mb-5 h-20 w-20" />
            <h1 className="text-[22px] font-semibold tracking-tight">
              Setting things up
            </h1>
            <p className="mt-1.5 text-sm text-ink-400">
              Everything runs locally. Nothing leaves your Mac.
            </p>
          </div>

          <StageList status={status} />

          {isWorking && status.progress != null && (
            <div className="mt-6">
              <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-white/70 transition-[width] duration-200 ease-out"
                  style={{
                    width: `${Math.max(2, Math.round((status.progress ?? 0) * 100))}%`,
                  }}
                />
              </div>
              <div className="mt-2 flex justify-between text-[11px] tabular-nums text-ink-400">
                <span>{Math.round((status.progress ?? 0) * 100)}%</span>
                {status.bytesDone != null && status.bytesTotal != null && (
                  <span>
                    {formatBytes(status.bytesDone)} /{" "}
                    {formatBytes(status.bytesTotal)}
                  </span>
                )}
              </div>
            </div>
          )}

          {status.stage === "error" && (
            <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">Something went wrong</div>
                <button
                  type="button"
                  onClick={() => {
                    const text = setupErrorClipboardText(status);
                    void navigator.clipboard?.writeText(text).then(() => {
                      setCopiedError(true);
                      window.setTimeout(
                        () => setCopiedError(false),
                        ERROR_COPY_CONFIRM_MS,
                      );
                    });
                  }}
                  className="shrink-0 rounded-md border border-red-300/30 bg-red-300/10 px-2 py-1 text-[11px] text-red-100 hover:bg-red-300/20"
                >
                  {copiedError ? "Copied" : "Copy error"}
                </button>
              </div>
              <pre className="selectable mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-red-300/20 bg-black/25 p-2 text-[11px] leading-5 text-red-100">
                {setupErrorClipboardText(status)}
              </pre>
              <div className="mt-3 flex gap-2">
                {!isRepairable && (
                  <button
                    type="button"
                    onClick={() => onStart(model)}
                    className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                  >
                    Try again
                  </button>
                )}
                {isRepairable && (
                  <button
                    type="button"
                    onClick={() => onRepairModel(status.repair!.model)}
                    className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-400/20"
                  >
                    Resume download
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WelcomeScreen({
  model,
  onModelChange,
  onStart,
}: {
  model: string;
  onModelChange: (m: string) => void;
  onStart: (model: string) => void;
}) {
  // Use the first registry entry so the welcome screen follows the validated default model order.
  const selected =
    AVAILABLE_MODELS.find((m) => m.name === model) ?? AVAILABLE_MODELS[0];
  const [modelProvenance, setModelProvenance] = useState<
    Record<string, ModelProvenance>
  >({});

  useEffect(() => {
    let cancelled = false;
    for (const availableModel of AVAILABLE_MODELS) {
      window.api
        .getModelProvenance(availableModel.name)
        .then((provenance) => {
          if (cancelled) return;
          setModelProvenance((current) => ({
            ...current,
            [availableModel.name]: provenance,
          }));
        })
        .catch(() => {
          /* model provenance is optional UI detail */
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="drag flex h-full w-full flex-col">
      <div className="h-9" />
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="no-drag w-full max-w-md">
          <div className="anim-fade-up mb-8 text-center">
            <GemmaLogo className="mx-auto mb-5 h-24 w-24" />
            <h1 className="text-[26px] font-semibold tracking-tight">
              Welcome to Gemma Code
            </h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-400">
              A local AI assistant, powered by Google's Gemma.
              <br />
              Runs 100% on your Mac. No account, no cloud.
            </p>
          </div>

          <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-ink-400">
            Pick a model
          </div>
          <div className="anim-stagger space-y-2">
            {AVAILABLE_MODELS.map((m) => (
              <button
                key={m.name}
                onClick={() => onModelChange(m.name)}
                className={`anim-fade-up group relative w-full rounded-xl border px-4 py-3 text-left transition active:scale-[0.99] ${
                  model === m.name
                    ? "border-white/25 bg-white/[0.06]"
                    : "border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{m.label}</span>
                    {m.recommended && (
                      <span className="rounded-full bg-white/10 px-2 py-[1px] text-[10px] font-medium uppercase tracking-wider text-ink-100">
                        Recommended
                      </span>
                    )}
                  </div>
                  <span className="text-xs tabular-nums text-ink-400">
                    {m.size}
                  </span>
                </div>
                <div className="mt-1 text-[12.5px] leading-snug text-ink-400">
                  {m.description}
                </div>
                <div className="mt-1 text-[11px] leading-snug text-ink-500">
                  {formatModelProvenanceSummary(modelProvenance[m.name]) ||
                    m.size}
                </div>
              </button>
            ))}
          </div>

          <button
            onClick={() => onStart(selected.name)}
            className="mt-6 w-full rounded-xl bg-white py-3 text-sm font-medium text-ink-900 transition hover:bg-white/90 active:scale-[0.99]"
          >
            Start with {selected.label} &nbsp;·&nbsp; {selected.size}
          </button>
          <p className="mt-3 text-center text-[11px] text-ink-400">
            We'll install MLX runtime if needed. Model weights are loaded from
            local cache when available.
          </p>
        </div>
      </div>
    </div>
  );
}

function StageList({ status }: { status: SetupStatus }) {
  const stages: Array<{ key: SetupStatus["stage"]; label: string }> = [
    { key: "installing-mlx", label: "Install MLX runtime" },
    { key: "validating-model", label: "Validate model cache" },
    { key: "starting-mlx", label: "Start runtime" },
    { key: "repairing-model", label: "Resume model download" },
    { key: "downloading-model", label: "Prepare model files" },
    { key: "warming-model", label: "Warm up model" },
    { key: "inference-ready", label: "Model runtime ready" },
    { key: "ready", label: "Ready to chat" },
  ];
  const order: SetupStatus["stage"][] = [
    "checking",
    "installing-mlx",
    "validating-model",
    "starting-mlx",
    "repairing-model",
    "downloading-model",
    "warming-model",
    "inference-ready",
    "ready",
  ];
  const currentIdx = order.indexOf(status.stage);

  return (
    <div className="space-y-3">
      {stages.map((s) => {
        const idx = order.indexOf(s.key);
        const state =
          idx < currentIdx ? "done" : idx === currentIdx ? "active" : "pending";
        return (
          <div key={s.key} className="flex items-center gap-3">
            <StageDot state={state} />
            <div className="flex-1">
              <div
                className={`text-sm transition ${
                  state === "pending"
                    ? "text-ink-400"
                    : state === "active"
                      ? "text-white"
                      : "text-ink-200"
                }`}
              >
                {state === "active" && status.message
                  ? status.message
                  : s.label}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StageDot({ state }: { state: "pending" | "active" | "done" }) {
  if (state === "done") {
    return (
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white/85 text-ink-900">
        <svg
          viewBox="0 0 12 12"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            d="M2.5 6.5l2.5 2.5 4.5-5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    );
  }
  if (state === "active") {
    return (
      <div className="relative flex h-5 w-5 items-center justify-center">
        <div className="absolute inset-0 animate-ping rounded-full bg-white/30" />
        <div className="h-2 w-2 rounded-full bg-white" />
      </div>
    );
  }
  return <div className="h-5 w-5 rounded-full border border-white/15" />;
}

function GemmaLogo({ className }: { className?: string }) {
  return (
    <img
      src={gemmaLogoUrl}
      alt="Gemma"
      className={className}
      draggable={false}
    />
  );
}
