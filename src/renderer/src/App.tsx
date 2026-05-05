import { useEffect, useState } from "react";
import { DEFAULT_MODEL, type SetupStatus } from "@shared/types";
import Setup from "./components/Setup";
import Chat from "./components/Chat";
import {
  pickStartupModel,
  readPersistedConversations,
} from "./lib/conversationStore";

type AppState =
  | { phase: "boot" }
  | { phase: "setup"; status: SetupStatus; model: string }
  | { phase: "ready"; model: string }
  | { phase: "switching"; model: string; toModel: string; status: SetupStatus };
type RepairCapableApi = typeof window.api & {
  repairModel?: (model: string) => Promise<void>;
};

export default function App() {
  const [state, setState] = useState<AppState>({ phase: "boot" });

  function handleRepairModel(model: string): void {
    setState((prev) => {
      if (prev.phase === "setup") {
        return {
          phase: "setup",
          model,
          status: {
            stage: "repairing-model",
            message: "Resuming model download…",
          },
        };
      }
      if (prev.phase === "ready") {
        return {
          phase: "setup",
          model,
          status: {
            stage: "repairing-model",
            message: "Resuming model download…",
          },
        };
      }
      if (prev.phase === "switching") {
        return {
          ...prev,
          status: {
            stage: "repairing-model",
            message: "Resuming model download…",
          },
        };
      }
      return prev;
    });
    const api = window.api as RepairCapableApi;
    if (typeof api.repairModel === "function") {
      void api.repairModel(model);
      return;
    }
    void window.api.startSetup(model);
  }

  useEffect(() => {
    // Forward raw Gemma output to devtools console for debugging
    const rawUnsub = window.api.onRawChunk((ev) => {
      // eslint-disable-next-line no-console
      console.log("[gemma]", ev.chunk);
    });
    let unsub: (() => void) | undefined;
    (async () => {
      unsub = window.api.onSetupStatus((status) => {
        setState((prev) => {
          if (status.stage === "ready") {
            // If we were switching, the new model is now ready
            if (prev.phase === "switching") {
              return { phase: "ready", model: prev.toModel };
            }
            return {
              phase: "ready",
              model: prev.phase === "setup" ? prev.model : DEFAULT_MODEL,
            };
          }
          if (status.stage === "error") {
            if (status.repair) {
              return { phase: "setup", status, model: status.repair.model };
            }
            // If switch failed, go back to the previous model
            if (prev.phase === "switching") {
              return { phase: "ready", model: prev.model };
            }
          }
          // If we're in switching phase, keep it as switching
          if (prev.phase === "switching") {
            return { ...prev, status };
          }
          const model = prev.phase === "setup" ? prev.model : DEFAULT_MODEL;
          return { phase: "setup", status, model };
        });
      });

      const local = await window.api.listLocalModels();
      const isLocallyAvailable = (model: string): boolean =>
        local.some((m) => m === model || m.startsWith(model + ":"));

      // Prefer the model the most-recently used conversation was sent with,
      // so reopening the app lands on the model the user was last working
      // with. Fall back to DEFAULT_MODEL when no conversation has stamped a
      // model yet (first launch). The Setup welcome screen and the in-chat
      // model picker remain reachable as a safe-mode fallback when the
      // chosen model isn't locally available.
      const stamped = pickStartupModel(readPersistedConversations());
      const startupModel =
        stamped && isLocallyAvailable(stamped) ? stamped : DEFAULT_MODEL;

      if (isLocallyAvailable(startupModel)) {
        const { hasMLX } = await window.api.checkMLX();
        if (hasMLX) {
          setState({
            phase: "setup",
            status: {
              stage: "starting-mlx",
              message: "Starting model runtime…",
            },
            model: startupModel,
          });
          window.api.startSetup(startupModel);
          return;
        }
      }
      setState({
        phase: "setup",
        status: { stage: "checking", message: "Welcome" },
        model: startupModel,
      });
    })();
    return () => {
      unsub?.();
      rawUnsub?.();
    };
  }, []);

  function handleSwitchModel(newModel: string): void {
    setState((prev) => {
      if (prev.phase !== "ready") return prev;
      if (prev.model === newModel) return prev;
      return {
        phase: "switching",
        model: prev.model,
        toModel: newModel,
        status: { stage: "downloading-model", message: "Switching model…" },
      };
    });
    window.api.switchModel(newModel);
  }

  if (state.phase === "boot") {
    return <BootSplash />;
  }

  if (state.phase === "setup") {
    return (
      <div key="setup" className="anim-fade-in h-full w-full">
        <Setup
          status={state.status}
          model={state.model}
          onModelChange={(m) =>
            setState((s) => (s.phase === "setup" ? { ...s, model: m } : s))
          }
          onStart={(model) => {
            setState({
              phase: "setup",
              status: { stage: "checking", message: "Checking system…" },
              model,
            });
            window.api.startSetup(model);
          }}
          onRepairModel={handleRepairModel}
        />
      </div>
    );
  }

  if (state.phase === "switching") {
    return (
      <div key="switching" className="anim-fade-in h-full w-full">
        <Chat model={state.model} onSwitchModel={handleSwitchModel} />
        <SwitchingOverlay status={state.status} />
      </div>
    );
  }

  return (
    <div key="chat" className="anim-fade-scale h-full w-full">
      <Chat model={state.model} onSwitchModel={handleSwitchModel} />
    </div>
  );
}

function BootSplash() {
  return (
    <div className="drag flex h-full w-full items-center justify-center">
      <div className="shimmer h-1 w-40 rounded-full" />
    </div>
  );
}

function SwitchingOverlay({ status }: { status: SetupStatus }) {
  return (
    <div className="anim-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="anim-fade-up flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-ink-950 px-10 py-8 shadow-2xl">
        <div className="shimmer h-1 w-32 rounded-full" />
        <p className="text-sm text-ink-200">{status.message}</p>
        {status.progress != null && status.progress > 0 && (
          <div className="w-48">
            <div className="h-1 w-full rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-white/60 transition-all duration-500"
                style={{ width: `${Math.round(status.progress * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-center text-[10px] text-ink-400">
              {Math.round(status.progress * 100)}%
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
