import React, { useEffect, useState } from "react";
import {
  formatModelProvenanceSummary,
  isLocalMlxRuntime,
  type LocalModelDownloadStatus,
  type ModelInfo,
  type ModelProvenance,
  type RemoteCredentialStatus,
  type SetupStatus,
} from "@shared/types";
import gemmaLogoUrl from "../assets/gemma-logo.png";

const ERROR_COPY_CONFIRM_MS = 1500;

interface SetupErrorClipboardApi {
  copyTextToClipboard: (text: string) => Promise<void>;
}

interface RemoteCredentialEditorState {
  credentialStatus: RemoteCredentialStatus | null;
  modal: React.ReactNode;
  openModal: () => void;
}

interface Props {
  models: ModelInfo[];
  status: SetupStatus;
  model: string;
  onModelChange: (m: string) => void;
  onStart: (model: string) => void;
  modelDownloads?: LocalModelDownloadStatus[];
  onDownloadModel?: (model: string) => void;
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

function defaultSetupErrorClipboardApi(): SetupErrorClipboardApi | undefined {
  if (typeof window === "undefined") return undefined;
  return window.api;
}

export async function copySetupErrorToClipboard(
  status: SetupStatus,
  api: SetupErrorClipboardApi | undefined = defaultSetupErrorClipboardApi(),
): Promise<void> {
  const text = setupErrorClipboardText(status);
  if (api) {
    await api.copyTextToClipboard(text);
    return;
  }
  const browserClipboard = globalThis.navigator?.clipboard;
  if (browserClipboard) {
    await browserClipboard.writeText(text);
    return;
  }
  throw new Error("Clipboard is not available.");
}

function useRemoteCredentialEditor(
  selected: ModelInfo | undefined,
): RemoteCredentialEditorState {
  const [credentialStatus, setCredentialStatus] =
    useState<RemoteCredentialStatus | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [keyValue, setKeyValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedModelName = selected?.name;
  const selectedHasEndpoint = selected?.endpoint != null;

  useEffect(() => {
    let cancelled = false;
    setCredentialStatus(null);
    setError(null);
    if (!selectedModelName || !selectedHasEndpoint) return;
    window.api
      .getRemoteCredentialStatus(selectedModelName)
      .then((nextStatus) => {
        if (!cancelled) setCredentialStatus(nextStatus);
      })
      .catch((nextError: unknown) => {
        if (!cancelled) setError(errorMessage(nextError));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedModelName, selectedHasEndpoint]);

  const openModal = (): void => {
    setKeyValue("");
    setError(null);
    setModalOpen(true);
  };

  const closeModal = (): void => {
    if (saving) return;
    setModalOpen(false);
    setKeyValue("");
    setError(null);
  };

  const saveCredential = (): void => {
    if (
      !selectedModelName ||
      !selectedHasEndpoint ||
      keyValue.trim().length === 0
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    window.api
      .saveRemoteCredential({ model: selectedModelName, value: keyValue })
      .then((nextStatus) => {
        setCredentialStatus(nextStatus);
        setModalOpen(false);
        setKeyValue("");
      })
      .catch((nextError: unknown) => {
        setError(errorMessage(nextError));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return {
    credentialStatus,
    openModal,
    modal: (
      <RemoteCredentialModal
        model={selected}
        status={credentialStatus}
        open={modalOpen}
        value={keyValue}
        saving={saving}
        error={error}
        onValueChange={setKeyValue}
        onCancel={closeModal}
        onSave={saveCredential}
      />
    ),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not save API key.";
}

export default function Setup({
  models,
  status,
  model,
  onModelChange,
  onStart,
  modelDownloads = [],
  onDownloadModel,
  onRepairModel,
}: Props) {
  const selected = models.find((candidate) => candidate.name === model);
  const credentialEditor = useRemoteCredentialEditor(selected);
  const isWorking =
    status.stage === "checking" ||
    status.stage === "installing-mlx" ||
    status.stage === "validating-model" ||
    status.stage === "starting-mlx" ||
    status.stage === "repairing-model" ||
    status.stage === "downloading-model" ||
    status.stage === "warming-model";
  const isRepairable = !!status.repair?.model && onRepairModel != null;
  const showsRemoteCredentialAction =
    selected?.endpoint != null &&
    status.stage === "error" &&
    (status.error?.includes(selected.endpoint.apiKeyEnv) ?? false);
  const [copiedError, setCopiedError] = useState(false);

  if (status.stage === "checking" && status.message === "Welcome") {
    return (
      <>
        <WelcomeScreen
          models={models}
          model={model}
          onModelChange={onModelChange}
          onStart={onStart}
          modelDownloads={modelDownloads}
          onDownloadModel={onDownloadModel}
          credentialStatus={credentialEditor.credentialStatus}
          onConfigureCredential={credentialEditor.openModal}
        />
        {credentialEditor.modal}
      </>
    );
  }

  return (
    <>
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
                Preparing the selected model.
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
                      void copySetupErrorToClipboard(status).then(() => {
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
                <div className="mt-3 flex flex-wrap gap-2">
                  {showsRemoteCredentialAction && (
                    <button
                      type="button"
                      onClick={credentialEditor.openModal}
                      className="rounded-md border border-red-200/30 bg-red-200/10 px-3 py-1.5 text-xs text-red-50 hover:bg-red-200/20"
                    >
                      Set API key
                    </button>
                  )}
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
      {credentialEditor.modal}
    </>
  );
}

function WelcomeScreen({
  models,
  model,
  onModelChange,
  onStart,
  modelDownloads,
  onDownloadModel,
  credentialStatus,
  onConfigureCredential,
}: {
  models: ModelInfo[];
  model: string;
  onModelChange: (m: string) => void;
  onStart: (model: string) => void;
  modelDownloads: LocalModelDownloadStatus[];
  onDownloadModel?: (model: string) => void;
  credentialStatus?: RemoteCredentialStatus | null;
  onConfigureCredential: () => void;
}) {
  const selected = models.find((m) => m.name === model) ?? models[0];
  const downloadStatusByModel = new Map(
    modelDownloads.map((status) => [status.model, status]),
  );
  const [modelProvenance, setModelProvenance] = useState<
    Record<string, ModelProvenance>
  >({});

  useEffect(() => {
    let cancelled = false;
    for (const availableModel of models) {
      if (!isLocalMlxRuntime(availableModel.runtime)) continue;
      window.api
        .getModelProvenance(availableModel.name)
        .then((provenance) => {
          if (cancelled || !provenance) return;
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
  }, [models]);

  if (!selected) {
    return (
      <div className="drag flex h-full w-full items-center justify-center px-8">
        <div className="no-drag text-sm text-ink-300">
          No configured models are available.
        </div>
      </div>
    );
  }
  const selectedUsesMlx = isLocalMlxRuntime(selected.runtime);
  const selectedApiKeyEnv = selected.endpoint?.apiKeyEnv;
  const selectedHasCredential = credentialStatus?.hasCredential ?? false;

  return (
    <div className="drag flex h-full w-full flex-col">
      <div className="h-9" />
      <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-6">
        <div className="no-drag flex max-h-full w-full max-w-md flex-col">
          <div className="anim-fade-up mb-5 shrink-0 text-center">
            <GemmaLogo className="mx-auto mb-4 h-20 w-20" />
            <h1 className="text-[26px] font-semibold tracking-tight">
              Welcome to Gemma Code
            </h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-400">
              A coding assistant, powered by configured models.
              <br />
              Local models stay on your Mac; cloud models use configured endpoints.
            </p>
          </div>

          <div className="mb-3 shrink-0 text-[11px] font-medium uppercase tracking-wider text-ink-400">
            Pick a model
          </div>
          <div className="anim-stagger min-h-0 max-h-[min(44vh,360px)] space-y-2 overflow-y-auto pr-1">
            {models.map((m) => {
              const downloadStatus = downloadStatusByModel.get(m.name);
              return (
                <div
                  key={m.name}
                  className={`anim-fade-up group relative w-full rounded-xl border px-4 py-3 text-left transition ${
                    model === m.name
                      ? "border-white/25 bg-white/[0.06]"
                      : "border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => onModelChange(m.name)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-medium">
                            {m.label}
                          </span>
                          {m.recommended && (
                            <span className="shrink-0 rounded-full bg-white/10 px-2 py-[1px] text-[10px] font-medium uppercase tracking-wider text-ink-100">
                              Recommended
                            </span>
                          )}
                        </div>
                        <span className="shrink-0 text-xs tabular-nums text-ink-400">
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
                    <ModelDownloadButton
                      model={m}
                      status={downloadStatus}
                      onDownloadModel={onDownloadModel}
                    />
                  </div>
                  <ModelDownloadProgress status={downloadStatus} />
                </div>
              );
            })}
          </div>

          <button
            onClick={() => onStart(selected.name)}
            className="mt-5 shrink-0 w-full rounded-xl bg-white py-3 text-sm font-medium text-ink-900 transition hover:bg-white/90 active:scale-[0.99]"
          >
            Start with {selected.label} &nbsp;·&nbsp; {selected.size}
          </button>
          {selectedUsesMlx ? (
            <p className="mt-3 shrink-0 text-center text-[11px] text-ink-400">
              We'll install MLX runtime if needed. Model weights are loaded from local cache when available.
            </p>
          ) : (
            <div className="mt-3 flex shrink-0 items-center justify-between gap-3 text-[11px] text-ink-400">
              <span className="min-w-0">
                {selectedApiKeyEnv}{" "}
                {selectedHasCredential
                  ? "is saved for cloud inference."
                  : "is missing for cloud inference."}
              </span>
              <button
                type="button"
                onClick={onConfigureCredential}
                className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-ink-100 hover:bg-white/10"
              >
                Configure API key
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RemoteCredentialModal({
  model,
  status,
  open,
  value,
  saving,
  error,
  onValueChange,
  onCancel,
  onSave,
}: {
  model: ModelInfo | undefined;
  status: RemoteCredentialStatus | null;
  open: boolean;
  value: string;
  saving: boolean;
  error: string | null;
  onValueChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  if (!open || !model?.endpoint) return null;
  const apiKeyEnv = status?.apiKeyEnv ?? model.endpoint.apiKeyEnv;
  const canSave = value.trim().length > 0 && !saving;
  return (
    <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-ink-950 p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink-100">
              Cloud model configuration
            </h2>
            <p className="mt-1 text-xs text-ink-400">{model.label}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-ink-200 hover:bg-white/10"
          >
            Close
          </button>
        </div>
        <label className="mt-4 block text-[11px] font-medium uppercase tracking-wider text-ink-400">
          {apiKeyEnv}
        </label>
        <input
          type="password"
          value={value}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          placeholder={
            status?.hasCredential ? "Saved key present" : "Paste API key"
          }
          className="mt-2 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-500 focus:border-white/30"
        />
        <p className="mt-2 text-[11px] text-ink-500">
          Saved in .env for the Electron app and CLI.
        </p>
        {error && <div className="mt-3 text-xs text-red-300">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-ink-200 hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving" : "Save key"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModelDownloadButton({
  model,
  status,
  onDownloadModel,
}: {
  model: ModelInfo;
  status?: LocalModelDownloadStatus;
  onDownloadModel?: (model: string) => void;
}) {
  if (!isLocalMlxRuntime(model.runtime) || !status || !onDownloadModel) {
    return null;
  }
  if (status.state === "downloaded") {
    return (
      <span className="mt-0.5 shrink-0 rounded-md border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[11px] text-emerald-100">
        Downloaded
      </span>
    );
  }
  if (status.state === "downloading" || status.state === "queued") {
    return (
      <span className="mt-0.5 shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-ink-300">
        Downloading
      </span>
    );
  }
  const label =
    status.state === "incomplete" || status.state === "failed"
      ? "Resume download"
      : "Download";
  return (
    <button
      type="button"
      onClick={() => onDownloadModel(model.name)}
      className="mt-0.5 shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-ink-100 hover:bg-white/10"
    >
      {label}
    </button>
  );
}

function ModelDownloadProgress({
  status,
}: {
  status?: LocalModelDownloadStatus;
}) {
  if (
    !status ||
    status.progress == null ||
    (status.state !== "downloading" &&
      status.state !== "incomplete" &&
      status.state !== "failed")
  ) {
    return null;
  }
  const percent = Math.round(status.progress * 100);
  return (
    <div className="mt-2">
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-white/50"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1 text-[10px] tabular-nums text-ink-500">
        {percent}%
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
