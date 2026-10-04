// SPDX-License-Identifier: Apache-2.0
import { useState, useEffect } from "react";
import { Icon, Switch, Card } from "@aphrody/m3-primitives";
import { applyTheme } from "../../hooks/useTheme";
import { hydratePreferences, updatePreferences } from "../../preferences";
import clsx from "clsx";

const THEMES = [
  { id: "system", name: "Système", icon: "desktop_windows", desc: "S'adapte automatiquement à votre système" },
  { id: "light", name: "Clair", icon: "light_mode", desc: "Surface claire aux contrastes renforcés" },
  { id: "dark", name: "Sombre", icon: "dark_mode", desc: "Surface sombre native avec tonalités neutres" },
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

  useEffect(() => {
    let mounted = true;
    hydratePreferences().then((prefs) => {
      if (!mounted) return;
      setTheme(prefs.theme || "system");
      setReducedMotion(Boolean(prefs.reducedMotion));
      setFontSize(String(prefs.fontSize || 18));
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleThemeChange = (newTheme: "system" | "light" | "dark") => {
    setTheme(newTheme);
    localStorage.setItem("aphrody-theme", newTheme);
    applyTheme(newTheme);
    void updatePreferences({ theme: newTheme });
  };

  const handleReducedMotionChange = (enabled: boolean) => {
    setReducedMotion(enabled);
    localStorage.setItem("aphrody-reduced-motion", String(enabled));
    if (enabled) {
      document.documentElement.classList.add("reduce-motion");
    } else {
      document.documentElement.classList.remove("reduce-motion");
    }
    void updatePreferences({ reducedMotion: enabled });
  };

  const handleFontSizeChange = (size: string) => {
    setFontSize(size);
    localStorage.setItem("aphrody-font-size", size);
    document.documentElement.style.setProperty("--aphrody-base-font-size", `${size}px`);
    void updatePreferences({ fontSize: Number(size) || 18 });
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h2 className="text-headline-small font-bold text-on-surface">Apparence</h2>
        <p className="text-body-large text-on-surface-variant mt-1">
          Personnalisation visuelle et accessibilité de l'interface.
        </p>
      </div>

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
                  type="button"
                  onClick={() => handleThemeChange(t.id)}
                  className={clsx(
                    "flex flex-col items-start p-4 rounded-medium border text-left transition-all cursor-pointer min-h-12",
                    isSelected
                      ? "border-primary bg-secondary-container/40 text-on-surface shadow-xs"
                      : "border-outline-variant/40 bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface"
                  )}
                >
                  <div className="flex items-center justify-between w-full mb-2">
                    <Icon name={t.icon} size={24} className={isSelected ? "text-primary" : "text-on-surface-variant"} />
                    {isSelected && (
                      <span className="size-2.5 rounded-full bg-primary" />
                    )}
                  </div>
                  <span className="text-label-large font-semibold text-on-surface">{t.name}</span>
                  <span className="text-body-large text-on-surface-variant mt-1 line-clamp-2">{t.desc}</span>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Accessibilité & Mouvement */}
        <Card variant="elevated" className="p-6 border border-outline-variant/30 space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-title-medium font-medium text-on-surface">Réduction des animations</h3>
              <p className="text-body-large text-on-surface-variant mt-1">
                Désactive les transitions animées et fige le compagnon sur sa position de repos.
              </p>
            </div>
            <Switch
              checked={reducedMotion}
              onCheckedChange={handleReducedMotionChange}
              aria-label="Réduire les animations"
            />
          </div>

          {/* Plancher Low Vision 18px */}
          <div className="border-t border-outline-variant/30 pt-6 space-y-3">
            <div>
              <h3 className="text-title-medium font-medium text-on-surface">Taille du texte (Profil Low Vision)</h3>
              <p className="text-body-large text-on-surface-variant mt-1">
                Conforme au plancher d'accessibilité de 18 px minimum pour un confort de lecture optimal.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              {FONT_SIZES.map((f) => {
                const isSelected = fontSize === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => handleFontSizeChange(f.id)}
                    className={clsx(
                      "flex items-center justify-between p-4 rounded-medium border text-left transition-all cursor-pointer min-h-12",
                      isSelected
                        ? "border-primary bg-secondary-container/40 text-on-surface font-semibold"
                        : "border-outline-variant/40 bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface"
                    )}
                  >
                    <div>
                      <span className="text-label-large block">{f.label}</span>
                      <span className="text-body-large text-on-surface-variant">{f.desc}</span>
                    </div>
                    {isSelected && (
                      <span className="size-2.5 rounded-full bg-primary shrink-0" />
                    )}
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
