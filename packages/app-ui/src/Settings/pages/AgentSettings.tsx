// SPDX-License-Identifier: Apache-2.0
import { useState, useEffect, useRef } from "react";
import {
  Icon,
  Button,
  Card,
  toast,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@aphrody/m3-primitives";
import { aphrodyRpc, ensureAphrodyInitialized, pickDirectory } from "../../tauri-bridge";
import { hydratePreferences, updatePreferences, setDefaultModelSetting, type Preferences } from "../../preferences";
import { useChatStore } from "../../stores/chat-store";
import { AgentToolsSettings } from "./AgentToolsSettings";

interface AgentModel {
  id: string;
  name: string;
}

export interface AgentSettingsBackend {
  initialize(): Promise<void>;
  models(): Promise<Record<string, unknown>>;
  preferences(): Promise<Preferences>;
  save(partial: Partial<Preferences>): Promise<Preferences>;
  saveDefaultModel(model: string): Promise<void>;
  chooseDirectory(): Promise<string | null>;
}

const backend: AgentSettingsBackend = {
  initialize: ensureAphrodyInitialized,
  models: () => aphrodyRpc("model/list"),
  preferences: hydratePreferences,
  save: updatePreferences,
  saveDefaultModel: setDefaultModelSetting,
  chooseDirectory: pickDirectory,
};

function readModels(response: Record<string, unknown>): AgentModel[] {
  if (!Array.isArray(response.data)) throw new Error("Invalid model catalog");
  const seen = new Set<string>();
  return response.data.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid model catalog entry");
    const model = entry as Record<string, unknown>;
    if (typeof model.id !== "string" || !model.id.trim()) throw new Error("Invalid model identifier");
    if (seen.has(model.id)) return [];
    seen.add(model.id);
    return [
      {
        id: model.id,
        name: typeof model.displayName === "string" && model.displayName.trim() ? model.displayName : model.id,
      },
    ];
  });
}

export function AgentSettings({
  services = backend,
  notify = toast,
}: {
  services?: AgentSettingsBackend;
  notify?: Pick<typeof toast, "success" | "error">;
} = {}) {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [models, setModels] = useState<AgentModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    // oxlint-disable-next-line react/set-state-in-effect -- réinitialisation de l'état de chargement à chaque changement de services ou de reload, synchronisation avec une source externe
    setLoading(true);
    setLoadError(false);
    void Promise.all([
      services.preferences(),
      (async () => {
        await services.initialize();
        return readModels(await services.models());
      })(),
    ])
      .then(([stored, catalog]) => {
        if (!active) return null;
        setPreferences(stored);
        setModels(catalog);
        return null;
      })
      .catch((error: unknown) => {
        console.warn("Agent settings load failed", error);
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- reload est un déclencheur volontaire du rechargement (boutons Réessayer), non lu dans l'effet
  }, [services, reload]);

  const commit = async (partial: Partial<Preferences>, message: string) => {
    const stored = await services.save(partial);
    if (partial.defaultModel !== undefined) await services.saveDefaultModel(partial.defaultModel);
    setPreferences(stored);
    if (partial.defaultModel !== undefined) useChatStore.getState().setModel(stored.defaultModel);
    if (partial.defaultEffort !== undefined) useChatStore.getState().setEffort(stored.defaultEffort);
    if (partial.accessMode !== undefined)
      useChatStore
        .getState()
        .setAccessMode(
          stored.accessMode === "read-only" ? "readonly" : stored.accessMode === "workspace-write" ? "ask" : "full",
        );
    notify.success(message);
  };

  const perform = async (action: () => Promise<void>) => {
    if (pending.current || !preferences) return;
    pending.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      await action();
    } catch (error: unknown) {
      console.warn("Agent preference save failed", error);
      setSaveError(true);
      notify.error("Enregistrement impossible. Réessayez.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const saveModel = (model: string) => {
    if (!models.some(entry => entry.id === model)) return;
    void perform(() => commit({ defaultModel: model }, "Modèle par défaut enregistré."));
  };

  const addFolder = () =>
    void perform(async () => {
      const selected = await services.chooseDirectory();
      if (!selected || preferences!.trustedFolders.includes(selected)) return;
      await commit({ trustedFolders: [...preferences!.trustedFolders, selected] }, "Dossier de confiance ajouté.");
    });

  return (
    <div className="max-w-3xl space-y-8" aria-busy={loading || saving}>
      <h2 className="text-headline-small font-bold text-on-surface">Agent</h2>
      {loading && <output className="block">Chargement des préférences…</output>}
      {!loading && loadError && (
        <div className="space-y-3">
          <p role="alert" className="text-error">
            Préférences indisponibles.
          </p>
          <Button
            aria-label="Réessayer"
            title="Réessayer"
            variant="tonal"
            onClick={() => setReload(value => value + 1)}
          >
            <Icon name="refresh" size={18} />
          </Button>
        </div>
      )}
      {!loading && !loadError && preferences && (
        <div className="space-y-6">
          {saveError && (
            <p role="alert" className="text-error">
              Enregistrement impossible. Réessayez.
            </p>
          )}
          <Card variant="elevated" className="space-y-6 border border-outline-variant/30 p-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <h3 className="text-title-medium font-medium text-on-surface">Modèle par défaut</h3>
              {models.length > 0 ? (
                <DropdownMenuRoot>
                  <DropdownMenuTrigger
                    disabled={saving}
                    aria-label="Modèle par défaut"
                    className="flex h-12 min-w-[240px] items-center justify-between gap-3 rounded-medium border border-outline-variant bg-surface-container-high px-4 text-label-large text-on-surface"
                  >
                    {models.find(entry => entry.id === preferences.defaultModel)?.name ?? "Choisir un modèle"}
                    <Icon name="expand_more" size={20} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuRadioGroup value={preferences.defaultModel} onValueChange={saveModel}>
                      {models.map(model => (
                        <DropdownMenuRadioItem key={model.id} value={model.id} disabled={saving}>
                          {model.name}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenuRoot>
              ) : (
                <div className="space-y-2">
                  <output className="block">Aucun modèle disponible.</output>
                  <Button
                    aria-label="Réessayer"
                    title="Réessayer"
                    variant="tonal"
                    disabled={saving}
                    onClick={() => setReload(value => value + 1)}
                  >
                    <Icon name="refresh" size={18} />
                  </Button>
                </div>
              )}
            </div>
            <div className="flex flex-col justify-between gap-4 border-t border-outline-variant/30 pt-6 sm:flex-row sm:items-center">
              <h3 className="text-title-medium font-medium text-on-surface">Effort de raisonnement</h3>
              <select
                aria-label="Effort de raisonnement"
                value={preferences.defaultEffort}
                disabled={saving}
                onChange={event =>
                  void perform(() =>
                    commit(
                      {
                        defaultEffort: event.target.value as Preferences["defaultEffort"],
                      },
                      "Niveau d'effort enregistré.",
                    ),
                  )
                }
                className="h-12 min-w-[200px] rounded-medium border border-outline-variant bg-surface-container-high px-4 text-label-large text-on-surface"
              >
                <option value="none">Aucun</option>
                <option value="low">Faible</option>
                <option value="medium">Moyen</option>
                <option value="high">Élevé</option>
              </select>
            </div>
            <div className="flex flex-col justify-between gap-4 border-t border-outline-variant/30 pt-6 sm:flex-row sm:items-center">
              <h3 className="text-title-medium font-medium text-on-surface">Mode d'accès par défaut</h3>
              <select
                aria-label="Mode d'accès par défaut"
                value={preferences.accessMode}
                disabled={saving}
                onChange={event =>
                  void perform(() =>
                    commit(
                      {
                        accessMode: event.target.value as Preferences["accessMode"],
                      },
                      "Mode d'accès enregistré.",
                    ),
                  )
                }
                className="h-12 min-w-[240px] rounded-medium border border-outline-variant bg-surface-container-high px-4 text-label-large text-on-surface"
              >
                <option value="read-only">Lecture seule</option>
                <option value="workspace-write">Demander avant de modifier</option>
                <option value="dangerously-bypass">Accès complet</option>
              </select>
            </div>
          </Card>
          <Card variant="elevated" className="space-y-4 border border-outline-variant/30 p-6">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-title-medium font-medium text-on-surface">Dossiers de confiance</h3>
              <Button variant="tonal" disabled={saving} onClick={addFolder}>
                <Icon name="add" size={20} /> Ajouter un dossier
              </Button>
            </div>
            {preferences.trustedFolders.map(folder => (
              <div
                key={folder}
                className="flex min-h-12 items-center justify-between gap-3 rounded-medium border border-outline-variant/30 bg-surface-container p-3"
              >
                <span className="truncate text-body-large text-on-surface">{folder}</span>
                <button
                  type="button"
                  disabled={saving}
                  aria-label={`Retirer ${folder}`}
                  onClick={() =>
                    void perform(() =>
                      commit(
                        {
                          trustedFolders: preferences.trustedFolders.filter(entry => entry !== folder),
                        },
                        "Dossier retiré.",
                      ),
                    )
                  }
                  className="flex size-10 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
                >
                  <Icon name="close" size={20} />
                </button>
              </div>
            ))}
          </Card>
          <AgentToolsSettings />
        </div>
      )}
    </div>
  );
}
