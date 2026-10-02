// SPDX-License-Identifier: Apache-2.0
import { useState, useEffect } from "react";
import { Icon, Button, Card, toast } from "@aphrody/m3-primitives";
import { fetchModelStoreRoot, pickDirectory } from "../../tauri-bridge";
import { hydratePreferences, updatePreferences } from "../../preferences";

export function ModelsSettings() {
  const [storeLocation, setStoreLocation] = useState<string>("~/.aphrody/models");

  useEffect(() => {
    void hydratePreferences().then((prefs) => {
      if (prefs.modelsDir) setStoreLocation(prefs.modelsDir);
    });
    void fetchModelStoreRoot().then((root) => {
      if (root) setStoreLocation(root);
    });
  }, []);

  const handleChangeLocation = async () => {
    try {
      const selected = await pickDirectory();
      if (selected) {
        setStoreLocation(selected);
        void updatePreferences({ modelsDir: selected });
        toast.success("Emplacement des modèles mis à jour");
      }
    } catch {
      toast.error("Impossible de modifier l'emplacement");
    }
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h2 className="text-headline-small font-bold text-on-surface">Modèles</h2>
        <p className="text-body-large text-on-surface-variant mt-1">
          Emplacement du stockage local et accélération matérielle.
        </p>
      </div>

      <div className="space-y-6">
        {/* Emplacement de stockage */}
        <Card variant="elevated" className="p-6 border border-outline-variant/30 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-title-medium font-medium text-on-surface">Emplacement de stockage</h3>
              <p className="text-body-large text-on-surface-variant mt-1">
                Dossier racine hébergeant les poids des modèles GGUF et les embeddings.
              </p>
              <div className="mt-3 p-3 rounded-medium bg-surface-container border border-outline-variant/30 font-mono text-body-large text-on-surface break-all">
                {storeLocation}
              </div>
            </div>
            <Button
              variant="tonal"
              onClick={() => void handleChangeLocation()}
              className="h-12 px-5 rounded-medium text-label-large font-medium shrink-0 flex items-center gap-2 self-start sm:self-center"
            >
              <Icon name="folder_open" size={20} />
              <span>Modifier</span>
            </Button>
          </div>
        </Card>

      </div>
    </div>
  );
}
