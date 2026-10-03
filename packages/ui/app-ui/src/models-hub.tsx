// SPDX-License-Identifier: Apache-2.0
// Models hub: discover, download, verify, and use local models.
// All typography strictly obeys LOW_VISION floor (>= 18px). No hardware dumps or slop.
import {
  Badge,
  Button,
  Card,
  CircularProgress,
  Divider,
  Icon,
  SearchBar,
  toast,
  Tooltip,
} from "@aphrody/m3-primitives";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  applyProgress,
  type DownloadState,
  entryBytes,
  formatBytes,
  kindLabel,
  normalizeModelKind,
  searchModelCatalog,
  startDownload,
} from "./models-hub-state";
import {
  cancelModelPull,
  type CatalogEntry,
  fetchInstalledModels,
  fetchModelCatalog,
  type InstalledModels,
  onModelPullProgress,
  pullModel,
  removeModel,
  verifyModel,
} from "./tauri-bridge";
import {
  getActiveModelSetting,
  getDefaultModelSetting,
  setActiveModelSetting,
  setDefaultModelSetting,
} from "./preferences";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const TASK_FILTERS: Array<[string, string]> = [
  ["all", "Tous"],
  ["chat", "Chat"],
  ["embedding", "Embedding"],
  ["OCR", "OCR"],
  ["speech", "Speech"],
];

export function ModelsHub() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"installed" | "catalog">("installed");
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [installed, setInstalled] = useState<InstalledModels | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filterKind, setFilterKind] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);

  const refreshStore = useCallback(async () => {
    setLoading(true);
    try {
      const [entries, list] = await Promise.all([
        fetchModelCatalog().catch(() => ({ count: 0, entries: [] })),
        fetchInstalledModels().catch(() => ({ root: "", count: 0, total_bytes: 0, models: [] })),
      ]);
      setCatalog(entries.entries);
      setInstalled(list);
      setLoadError("");
    } catch (error) {
      setLoadError(message(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStore();
    void getActiveModelSetting().then(setActiveModel);
    void getDefaultModelSetting().then(setDefaultModel);

    let stop: (() => void) | undefined;
    let active = true;
    void onModelPullProgress((event) => {
      setDownloads((current) => {
        const state = current[event.id];
        if (!state || state.status !== "downloading") return current;
        return { ...current, [event.id]: applyProgress(state, event, Date.now()) };
      });
    }).then((unlisten) => {
      if (active) stop = unlisten;
      else unlisten();
      return unlisten;
    });

    return () => {
      active = false;
      stop?.();
    };
  }, [refreshStore]);

  const installedModelsList = useMemo(() => installed?.models ?? [], [installed]);
  const installedSet = useMemo(() => {
    const set = new Set<string>();
    for (const m of installedModelsList) {
      if (m.catalog_id) set.add(m.catalog_id);
      if (m.ref) set.add(m.ref);
    }
    return set;
  }, [installedModelsList]);

  const handleUseInChat = async (modelId: string) => {
    await setActiveModelSetting(modelId);
    setActiveModel(modelId);
    toast.success(`Modèle sélectionné pour le chat : ${modelId}`);
    navigate("/", { state: { model: modelId } });
  };

  const handleSetDefault = async (modelId: string) => {
    await setDefaultModelSetting(modelId);
    setDefaultModel(modelId);
    toast.success(`Modèle par défaut défini : ${modelId}`);
  };

  const handleInstall = async (entry: CatalogEntry) => {
    const resumed = downloads[entry.id] ?? null;
    setDownloads((current) => ({
      ...current,
      [entry.id]: resumed
        ? { ...resumed, status: "downloading", error: undefined, sampledAt: Date.now() }
        : startDownload(entryBytes(entry), Date.now()),
    }));
    try {
      const report = await pullModel(entry.id);
      setDownloads((current) => {
        const { [entry.id]: _done, ...rest } = current;
        return rest;
      });
      toast.success(`${entry.title} : ${report.artifacts.length} fichier(s) vérifié(s) (SHA-256)`);
      await refreshStore();
    } catch (error) {
      setDownloads((current) => {
        const state = current[entry.id];
        if (!state) return current;
        const stopped = state.status === "stopped";
        return {
          ...current,
          [entry.id]: {
            ...state,
            status: stopped ? "stopped" : "error",
            error: stopped ? undefined : message(error),
          },
        };
      });
    }
  };

  const handleStopDownload = async (id: string) => {
    setDownloads((current) => {
      const state = current[id];
      return state
        ? { ...current, [id]: { ...state, status: "stopped", speedBps: null, etaSeconds: null } }
        : current;
    });
    try {
      await cancelModelPull(id);
      toast.info("Téléchargement arrêté");
    } catch (error) {
      toast.error(message(error));
    }
  };

  const handleRemove = async (id: string, title: string) => {
    try {
      await removeModel(id);
      toast.success(`${title} supprimé`);
      await refreshStore();
    } catch (error) {
      toast.error(message(error));
    }
  };

  const handleVerify = async (id: string, title: string) => {
    try {
      const report = await verifyModel(id);
      if (report.intact) {
        toast.success(`${title} : intégrité SHA-256 vérifiée`);
      } else {
        toast.error(`${title} : échec de vérification SHA-256`);
      }
    } catch (error) {
      toast.error(message(error));
    }
  };

  const visibleCatalog = useMemo(() => {
    const entries =
      filterKind === "all"
        ? catalog
        : catalog.filter((entry) => normalizeModelKind(entry.task) === filterKind);
    return searchModelCatalog(entries, searchQuery);
  }, [catalog, filterKind, searchQuery]);

  const visibleInstalled = useMemo(() => {
    if (filterKind === "all") return installedModelsList;
    return installedModelsList.filter((m) => {
      const entry = catalog.find((c) => c.id === m.catalog_id || c.id === m.ref);
      const kind = normalizeModelKind(entry?.task ?? m.ref);
      return kind === filterKind;
    });
  }, [installedModelsList, catalog, filterKind]);

  return (
    <section className="flex h-full flex-col gap-6 overflow-auto p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-[28px] font-semibold text-on-surface">Modèles</h1>
          <p className="m-0 mt-1 text-[18px] text-body-large text-on-surface-variant">
            Gérer les modèles locaux et explorer le catalogue.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="tonal"
            className="min-h-[48px] px-4 text-[18px]"
            onClick={() => void refreshStore()}
            disabled={loading}
          >
            <Icon name="refresh" size={20} className={loading ? "animate-spin" : ""} />
            <span>Actualiser</span>
          </Button>
        </div>
      </div>

      {loadError && (
        <Card variant="filled" className="border border-error/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[18px] text-error">{loadError}</span>
            <Button
              variant="text"
              className="min-h-[44px] text-[18px]"
              onClick={() => void refreshStore()}
            >
              <span>Réessayer</span>
            </Button>
          </div>
        </Card>
      )}

      {/* Navigation tabs */}
      <div
        className="flex flex-wrap items-center justify-between gap-4 border-b border-outline-variant/40 pb-3"
        role="tablist"
      >
        <div className="flex items-center gap-2">
          <Button
            variant={activeTab === "installed" ? "filled" : "tonal"}
            className="min-h-[48px] px-5 text-[18px] font-medium"
            onClick={() => setActiveTab("installed")}
            role="tab"
            aria-selected={activeTab === "installed"}
          >
            <Icon name="inventory_2" size={20} />
            <span>Installés</span>
            <Badge
              variant={activeTab === "installed" ? "secondary" : "outline"}
              className="ml-1 text-[16px]"
            >
              {installedModelsList.length}
            </Badge>
          </Button>

          <Button
            variant={activeTab === "catalog" ? "filled" : "tonal"}
            className="min-h-[48px] px-5 text-[18px] font-medium"
            onClick={() => setActiveTab("catalog")}
            role="tab"
            aria-selected={activeTab === "catalog"}
          >
            <Icon name="travel_explore" size={20} />
            <span>Catalogue</span>
            <Badge
              variant={activeTab === "catalog" ? "secondary" : "outline"}
              className="ml-1 text-[16px]"
            >
              {catalog.length}
            </Badge>
          </Button>
        </div>

        {/* Kind Filters */}
        {activeTab === "catalog" && (
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            type="search"
            aria-label="Rechercher un modèle dans le catalogue"
            placeholder="Nom, identifiant ou URL Hugging Face"
          />
        )}
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Filtres par type"
        >
          {TASK_FILTERS.map(([key, label]) => (
            <Button
              key={key}
              variant={filterKind === key ? "filled" : "tonal"}
              className="min-h-[44px] px-3.5 text-[18px]"
              onClick={() => setFilterKind(key)}
            >
              <span>{label}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* TAB 1: INSTALLÉS */}
      {activeTab === "installed" && (
        <div className="flex flex-col gap-4">
          {visibleInstalled.length === 0 ? (
            <Card
              variant="elevated"
              className="flex flex-col items-center justify-center p-8 text-center"
            >
              <Icon
                name="download_for_offline"
                size={48}
                className="mb-3 text-on-surface-variant"
              />
              <h2 className="m-0 text-[20px] font-semibold text-on-surface">
                Aucun modèle installé
              </h2>
              <p className="m-0 mt-2 text-[18px] text-on-surface-variant">
                Parcourez le catalogue pour télécharger des modèles optimisés pour cette machine.
              </p>
              <Button
                variant="filled"
                className="mt-4 min-h-[48px] px-5 text-[18px]"
                onClick={() => setActiveTab("catalog")}
              >
                <Icon name="travel_explore" size={20} />
                <span>Ouvrir le catalogue</span>
              </Button>
            </Card>
          ) : (
            visibleInstalled.map((model) => {
              const catalogEntry = catalog.find(
                (c) => c.id === model.catalog_id || c.id === model.ref,
              );
              const modelId = model.catalog_id || model.ref;
              const title = catalogEntry?.title || model.ref.split("/").pop() || model.ref;
              const kind = normalizeModelKind(catalogEntry?.task ?? model.ref);
              const isDefault = defaultModel === modelId || defaultModel === model.ref;
              const isActiveChat = activeModel === modelId || activeModel === model.ref;

              return (
                <Card
                  key={model.path || model.ref}
                  variant="elevated"
                  className="flex flex-col gap-4 p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="m-0 text-[20px] font-semibold text-on-surface">{title}</h2>
                        <Badge variant="secondary" className="px-3 py-1 text-[18px]">
                          {kindLabel(kind)}
                        </Badge>
                        <Badge variant="accent" className="px-3 py-1 text-[18px]">
                          <Icon name="check_circle" size={18} className="mr-1.5" />
                          Installé
                        </Badge>
                        {isDefault && (
                          <Badge
                            variant="secondary"
                            className="px-3 py-1 text-[18px] font-semibold text-primary"
                          >
                            <Icon name="star" size={18} className="mr-1.5" />
                            Par défaut
                          </Badge>
                        )}
                        {isActiveChat && (
                          <Badge variant="accent" className="px-3 py-1 text-[18px]">
                            <Icon name="chat" size={18} className="mr-1.5" />
                            Actif dans le chat
                          </Badge>
                        )}
                      </div>
                      <span className="text-[18px] text-on-surface-variant font-mono">
                        {modelId} · {model.format?.toUpperCase() || "MODÈLE"}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="text-[18px] font-semibold text-on-surface">
                        {formatBytes(model.bytes)}
                      </span>
                    </div>
                  </div>

                  {catalogEntry?.summary && (
                    <p className="m-0 text-[18px] text-on-surface-variant">
                      {catalogEntry.summary}
                    </p>
                  )}

                  <Divider />

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="filled"
                        className="min-h-[48px] px-4 text-[18px]"
                        onClick={() => void handleUseInChat(modelId)}
                      >
                        <Icon name="chat" size={20} />
                        <span>Utiliser dans le chat</span>
                      </Button>

                      {!isDefault && (
                        <Button
                          variant="tonal"
                          className="min-h-[48px] px-4 text-[18px]"
                          onClick={() => void handleSetDefault(modelId)}
                        >
                          <Icon name="star" size={20} />
                          <span>Définir par défaut</span>
                        </Button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <Tooltip label="Vérifier l'empreinte SHA-256 des fichiers installés">
                        <Button
                          variant="outlined"
                          className="min-h-[48px] px-4 text-[18px]"
                          onClick={() => void handleVerify(modelId, title)}
                        >
                          <Icon name="verified_user" size={20} />
                          <span>Vérifier</span>
                        </Button>
                      </Tooltip>

                      <Button
                        variant="outlined"
                        className="min-h-[48px] px-4 text-[18px] text-error hover:bg-error/10 border-error/40"
                        onClick={() => void handleRemove(modelId, title)}
                      >
                        <Icon name="delete" size={20} />
                        <span>Supprimer</span>
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      )}

      {/* TAB 2: CATALOGUE */}
      {activeTab === "catalog" && (
        <div className="grid gap-4 md:grid-cols-2">
          {visibleCatalog.length === 0 && <p role="status">Aucun modèle dans cette sélection.</p>}
          {visibleCatalog.map((entry) => {
            const size = entryBytes(entry);
            const isInstalled = installedSet.has(entry.id);
            const download = downloads[entry.id];
            const running = download?.status === "downloading";
            const percent = download?.total
              ? Math.min(100, Math.round((download.downloaded / download.total) * 100))
              : null;
            const kind = normalizeModelKind(entry.task);
            const isDefault = defaultModel === entry.id;
            const isActiveChat = activeModel === entry.id;

            return (
              <Card key={entry.id} variant="elevated" className="flex flex-col justify-between p-5">
                <div className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="m-0 text-[20px] font-semibold text-on-surface">
                        {entry.title}
                      </h2>
                      <span className="text-[18px] text-on-surface-variant">
                        {entry.id} · {entry.backend}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="px-3 py-1 text-[18px]">
                        {kindLabel(kind)}
                      </Badge>
                      {isInstalled ? (
                        <Badge variant="accent" className="px-3 py-1 text-[18px]">
                          <Icon name="check_circle" size={18} className="mr-1" />
                          Installé
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="px-3 py-1 text-[18px]">
                          Disponible
                        </Badge>
                      )}
                      {isDefault && (
                        <Badge
                          variant="secondary"
                          className="px-3 py-1 text-[18px] font-semibold text-primary"
                        >
                          <Icon name="star" size={18} className="mr-1.5" />
                          Par défaut
                        </Badge>
                      )}
                      {isActiveChat && (
                        <Badge variant="accent" className="px-3 py-1 text-[18px]">
                          <Icon name="chat" size={18} className="mr-1.5" />
                          Actif dans le chat
                        </Badge>
                      )}
                    </div>
                  </div>

                  <p className="m-0 text-[18px] text-on-surface-variant">{entry.summary}</p>

                  <div className="flex flex-wrap gap-4 text-[18px] text-on-surface">
                    <span>
                      Taille : <strong>{size === null ? "Inconnu" : formatBytes(size)}</strong>
                    </span>
                    {entry.speed && (
                      <span>
                        Vitesse : <strong>{entry.speed}</strong>
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress Ring / Bar when downloading */}
                {download && (
                  <div className="mt-4 flex flex-col gap-2 rounded-xl bg-surface-container p-3 border border-outline-variant/40">
                    <div className="flex items-center gap-3">
                      <CircularProgress
                        radius={20}
                        strokeWidth={4}
                        progress={percent ?? 0}
                        className="text-primary shrink-0"
                      />
                      <div className="flex flex-col">
                        <span className="text-[18px] font-medium text-on-surface">
                          {download.status === "stopped"
                            ? "Téléchargement interrompu"
                            : download.status === "error"
                              ? "Erreur de téléchargement"
                              : percent === null
                                ? "Téléchargement en cours…"
                                : `Téléchargement… ${percent}%`}
                        </span>
                        <span className="text-[18px] text-on-surface-variant">
                          {formatBytes(download.downloaded)}
                          {download.total !== null && ` / ${formatBytes(download.total)}`}
                          {running &&
                            download.speedBps !== null &&
                            ` · ${formatBytes(Math.round(download.speedBps))}/s`}
                          {running &&
                            download.etaSeconds !== null &&
                            ` · ${download.etaSeconds}s restants`}
                        </span>
                      </div>
                    </div>
                    {download.error && (
                      <p className="m-0 text-[18px] text-error">{download.error}</p>
                    )}
                  </div>
                )}

                <Divider className="my-4" />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  {isInstalled ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="filled"
                          className="min-h-[48px] px-4 text-[18px]"
                          onClick={() => void handleUseInChat(entry.id)}
                        >
                          <Icon name="chat" size={20} />
                          <span>Utiliser dans le chat</span>
                        </Button>

                        {!isDefault && (
                          <Button
                            variant="tonal"
                            className="min-h-[48px] px-4 text-[18px]"
                            onClick={() => void handleSetDefault(entry.id)}
                          >
                            <Icon name="star" size={20} />
                            <span>Par défaut</span>
                          </Button>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="outlined"
                          className="min-h-[48px] px-4 text-[18px]"
                          onClick={() => void handleVerify(entry.id, entry.title)}
                        >
                          <Icon name="verified_user" size={20} />
                          <span>Vérifier</span>
                        </Button>

                        <Button
                          variant="outlined"
                          className="min-h-[48px] px-4 text-[18px] text-error hover:bg-error/10 border-error/40"
                          onClick={() => void handleRemove(entry.id, entry.title)}
                        >
                          <Icon name="delete" size={20} />
                          <span>Supprimer</span>
                        </Button>
                      </div>
                    </>
                  ) : running ? (
                    <Button
                      variant="tonal"
                      className="min-h-[48px] px-5 text-[18px]"
                      onClick={() => void handleStopDownload(entry.id)}
                    >
                      <Icon name="pause" size={20} />
                      <span>Arrêter</span>
                    </Button>
                  ) : (
                    <Button
                      variant="filled"
                      className="min-h-[48px] px-5 text-[18px]"
                      onClick={() => void handleInstall(entry)}
                    >
                      <Icon name={download ? "play_arrow" : "download"} size={20} />
                      <span>
                        {download
                          ? "Reprendre"
                          : size === null
                            ? "Télécharger"
                            : `Télécharger (${formatBytes(size)})`}
                      </span>
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
