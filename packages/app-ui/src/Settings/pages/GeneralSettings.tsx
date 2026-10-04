import { useState, useEffect } from "react";
import { AlertDialog, Icon, Switch, Button, Card, toast } from "@aphrody/m3-primitives";
import {
  checkForAppUpdate,
  installAppUpdate,
  isTauri,
  tauriInvoke,
  type UpdateMetadata,
} from "../../tauri-bridge";
import { hydratePreferences, updatePreferences } from "../../preferences";

export function GeneralSettings() {
  const [language, setLanguage] = useState("system");
  const [startWithSystem, setStartWithSystem] = useState(false);
  const [keepInTray, setKeepInTray] = useState(true);
  const [openWithDefault, setOpenWithDefault] = useState(true);

  // App updater state
  const [checking, setChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateMetadata | null>(null);
  const [installing, setInstalling] = useState(false);
  const [confirmUpdate, setConfirmUpdate] = useState(false);

  useEffect(() => {
    void hydratePreferences()
      .then((prefs) => {
        setLanguage(prefs.language);
        setStartWithSystem(prefs.startWithSystem);
        setKeepInTray(prefs.keepInTray);
        setOpenWithDefault(prefs.openWithDefault);
        return undefined;
      })
      .catch(() => setUpdateStatus("Préférences indisponibles."));
  }, []);

  const handleLanguageChange = (val: string) => {
    setLanguage(val);
    void updatePreferences({ language: val });
    toast.success("Langue enregistrée");
  };

  const handleStartWithSystemChange = (enabled: boolean) => {
    setStartWithSystem(enabled);
    void updatePreferences({ startWithSystem: enabled });
    if (isTauri()) {
      const cmd = enabled ? "plugin:autostart|enable" : "plugin:autostart|disable";
      void tauriInvoke(cmd).catch(() => {});
    }
  };

  const handleKeepInTrayChange = (enabled: boolean) => {
    setKeepInTray(enabled);
    void updatePreferences({ keepInTray: enabled });
  };

  const handleOpenWithChange = (enabled: boolean) => {
    setOpenWithDefault(enabled);
    void updatePreferences({ openWithDefault: enabled });
  };

  const handleCheckUpdate = async () => {
    setChecking(true);
    setUpdateStatus(null);
    setUpdate(null);
    try {
      const available = await checkForAppUpdate();
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
      await installAppUpdate(update, (received, total) => {
        setUpdateStatus(
          total
            ? `Téléchargement : ${Math.min(100, Math.round((received / total) * 100))}%`
            : `Téléchargement : ${received} octets`,
        );
      });
      setUpdateStatus("Mise à jour installée ; redémarrage demandé.");
      setUpdate(null);
    } catch {
      setUpdateStatus("Installation ou redémarrage impossible. Aucun succès confirmé.");
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
        <h2 className="text-headline-small font-bold text-on-surface">Général</h2>
        <p className="text-body-large text-on-surface-variant mt-1">
          Préférences système et comportement global de l'application.
        </p>
      </div>

      <div className="space-y-6">
        {/* Langue */}
        <Card variant="elevated" className="p-6 border border-outline-variant/30 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-title-medium font-medium text-on-surface">
                Langue de l'interface
              </h3>
              <p className="text-body-large text-on-surface-variant mt-1">
                Choisissez la langue d'affichage des menus et commandes.
              </p>
            </div>
            <select
              value={language}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="h-12 px-4 rounded-medium bg-surface-container-high border border-outline-variant text-on-surface text-label-large font-medium focus:outline-none focus:ring-2 focus:ring-primary min-w-[200px]"
            >
              <option value="system">Système (par défaut)</option>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </div>
        </Card>

        {/* Démarrage et arrière-plan */}
        <Card variant="elevated" className="p-6 border border-outline-variant/30 space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-title-medium font-medium text-on-surface">
                Lancer avec le système
              </h3>
              <p className="text-body-large text-on-surface-variant mt-1">
                Démarrer Aphrody en tâche de fond à l'ouverture de votre session.
              </p>
            </div>
            <Switch
              checked={startWithSystem}
              onCheckedChange={handleStartWithSystemChange}
              aria-label="Lancer avec le système"
            />
          </div>

          <div className="border-t border-outline-variant/30 pt-6 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-title-medium font-medium text-on-surface">
                Conserver dans la zone de notification
              </h3>
              <p className="text-body-large text-on-surface-variant mt-1">
                Laisser l'icône active dans la barre des tâches lors de la fermeture de la fenêtre.
              </p>
            </div>
            <Switch
              checked={keepInTray}
              onCheckedChange={handleKeepInTrayChange}
              aria-label="Conserver dans la zone de notification"
            />
          </div>

          <div className="border-t border-outline-variant/30 pt-6 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-title-medium font-medium text-on-surface">Ouvrir avec Aphrody</h3>
              <p className="text-body-large text-on-surface-variant mt-1">
                Enregistrer Aphrody comme gestionnaire par défaut pour les répertoires et projets.
              </p>
            </div>
            <Switch
              checked={openWithDefault}
              onCheckedChange={handleOpenWithChange}
              aria-label="Ouvrir avec Aphrody"
            />
          </div>
        </Card>

        {/* Mises à jour */}
        <Card variant="elevated" className="p-6 border border-outline-variant/30 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-title-medium font-medium text-on-surface">
                Mise à jour de l'application
              </h3>
              {update && (
                <p className="text-body-large text-on-surface-variant mt-1">
                  Version actuelle :{" "}
                  <span className="font-semibold text-on-surface">{update.currentVersion}</span>
                </p>
              )}
              {updateStatus && (
                <p
                  role="status"
                  className="text-body-large text-on-surface-variant mt-2 flex items-center gap-2"
                >
                  <span>{updateStatus}</span>
                </p>
              )}
            </div>
            <Button
              variant="tonal"
              onClick={() => void handleCheckUpdate()}
              disabled={checking || installing}
              className="h-12 px-6 rounded-medium text-label-large font-medium shrink-0 flex items-center gap-2"
            >
              <Icon name="sync" size={20} className={checking ? "animate-spin" : ""} />
              <span>{checking ? "Vérification..." : "Vérifier les mises à jour"}</span>
            </Button>
            {update && (
              <Button variant="filled" disabled={installing} onClick={() => setConfirmUpdate(true)}>
                {installing ? "Installation…" : "Installer et redémarrer"}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
