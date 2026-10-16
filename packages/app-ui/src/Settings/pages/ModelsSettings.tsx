// SPDX-License-Identifier: Apache-2.0
import { useCallback, useState, useEffect } from "react";
import { Icon, Button, Card, toast } from "@aphrody/m3-primitives";
import {
  fetchModelStoreRoot,
  getHardwareTelemetry,
  pickDirectory,
  type HardwareTelemetry,
} from "../../tauri-bridge";
import { formatMb } from "../../models-hub-state";
import { hydratePreferences, updatePreferences } from "../../preferences";

export function ModelsSettings() {
  const [storeLocation, setStoreLocation] = useState<string | null>(null);
  const [storeError, setStoreError] = useState("");
  const [hardware, setHardware] = useState<HardwareTelemetry | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const refreshHardware = useCallback(async () => {
    try {
      setHardware(await getHardwareTelemetry());
      setError("");
    } catch {
      setError("Sonde matérielle indisponible.");
    }
  }, []);

  useEffect(() => {
    void hydratePreferences()
      .then((prefs) => {
        if (prefs.modelsDir) setStoreLocation(prefs.modelsDir);
        return undefined;
      })
      .catch(() => setError("Préférences indisponibles."));
    void fetchModelStoreRoot()
      .then((root) => {
        if (root) setStoreLocation(root);
        return undefined;
      })
      .catch(() => setStoreError("Stockage natif indisponible."));
    // oxlint-disable-next-line react/set-state-in-effect -- the hardware probe is awaited before it sets state, so the update runs after the effect returns
    void refreshHardware();
  }, [refreshHardware]);

  const handleChangeLocation = async () => {
    try {
      const selected = await pickDirectory();
      if (selected) {
        setSaving(true);
        await updatePreferences({ modelsDir: selected });
        setStoreLocation(selected);
        toast.success(
          "Dossier enregistré. L'agent l'utilisera au prochain démarrage du backend ; les fichiers existants restent à leur emplacement.",
        );
      }
    } catch {
      toast.error("Impossible de modifier l'emplacement");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h2 className="text-headline-small font-bold text-on-surface">
          Modèles
        </h2>
        <p className="text-body-large text-on-surface-variant mt-1">
          Emplacement du stockage local et accélération matérielle.
        </p>
      </div>

      <div className="space-y-6">
        {(error || storeError) && (
          <p role="alert" className="text-error">
            {error || storeError}
          </p>
        )}
        {/* Emplacement de stockage */}
        <Card
          variant="elevated"
          className="p-6 border border-outline-variant/30 space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-title-medium font-medium text-on-surface">
                Emplacement de stockage
              </h3>
              <p className="text-body-large text-on-surface-variant mt-1">
                Dossier racine hébergeant les poids des modèles GGUF et les
                embeddings.
              </p>
              <div className="mt-3 p-3 rounded-medium bg-surface-container border border-outline-variant/30 font-mono text-body-large text-on-surface break-all">
                {storeLocation ??
                  (storeError
                    ? "Emplacement indisponible"
                    : "Chargement de l’emplacement…")}
              </div>
            </div>
            <Button
              variant="tonal"
              onClick={() => void handleChangeLocation()}
              disabled={saving}
              className="h-12 px-5 rounded-medium text-label-large font-medium shrink-0 flex items-center gap-2 self-start sm:self-center"
            >
              <Icon name="folder_open" size={20} />
              <span>Modifier</span>
            </Button>
          </div>
        </Card>
        <Card variant="elevated" className="p-6 space-y-4">
          <h3 className="text-title-medium">Matériel local</h3>
          <Button variant="tonal" onClick={() => void refreshHardware()}>
            Actualiser la sonde
          </Button>
          {hardware && (
            <dl className="text-body-large space-y-2">
              <div>
                <dt>Threads CPU</dt>
                <dd>{hardware.cpuThreads ?? "inconnu"}</dd>
              </div>
              <div>
                <dt>Mémoire totale</dt>
                <dd>{formatMb(hardware.memoryTotalMb)}</dd>
              </div>
              <div>
                <dt>Mémoire disponible</dt>
                <dd>{formatMb(hardware.memoryAvailableMb)}</dd>
              </div>
              <div>
                <dt>AVX2</dt>
                <dd>
                  {hardware.avx2 === null
                    ? "inconnu"
                    : hardware.avx2
                      ? "oui"
                      : "non"}
                </dd>
              </div>
              <div>
                <dt>VRAM CUDA</dt>
                <dd>{formatMb(hardware.cudaVramTotalMb)}</dd>
              </div>
            </dl>
          )}
        </Card>
      </div>
    </div>
  );
}
