// SPDX-License-Identifier: Apache-2.0
import { useState, useEffect } from "react";
import { Icon, Switch, Card } from "@aphrody/m3-primitives";
import { applyAppearance } from "../../hooks/useTheme";
import { hydratePreferences, updatePreferences, type Preferences } from "../../preferences";
import { clsx } from "clsx";

const THEMES = [
  {
    id: "system",
    name: "Système",
    icon: "desktop_windows",
    desc: "S'adapte automatiquement à votre système",
  },
  {
    id: "light",
    name: "Clair",
    icon: "light_mode",
    desc: "Surface claire aux contrastes renforcés",
  },
  {
    id: "dark",
    name: "Sombre",
    icon: "dark_mode",
    desc: "Surface sombre native avec tonalités neutres",
  },
] as const;

const FONT_SIZES = [
  { id: "18", label: "18 px", desc: "Standard (Plancher Low Vision)" },
  { id: "20", label: "20 px", desc: "Confort" },
  { id: "22", label: "22 px", desc: "Grand" },
] as const;

export function AppearanceSettings() {
  const [theme, setTheme] = useState<string>("system");
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);
  const [fontSize, setFontSize] = useState<string>("18");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let mounted = true;
    void hydratePreferences()
      .then((prefs) => {
        if (mounted) {
          setTheme(prefs.theme);
          setReducedMotion(prefs.reducedMotion);
          setFontSize(String(prefs.fontSize));
        }
        return undefined;
      })
      .catch(() => {
        if (mounted) setError("Impossible de charger vos préférences.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- revision est un déclencheur volontaire du rechargement (bouton Recharger), non lu dans l'effet
  }, [revision]);

  const save = async (partial: Partial<Preferences>) => {
    if (saving || loading) return;
    setSaving(true);
    setError("");
    try {
      const prefs = await updatePreferences(partial);
      applyAppearance(prefs);
      setTheme(prefs.theme);
      setReducedMotion(prefs.reducedMotion);
      setFontSize(String(prefs.fontSize));
    } catch {
      setError("Impossible d’enregistrer la modification. Réessayez.");
    } finally {
      setSaving(false);
    }
  };

  const handleThemeChange = (nextTheme: Preferences["theme"]) => {
    void save({ theme: nextTheme });
  };
  const handleReducedMotionChange = (enabled: boolean) => {
    void save({ reducedMotion: enabled });
  };
  const handleFontSizeChange = (size: string) => {
    void save({ fontSize: Number(size) });
  };

  return (
    <div className="space-y-8 max-w-3xl" aria-busy={loading || saving}>
      <div>
        <h2 className="text-headline-small font-bold text-on-surface">Apparence</h2>
        <p className="text-body-large text-on-surface-variant mt-1">
          Personnalisation visuelle et accessibilité de l'interface.
        </p>
      </div>

      {loading && <output className="block">Chargement des préférences…</output>}
      {error && (
        <div role="alert" className="rounded-xl bg-error-container p-4 text-on-error-container">
          <p>{error}</p>
          <button
            type="button"
            className="mt-2 min-h-12 underline"
            onClick={() => {
              setLoading(true);
              setError("");
              setRevision((value) => value + 1);
            }}
          >
            Recharger
          </button>
        </div>
      )}
      <div className="space-y-6">
        {/* Thème */}
        <Card variant="elevated" className="p-6 border border-outline-variant/30 space-y-4">
          <div>
            <h3 className="text-title-medium font-medium text-on-surface">Mode d'affichage</h3>
            <p className="text-body-large text-on-surface-variant mt-1">
              Sélectionnez l'ambiance lumineuse de la station de travail.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            {THEMES.map((t) => {
              const isSelected = theme === t.id;
              return (
                <button
                  key={t.id}
                  disabled={loading || saving}
                  aria-pressed={isSelected}
                  type="button"
                  onClick={() => handleThemeChange(t.id)}
                  className={clsx(
                    "flex flex-col items-start p-4 rounded-medium border text-left transition-all cursor-pointer min-h-12",
                    isSelected
                      ? "border-primary bg-secondary-container/40 text-on-surface shadow-xs"
                      : "border-outline-variant/40 bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface",
                  )}
                >
                  <div className="flex items-center justify-between w-full mb-2">
                    <Icon
                      name={t.icon}
                      size={24}
                      className={isSelected ? "text-primary" : "text-on-surface-variant"}
                    />
                    {isSelected && <span className="size-2.5 rounded-full bg-primary" />}
                  </div>
                  <span className="text-label-large font-semibold text-on-surface">{t.name}</span>
                  <span className="text-body-large text-on-surface-variant mt-1 line-clamp-2">
                    {t.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Accessibilité & Mouvement */}
        <Card variant="elevated" className="p-6 border border-outline-variant/30 space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-title-medium font-medium text-on-surface">
                Réduction des animations
              </h3>
              <p className="text-body-large text-on-surface-variant mt-1">
                Réduit les animations et les transitions de l’interface.
              </p>
            </div>
            <Switch
              checked={reducedMotion}
              disabled={loading || saving}
              onCheckedChange={handleReducedMotionChange}
              aria-label="Réduire les animations"
            />
          </div>

          {/* Plancher Low Vision 18px */}
          <div className="border-t border-outline-variant/30 pt-6 space-y-3">
            <div>
              <h3 className="text-title-medium font-medium text-on-surface">
                Taille du texte (Profil Low Vision)
              </h3>
              <p className="text-body-large text-on-surface-variant mt-1">
                Conforme au plancher d'accessibilité de 18 px minimum pour un confort de lecture
                optimal.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              {FONT_SIZES.map((f) => {
                const isSelected = fontSize === f.id;
                return (
                  <button
                    key={f.id}
                    disabled={loading || saving}
                    aria-pressed={isSelected}
                    type="button"
                    onClick={() => handleFontSizeChange(f.id)}
                    className={clsx(
                      "flex items-center justify-between p-4 rounded-medium border text-left transition-all cursor-pointer min-h-12",
                      isSelected
                        ? "border-primary bg-secondary-container/40 text-on-surface font-semibold"
                        : "border-outline-variant/40 bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface",
                    )}
                  >
                    <div>
                      <span className="text-label-large block">{f.label}</span>
                      <span className="text-body-large text-on-surface-variant">{f.desc}</span>
                    </div>
                    {isSelected && <span className="size-2.5 rounded-full bg-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
