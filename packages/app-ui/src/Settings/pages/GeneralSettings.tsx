// SPDX-License-Identifier: Apache-2.0
import { useState, useEffect, useRef } from "react";
import {
  AlertDialog,
  Icon,
  Switch,
  Button,
  Card,
} from "@aphrody/m3-primitives";
import {
  checkForAppUpdate,
  installAppUpdate,
  isTauri,
  tauriInvoke,
  type UpdateMetadata,
} from "../../tauri-bridge";

export interface GeneralSettingsBackend {
  isDesktop(): boolean;
  readAutostart(): Promise<boolean>;
  writeAutostart(enabled: boolean): Promise<void>;
  checkUpdate(): Promise<UpdateMetadata | null>;
  installUpdate(
    update: UpdateMetadata,
    onProgress: (received: number, total: number | null) => void,
  ): Promise<void>;
}

const backend: GeneralSettingsBackend = {
  isDesktop: isTauri,
  readAutostart: async () => {
    const enabled = await tauriInvoke<boolean>("plugin:autostart|is_enabled");
    if (typeof enabled !== "boolean")
      throw new Error("État de démarrage invalide.");
    return enabled;
  },
  writeAutostart: async (enabled) => {
    await tauriInvoke(
      enabled ? "plugin:autostart|enable" : "plugin:autostart|disable",
    );
  },
  checkUpdate: checkForAppUpdate,
  installUpdate: installAppUpdate,
};

export function GeneralSettings({
  services = backend,
}: { services?: GeneralSettingsBackend } = {}) {
  const desktop = services.isDesktop();
  const [startWithSystem, setStartWithSystem] = useState<boolean | null>(null);
  const [readingAutostart, setReadingAutostart] = useState(desktop);
  const [savingAutostart, setSavingAutostart] = useState(false);
  const [autostartError, setAutostartError] = useState<string | null>(null);
  const [autostartStatus, setAutostartStatus] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const pending = useRef(false);
  const [checking, setChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateMetadata | null>(null);
  const [installing, setInstalling] = useState(false);
  const [confirmUpdate, setConfirmUpdate] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void services
      .readAutostart()
      .then((enabled) => {
        if (active) {
          setStartWithSystem(enabled);
          setReadingAutostart(false);
        }
        return null;
      })
      .catch((error: unknown) => {
        if (active) {
          setStartWithSystem(null);
          setReadingAutostart(false);
          setAutostartError(
            error instanceof Error ? error.message : String(error),
          );
        }
      });
    return () => {
      active = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- reload est un déclencheur explicite de relecture (bouton Réessayer), volontairement absent du corps
  }, [services, desktop, reload]);

  const handleStartWithSystemChange = async (enabled: boolean) => {
    if (pending.current || readingAutostart || startWithSystem === null) return;
    pending.current = true;
    setSavingAutostart(true);
    setAutostartError(null);
    setAutostartStatus(null);
    let written = false;
    try {
      await services.writeAutostart(enabled);
      written = true;
      const actual = await services.readAutostart();
      setStartWithSystem(actual);
      if (actual !== enabled)
        throw new Error("Le système n'a pas confirmé ce changement.");
      setAutostartStatus(
        actual
          ? "Démarrage automatique activé."
          : "Démarrage automatique désactivé.",
      );
    } catch (error) {
      if (written) setStartWithSystem(null);
      setAutostartError(error instanceof Error ? error.message : String(error));
    } finally {
      pending.current = false;
      setSavingAutostart(false);
    }
  };

  const handleCheckUpdate = async () => {
    setChecking(true);
    setUpdateStatus(null);
    setUpdate(null);
    try {
      const available = await services.checkUpdate();
      if (available) {
        setUpdate(available);
        setUpdateStatus(`Version ${available.version} disponible`);
      } else {
        setUpdateStatus("Votre application est à jour.");
      }
    } catch {
      setUpdateStatus(
        "Vérification impossible. Réessayez lorsque le service de mises à jour est accessible.",
      );
    } finally {
      setChecking(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!update || installing) return;
    setInstalling(true);
    try {
      await services.installUpdate(update, (received, total) => {
        setUpdateStatus(
          total
            ? `Téléchargement : ${Math.min(100, Math.round((received / total) * 100))}%`
            : `Téléchargement : ${received} octets`,
        );
      });
      setUpdateStatus("Mise à jour installée ; redémarrage demandé.");
      setUpdate(null);
    } catch {
      setUpdateStatus(
        "Installation ou redémarrage impossible. Aucun succès confirmé.",
      );
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <AlertDialog
        open={confirmUpdate}
        onOpenChange={setConfirmUpdate}
        title={`Installer la version ${update?.version ?? ""} ?`}
        description="L'application redémarrera après vérification et installation. Terminez vos opérations en cours."
        confirmLabel="Installer et redémarrer"
        cancelLabel="Annuler"
        onConfirm={() => void handleInstallUpdate()}
      />
      <div>
        <h2 className="text-headline-small font-bold text-on-surface">
          Général
        </h2>
        <p className="text-body-large text-on-surface-variant mt-1">
          Démarrage et mises à jour de l'application.
        </p>
      </div>
      {!desktop ? (
        <Card
          variant="elevated"
          className="p-6 border border-outline-variant/30"
        >
          <p className="text-body-large text-on-surface-variant">
            Ces réglages système sont disponibles dans l'application de bureau.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card
            variant="elevated"
            className="p-6 border border-outline-variant/30 space-y-4"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-title-medium font-medium text-on-surface">
                  Lancer avec le système
                </h3>
                <p className="text-body-large text-on-surface-variant mt-1">
                  Démarrer Aphrody à l'ouverture de votre session.
                </p>
              </div>
              {startWithSystem !== null && !readingAutostart && (
                <Switch
                  checked={startWithSystem}
                  disabled={savingAutostart}
                  onCheckedChange={(enabled) =>
                    void handleStartWithSystemChange(enabled)
                  }
                  aria-label="Lancer avec le système"
                />
              )}
            </div>
            {readingAutostart && (
              <output className="block">
                Lecture du démarrage automatique…
              </output>
            )}
            {savingAutostart && (
              <output className="block">
                Modification du démarrage automatique…
              </output>
            )}
            {autostartStatus && (
              <output className="block">{autostartStatus}</output>
            )}
            {autostartError && (
              <div role="alert" className="space-y-3 text-error">
                <p>Démarrage automatique indisponible : {autostartError}</p>
                <Button
                  aria-label="Réessayer"
                  title="Réessayer"
                  variant="tonal"
                  disabled={savingAutostart}
                  onClick={() => {
                    setReadingAutostart(true);
                    setAutostartError(null);
                    setReload((value) => value + 1);
                  }}
                >
                  <Icon name="refresh" size={18} />
                </Button>
              </div>
            )}
          </Card>
          <Card
            variant="elevated"
            className="p-6 border border-outline-variant/30 space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-title-medium font-medium text-on-surface">
                  Mise à jour de l'application
                </h3>
                {update && (
                  <p className="text-body-large text-on-surface-variant mt-1">
                    Version actuelle :{" "}
                    <span className="font-semibold text-on-surface">
                      {update.currentVersion}
                    </span>
                  </p>
                )}
                {updateStatus && (
                  <output className="block text-body-large text-on-surface-variant mt-2">
                    {updateStatus}
                  </output>
                )}
              </div>
              <Button
                variant="tonal"
                onClick={() => void handleCheckUpdate()}
                disabled={checking || installing}
                className="h-12 px-6 shrink-0 flex items-center gap-2"
              >
                <Icon
                  name="sync"
                  size={20}
                  className={checking ? "animate-spin" : ""}
                />
                <span>
                  {checking ? "Vérification..." : "Vérifier les mises à jour"}
                </span>
              </Button>
              {update && (
                <Button
                  variant="filled"
                  disabled={installing}
                  onClick={() => setConfirmUpdate(true)}
                >
                  {installing ? "Installation…" : "Installer et redémarrer"}
                </Button>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
