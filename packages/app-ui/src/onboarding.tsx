// SPDX-License-Identifier: Apache-2.0
// First-run introduction of the quick ask bar. Shown once; the flag lives in `preferences`.
// The last step picks the folder the local models go to (`preferences.modelsDir`, passed to
// every `aphrody` child as APHRODY_MODELS_DIR by crates/ui/app).
import { AphrodyAvatar } from "@aphrody/identity";
import { Button, Icon, Kbd } from "@aphrody/m3-primitives";
import { open } from "@aphrody/tauri/plugins/dialog";
import { useEffect, useState } from "react";
import { fetchModelStoreRoot } from "./tauri-bridge";

const STEPS: Array<{ icon: string; title: string; body: string }> = [
  {
    icon: "auto_awesome",
    title: "Ask from anywhere",
    body: "Press Alt + Space from any app to open Aphrody, type a question and press Enter.",
  },
  {
    icon: "memory",
    title: "Local and open by default",
    body: "Answers come from the open models configured on this machine through the Aphrody app-server. Nothing is sent to a cloud service unless you configure one.",
  },
  {
    icon: "attach_file",
    title: "Bring context",
    body: "Attach files or a screenshot of your screen, reopen past threads from the history, and get instant calculator answers while you type.",
  },
  {
    icon: "folder_open",
    title: "Where models are stored",
    body: "Downloaded models can take several gigabytes. Keep the default folder or pick one on a larger drive.",
  },
];

const MODELS_STEP = STEPS.length - 1;

function ModelsFolder({
  modelsDir,
  onModelsDir,
}: {
  modelsDir: string | null;
  onModelsDir: (dir: string | null) => void;
}) {
  const [root, setRoot] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    // The desktop resolves the root from the saved preference, so re-ask after each change.
    fetchModelStoreRoot()
      .then(path => {
        if (active) {
          setRoot(path);
          setError("");
        }
        return path;
      })
      .catch((e: unknown) => active && setError(String(e)));
    return () => {
      active = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- modelsDir est un déclencheur volontaire : chaque changement de dossier relance la lecture de la racine
  }, [modelsDir]);

  const choose = async () => {
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        title: "Models folder",
      });
      if (typeof picked === "string") onModelsDir(picked);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 break-all font-mono text-body-medium text-on-surface">
        {modelsDir ?? root ?? (error ? "inconnu" : "…")}
      </p>
      {error && <p className="m-0 text-body-small text-error">{error}</p>}
      <div className="flex gap-2">
        <Button variant="tonal" size="sm" onClick={() => void choose()}>
          <Icon name="folder_open" size={18} />
          <span>Choose folder</span>
        </Button>
        {modelsDir && (
          <Button variant="text" size="sm" onClick={() => onModelsDir(null)}>
            Use default
          </Button>
        )}
      </div>
    </div>
  );
}

export function Onboarding({
  modelsDir,
  onModelsDir,
  onDone,
}: {
  modelsDir: string | null;
  onModelsDir: (dir: string | null) => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const current = STEPS[step] ?? STEPS[0]!;
  const last = step === STEPS.length - 1;
  return (
    <section aria-label="Welcome to Aphrody" className="flex flex-col gap-4 rounded-2xl bg-surface-container px-6 py-5">
      <div className="flex items-start gap-4">
        {step === 0 ? (
          <AphrodyAvatar size={48} />
        ) : (
          <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
            <Icon name={current.icon} size={26} />
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="m-0 text-title-large text-on-surface">{current.title}</h2>
          <p className="m-0 text-body-large text-on-surface-variant">{current.body}</p>
          {step === 0 && (
            <p className="m-0 mt-1 flex items-center gap-1">
              <Kbd>Alt</Kbd>+<Kbd>Space</Kbd>
            </p>
          )}
          {step === MODELS_STEP && <ModelsFolder modelsDir={modelsDir} onModelsDir={onModelsDir} />}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((item, index) => (
            <span
              key={item.title}
              className={`h-2 rounded-full ${index === step ? "w-6 bg-primary" : "w-2 bg-outline-variant"}`}
            />
          ))}
        </div>
        <Button aria-label="Skip" title="Skip" variant="text" size="lg" onClick={onDone}>
          <Icon name="skip_next" size={18} />
        </Button>
        <Button variant="filled" size="lg" onClick={() => (last ? onDone() : setStep(step + 1))}>
          {last ? "Start" : "Next"}
        </Button>
      </div>
    </section>
  );
}
