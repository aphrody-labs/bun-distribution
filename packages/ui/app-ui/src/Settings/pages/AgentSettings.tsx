import { useState, useEffect } from "react";
import { Icon, Button, Card, toast } from "@aphrody/m3-primitives";
import {
  pickDirectory,
  pickFile,
  getRagStats,
  runRagIndex,
  type RagStats,
} from "../../tauri-bridge";
import { hydratePreferences, updatePreferences, setDefaultModelSetting } from "../../preferences";
import { useChatStore } from "../../stores/chat-store";
import { AgentToolsSettings } from "./AgentToolsSettings";

export function AgentSettings() {
  const [defaultModel, setDefaultModel] = useState("gpt-6-luna");
  const [reasoningEffort, setReasoningEffort] = useState("medium");
  const [accessMode, setAccessMode] = useState("dangerously-bypass");
  const [trustedFolders, setTrustedFolders] = useState<string[]>([]);
  const [binaryPath, setBinaryPath] = useState("aphrody");
  const [ragStats, setRagStats] = useState<RagStats>({ documents: 0, chunks: 0 });
  const [isIndexing, setIsIndexing] = useState(false);

  useEffect(() => {
    void hydratePreferences()
      .then((prefs) => {
        setDefaultModel(prefs.defaultModel);
        setReasoningEffort(prefs.defaultEffort);
        setAccessMode(prefs.accessMode);
        setTrustedFolders(prefs.trustedFolders);
        setBinaryPath(prefs.agentBinary);
        return undefined;
      })
      .catch(() => toast.error("Préférences de l'agent indisponibles."));
    void getRagStats()
      .then(setRagStats)
      .catch(() => toast.error("Statistiques RAG indisponibles."));
  }, []);

  const handleModelChange = (model: string) => {
    setDefaultModel(model);
    void updatePreferences({ defaultModel: model });
    void setDefaultModelSetting(model);
    useChatStore.getState().setModel(model);
    toast.success("Modèle par défaut mis à jour");
  };

  const handleEffortChange = (effort: string) => {
    setReasoningEffort(effort);
    void updatePreferences({ defaultEffort: effort as any });
    toast.success("Niveau d'effort enregistré");
  };

  const handleAccessModeChange = (mode: string) => {
    setAccessMode(mode);
    void updatePreferences({ accessMode: mode as any });
    toast.success("Mode d'accès par défaut enregistré");
  };

  const handleAddFolder = async () => {
    try {
      const selected = await pickDirectory();
      if (selected && !trustedFolders.includes(selected)) {
        const next = [...trustedFolders, selected];
        setTrustedFolders(next);
        void updatePreferences({ trustedFolders: next });
        toast.success("Dossier de confiance ajouté");
      }
    } catch {
      toast.error("Impossible de sélectionner le dossier");
    }
  };

  const handleRemoveFolder = (folder: string) => {
    const next = trustedFolders.filter((f) => f !== folder);
    setTrustedFolders(next);
    void updatePreferences({ trustedFolders: next });
    toast.success("Dossier retiré");
  };

  const handleLocateBinary = async () => {
    try {
      const selected = await pickFile("Sélectionner l'exécutable aphrody");
      if (selected) {
        await updatePreferences({ agentBinary: selected });
        setBinaryPath(selected);
        toast.success("Chemin de l'agent enregistré ; exécution non vérifiée.");
      }
    } catch {
      toast.error("Échec de la localisation");
    }
  };

  const handleReindex = async () => {
    try {
      const selected = await pickDirectory("Sélectionner le dossier à indexer");
      if (selected) {
        setIsIndexing(true);
        toast.info(`Indexation RAG en cours : ${selected.split(/[/\\]/).pop()}...`);
        await runRagIndex({ path: selected, recursive: true });
        const updated = await getRagStats();
        setRagStats(updated);
        toast.success("Indexation RAG terminée avec succès");
      }
    } catch (e) {
      toast.error(`Erreur d'indexation : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsIndexing(false);
    }
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h2 className="text-headline-small font-bold text-on-surface">Agent</h2>
        <p className="text-body-large text-on-surface-variant mt-1">
          Modèle d'intelligence, niveau d'autonomie et répertoires autorisés.
        </p>
      </div>

      <div className="space-y-6">
        {/* Modèle & Raisonnement */}
        <Card variant="elevated" className="p-6 border border-outline-variant/30 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-title-medium font-medium text-on-surface">Modèle par défaut</h3>
              <p className="text-body-large text-on-surface-variant mt-1">
                Modèle de frontière sélectionné à l'ouverture d'un nouveau fil.
              </p>
            </div>
            <select
              value={defaultModel}
              onChange={(e) => handleModelChange(e.target.value)}
              className="h-12 px-4 rounded-medium bg-surface-container-high border border-outline-variant text-on-surface text-label-large font-medium focus:outline-none focus:ring-2 focus:ring-primary min-w-[240px]"
            >
              <option value="gpt-6-luna">⚡ GPT-6 Luna (Recommandé)</option>
              <option value="gpt-6-sol">⚡ GPT-6 Sol (Vitesse)</option>
              <option value="gemini-3.8-flash">⚡ Gemini 3.8 Flash</option>
              <option value="qwen-30b">⚡ Qwen 30B (Local)</option>
            </select>
          </div>

          <div className="border-t border-outline-variant/30 pt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-title-medium font-medium text-on-surface">
                Effort de raisonnement
              </h3>
              <p className="text-body-large text-on-surface-variant mt-1">
                Profondeur de réflexion allouée aux problèmes de code complexes.
              </p>
            </div>
            <select
              value={reasoningEffort}
              onChange={(e) => handleEffortChange(e.target.value)}
              className="h-12 px-4 rounded-medium bg-surface-container-high border border-outline-variant text-on-surface text-label-large font-medium focus:outline-none focus:ring-2 focus:ring-primary min-w-[200px]"
            >
              <option value="none">Aucun</option>
              <option value="low">Faible</option>
              <option value="medium">Moyen (Par défaut)</option>
              <option value="high">Élevé</option>
            </select>
          </div>

          <div className="border-t border-outline-variant/30 pt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-title-medium font-medium text-on-surface">
                Mode d'accès par défaut
              </h3>
              <p className="text-body-large text-on-surface-variant mt-1">
                Politique de bac à sable appliquée pour l'exécution des outils.
              </p>
            </div>
            <select
              value={accessMode}
              onChange={(e) => handleAccessModeChange(e.target.value)}
              className="h-12 px-4 rounded-medium bg-surface-container-high border border-outline-variant text-on-surface text-label-large font-medium focus:outline-none focus:ring-2 focus:ring-primary min-w-[240px]"
            >
              <option value="read-only">Lecture seule</option>
              <option value="workspace-write">Demander avant de modifier</option>
              <option value="dangerously-bypass">Accès complet (Autonome)</option>
            </select>
          </div>
        </Card>

        {/* Dossiers de confiance */}
        <Card variant="elevated" className="p-6 border border-outline-variant/30 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-title-medium font-medium text-on-surface">
                Dossiers de confiance
              </h3>
              <p className="text-body-large text-on-surface-variant mt-1">
                Répertoires de travail autorisés sans sollicitation d'approbation manuelle
                répétitive.
              </p>
            </div>
            <Button
              variant="tonal"
              onClick={() => void handleAddFolder()}
              className="h-12 px-4 rounded-medium text-label-large font-medium shrink-0 flex items-center gap-2"
            >
              <Icon name="add" size={20} />
              <span>Ajouter un dossier</span>
            </Button>
          </div>

          <div className="space-y-2 pt-2">
            {trustedFolders.map((folder) => (
              <div
                key={folder}
                className="flex items-center justify-between p-3 rounded-medium bg-surface-container border border-outline-variant/30 min-h-12"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <Icon name="folder" size={22} className="text-primary shrink-0" />
                  <span className="font-mono text-body-large text-on-surface truncate">
                    {folder}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveFolder(folder)}
                  className="flex size-10 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-error transition-colors"
                  title="Retirer le dossier"
                  aria-label={`Retirer ${folder}`}
                >
                  <Icon name="close" size={20} />
                </button>
              </div>
            ))}
          </div>
        </Card>

        {/* Base de connaissances RAG & Mémoire */}
        <Card variant="elevated" className="p-6 border border-outline-variant/30 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-title-medium font-medium text-on-surface">
                Base de connaissances locale (RAG)
              </h3>
              <p className="text-body-large text-on-surface-variant mt-1">
                Indexation sémantique et vectorielle locale sans connexion réseau externe.
              </p>
            </div>
            <Button
              variant="tonal"
              disabled={isIndexing}
              onClick={() => void handleReindex()}
              className="h-12 px-4 rounded-medium text-label-large font-medium shrink-0 flex items-center gap-2"
            >
              <Icon name="hub" size={20} />
              <span>{isIndexing ? "Indexation..." : "Indexer un dossier"}</span>
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="p-3 rounded-medium bg-surface-container border border-outline-variant/30 text-center">
              <div className="text-headline-small font-bold text-primary">{ragStats.documents}</div>
              <div className="text-label-small text-on-surface-variant mt-0.5">
                Documents indexés
              </div>
            </div>
            <div className="p-3 rounded-medium bg-surface-container border border-outline-variant/30 text-center">
              <div className="text-headline-small font-bold text-primary">{ragStats.chunks}</div>
              <div className="text-label-small text-on-surface-variant mt-0.5">
                Fragments de code
              </div>
            </div>
          </div>
        </Card>

        <AgentToolsSettings />

        {/* Binaire de l'agent */}
        <Card variant="elevated" className="p-6 border border-outline-variant/30 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-title-medium font-medium text-on-surface">Binaire de l'agent</h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-body-large text-on-surface-variant">
                  Chemin configuré · exécution non vérifiée
                </span>
                <span className="font-mono text-body-large text-on-surface">({binaryPath})</span>
              </div>
            </div>
            <Button
              variant="outlined"
              onClick={() => void handleLocateBinary()}
              className="h-12 px-5 rounded-medium text-label-large font-medium shrink-0"
            >
              Localiser
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
