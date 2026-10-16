"use client";

/** Éditeur du thème global, composé comme une couverture de tankōbon mesurée. */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DragonBallLoader } from "@/components/DragonBall";
import { Enregistrer, Palette, Reinitialiser } from "@shenron/ui/icones";
import { BancNuages, CadreCase, Etoile, PastilleTome } from "@/components/MotifsCouverture";
import {
  DEFAULT_SITE_THEME,
  THEME_COLORS,
  THEME_COLOR_VARS,
  type SiteTheme,
  type ThemeColorKey,
} from "../../../lib/site-theme";
import {
  DragonBallSphere,
  DragonRadarDisplay,
  EmblemCapsuleCorp,
  EmblemDemon,
  EmblemGo,
  EmblemKai,
  EmblemKame,
  EmblemMajin,
  EmblemRedRibbon,
  EmblemTenkaichi,
  EmblemVegetaRoyal,
  KiAura,
  KintoUnCloud,
  ScouterHudOverlay,
  ToriyamaBadge,
  ToriyamaPanel,
  ToriyamaProgress,
  ToriyamaSlider,
  ToriyamaSpeechBubble,
} from "@/components/ui";
import styles from "./DesignEditor.module.css";

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const GROUPS: readonly { title: string; keys: readonly ThemeColorKey[] }[] = [
  { title: "Signature imprimée", keys: ["orange", "yellow", "red"] },
  {
    title: "Papier et surfaces",
    keys: ["bg", "card", "border", "blue", "blueLight"],
  },
  { title: "Énergie et états", keys: ["orangeDark", "ember", "ki", "amber"] },
];

async function loadTheme(): Promise<{ theme: SiteTheme }> {
  const response = await fetch("/api/theme-config", {
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function saveTheme(theme: SiteTheme): Promise<{ ok: boolean; theme: SiteTheme }> {
  const response = await fetch("/api/theme-config", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(theme),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json();
}

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.slice(1);
  const expanded = clean.length === 3 ? [...clean].map(character => character + character).join("") : clean.slice(0, 6);
  if (expanded.length !== 6 || !/^[0-9a-f]{6}$/i.test(expanded)) return null;
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

function contrast(foreground: string, background: string): number | null {
  const luminance = (hex: string) => {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    const channelLuminance = (channel: number) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return channelLuminance(rgb[0]) * 0.2126 + channelLuminance(rgb[1]) * 0.7152 + channelLuminance(rgb[2]) * 0.0722;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  if (a == null || b == null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function themeStyle(theme: SiteTheme): CSSProperties {
  const variables = Object.fromEntries(
    (Object.keys(THEME_COLOR_VARS) as ThemeColorKey[]).map(key => [THEME_COLOR_VARS[key], theme.colors[key]]),
  );
  return { ...variables, "--radius": `${theme.radius}rem` } as CSSProperties;
}

function ColorRow({
  colorKey,
  value,
  onChange,
}: {
  colorKey: ThemeColorKey;
  value: string;
  onChange: (value: string) => void;
}) {
  const meta = THEME_COLORS.find(color => color.key === colorKey)!;
  const valid = HEX.test(value.trim());
  const pickerValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  const inputId = `theme-${colorKey}`;
  const hintId = `${inputId}-hint`;
  return (
    <div className={styles.colorRow} style={{ "--swatch": valid ? value : "transparent" } as CSSProperties}>
      <input
        type="color"
        value={pickerValue}
        onChange={event => onChange(event.target.value)}
        className={styles.picker}
        aria-label={`Choisir ${meta.label.toLowerCase()}`}
      />
      <div>
        <label className={styles.colorLabel} htmlFor={inputId}>
          {meta.label}
        </label>
        <span id={hintId} className={styles.colorHint}>
          {meta.hint}
        </span>
      </div>
      <input
        id={inputId}
        value={value}
        onChange={event => onChange(event.target.value)}
        className={styles.hexInput}
        spellCheck={false}
        aria-describedby={hintId}
        aria-invalid={!valid}
      />
    </div>
  );
}

function Preview({ theme }: { theme: SiteTheme }) {
  const checks = [
    ["Orange / fond", contrast(theme.colors.orange, theme.colors.bg)],
    ["Jaune / fond", contrast(theme.colors.yellow, theme.colors.bg)],
    ["Texte / surface", contrast(theme.colors.blueLight, theme.colors.card)],
  ] as const;
  return (
    <section className={styles.previewPane} style={themeStyle(theme)} aria-labelledby="theme-preview-title">
      <h2 id="theme-preview-title" className={styles.previewLabel}>
        <Etoile taille={12} className="text-[var(--color-etoile-rouge)]" /> Épreuve avant impression
      </h2>
      <div className={styles.cover}>
        <BancNuages hauteur={52} opacite={0.88} />
        <div className={styles.coverTop}>
          <h3 className={styles.wordmark} aria-label="Dragon Ball France">
            <span className={styles.wordmarkYellow}>DRAGON</span>
            <span className={styles.wordmarkRed}>BALL</span>
          </h3>
          <p className={styles.coverIntro}>
            Le brouillon applique les douze jetons sans modifier le site. Les aplats, l'encre et le cadre reprennent les
            mesures de la couverture de référence.
          </p>
        </div>
        <CadreCase largeur={620} className={styles.sceneFrame}>
          <div className={styles.scene}>
            <div className={styles.sceneCopy}>
              <h3>Une palette qui tient le combat</h3>
              <p>Surfaces, accent principal, texte secondaire et énergie sont montrés ensemble.</p>
              <div className={styles.previewActions}>
                <span className={styles.previewPrimary}>Action principale</span>
                <span className={styles.previewSecondary}>Action secondaire</span>
              </div>
            </div>
          </div>
        </CadreCase>
        <PastilleTome numero="DB" taille={58} className={styles.volumeBadge} decorative />
        <div className={styles.checks} aria-label="Contrastes de la palette">
          {checks.map(([label, ratio]) => {
            const passes = ratio != null && ratio >= 4.5;
            return (
              <div className={styles.check} key={label}>
                <strong>{ratio == null ? "—" : `${ratio.toFixed(2)}:1`}</strong>
                <span>
                  {label} · {passes ? "AA texte" : "grand texte / décor"}
                </span>
              </div>
            );
          })}
        </div>

        {/* Toriyama Reusable UI & SVG Vector Stack Showcase */}
        <div className="mt-8 pt-6 border-t-2 border-dashed border-[var(--color-border)] flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-black text-sm uppercase tracking-wider flex items-center gap-2 text-[var(--color-toriyama-orange,#f85b1a)]">
              <DragonBallSphere stars={4} size={20} decorative />
              Stack Vectorielle & UI Toriyama Officielle
            </h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--color-card)] border border-[var(--color-border)]">
              @shenron/ui
            </span>
          </div>

          {/* Official Emblems Grid */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-[var(--color-muted-foreground)] uppercase">
              Emblèmes & Sceaux Officiels (Akira Toriyama)
            </span>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 p-3 bg-[var(--color-card)] border-2 border-[var(--color-toriyama-ink,#121417)] shadow-[3px_3px_0px_var(--color-toriyama-ink,#121417)]">
              <div className="flex flex-col items-center gap-1">
                <EmblemKame size={40} />
                <span className="text-[10px] font-bold">Kame (龜)</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <EmblemGo size={40} />
                <span className="text-[10px] font-bold">Goku (悟)</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <EmblemKai size={40} />
                <span className="text-[10px] font-bold">Kaio (界)</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <EmblemDemon size={40} />
                <span className="text-[10px] font-bold">Piccolo (魔)</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <EmblemCapsuleCorp size={40} />
                <span className="text-[10px] font-bold">Capsule Corp</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <EmblemRedRibbon size={40} />
                <span className="text-[10px] font-bold">Red Ribbon</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <EmblemMajin size={40} />
                <span className="text-[10px] font-bold">Majin (M)</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <EmblemTenkaichi size={40} />
                <span className="text-[10px] font-bold">Budokai (武)</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <EmblemVegetaRoyal size={40} />
                <span className="text-[10px] font-bold">Vegeta Royal</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <DragonBallSphere stars={7} size={40} glow />
                <span className="text-[10px] font-bold">7 Etoiles</span>
              </div>
            </div>
          </div>

          {/* Interactive Controls & HUD */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Scouter HUD Panel */}
            <ToriyamaPanel variant="scouter" title="Scouter Reticle">
              <div className="flex items-center justify-center p-2">
                <ScouterHudOverlay powerLevel={9001} size={150} color="green" />
              </div>
            </ToriyamaPanel>

            {/* Dragon Radar & Kinto-Un */}
            <ToriyamaPanel variant="standard" title="Radar & Kinto-Un">
              <div className="flex items-center justify-around p-2">
                <DragonRadarDisplay size={90} scanning />
                <div className="flex flex-col items-center gap-2">
                  <KintoUnCloud width={90} height={55} animated />
                  <KiAura size={60} color="gold" sparks />
                </div>
              </div>
            </ToriyamaPanel>
          </div>

          {/* Interactive Dragon Ball Slider & Progress */}
          <div className="flex flex-col gap-4 p-4 bg-[var(--color-card)] border-2 border-[var(--color-toriyama-ink,#121417)] shadow-[3px_3px_0px_var(--color-toriyama-ink,#121417)]">
            <ToriyamaSlider defaultValue={4} min={1} max={7} label="Selecteur de Dragon Ball (Sphere Dynamique)" />
            <ToriyamaProgress value={78} label="Charge d'Energie Ki (Super Saiyan)" variant="ki" />
          </div>

          {/* Speech Bubble & Badges */}
          <div className="flex flex-col gap-3">
            <ToriyamaSpeechBubble variant="shout" tailPosition="bottom">
              <span className="text-sm">« KA-ME-HA-ME-HA ! Stack UI Toriyama 100% opérationnelle ! »</span>
            </ToriyamaSpeechBubble>
            <div className="flex flex-wrap gap-2">
              <ToriyamaBadge emblem="kame" variant="kame">
                Tortue
              </ToriyamaBadge>
              <ToriyamaBadge emblem="go" variant="saiyan">
                Goku
              </ToriyamaBadge>
              <ToriyamaBadge emblem="capsule" variant="capsule">
                Capsule
              </ToriyamaBadge>
              <ToriyamaBadge emblem="majin" variant="majin">
                Babidi
              </ToriyamaBadge>
              <ToriyamaBadge emblem="dragonBall" stars={4} variant="gold">
                4 Etoiles
              </ToriyamaBadge>
              <ToriyamaBadge emblem="scouter" variant="scouter">
                BP: 9001
              </ToriyamaBadge>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function DesignEditor() {
  const query = useQuery({ queryKey: ["theme-config"], queryFn: loadTheme });
  const [theme, setTheme] = useState<SiteTheme | null>(null);
  const [savedTheme, setSavedTheme] = useState<SiteTheme | null>(null);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);

  useEffect(() => {
    if (!query.data?.theme) return;
    setTheme(query.data.theme);
    setSavedTheme(query.data.theme);
  }, [query.data]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const save = useMutation({
    mutationFn: () => saveTheme(theme as SiteTheme),
    onSuccess: result => {
      setTheme(result.theme);
      setSavedTheme(result.theme);
      setToast({
        type: "success",
        msg: "Thème enregistré et appliqué à tout le site.",
      });
    },
    onError: (error: Error) => setToast({ type: "error", msg: `Échec : ${error.message}` }),
  });
  const dirty = useMemo(
    () => theme != null && savedTheme != null && JSON.stringify(theme) !== JSON.stringify(savedTheme),
    [theme, savedTheme],
  );
  const valid = theme != null && Object.values(theme.colors).every(value => HEX.test(value.trim()));

  if (query.isLoading || !theme)
    return (
      <div className="flex items-center gap-3 text-sm text-zinc-500">
        <DragonBallLoader size={28} /> Chargement du thème…
      </div>
    );
  if (query.isError) return <div className="text-sm text-red-400">Erreur : {String(query.error)}</div>;

  const setColor = (key: ThemeColorKey, value: string) =>
    setTheme(current => (current ? { ...current, colors: { ...current.colors, [key]: value } } : current));
  const apply = () => {
    if (!valid) {
      setToast({
        type: "error",
        msg: "Corrige les couleurs invalides avant d'appliquer le thème.",
      });
      return;
    }
    save.mutate();
  };

  return (
    <main className={styles.editor}>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {toast?.msg}
      </div>
      {toast && (
        <div
          className={`fixed right-4 top-4 z-50 border-2 px-4 py-3 text-sm shadow-xl ${toast.type === "success" ? "border-green-500 bg-dbz-card text-green-300" : "border-red-500 bg-dbz-card text-red-300"}`}
        >
          {toast.msg}
        </div>
      )}
      <header className={styles.masthead}>
        <div className={styles.mastheadCopy}>
          <p className={styles.mastheadMark}>
            <Palette className="h-5 w-5" /> Atelier graphique
          </p>
          <h1>Design &amp; thème</h1>
          <p>Compose la palette globale, contrôle ses contrastes dans l'épreuve, puis applique-la au site entier.</p>
        </div>
        <div className={styles.mastheadActions}>
          <button
            type="button"
            onClick={() => {
              if (confirm("Réinitialiser le brouillon aux valeurs mesurées par défaut ?"))
                setTheme(structuredClone(DEFAULT_SITE_THEME));
            }}
            className="btn btn-ghost text-amber-800"
          >
            <Reinitialiser className="mr-1 h-4 w-4" /> Revenir aux mesures
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={save.isPending || !dirty || !valid}
            className="btn btn-primary"
          >
            <Enregistrer className="mr-1 h-4 w-4" />{" "}
            {save.isPending ? "Application…" : dirty ? "Appliquer au site" : "À jour"}
          </button>
        </div>
      </header>
      <div className={styles.layout}>
        <div className={styles.controls}>
          {GROUPS.map(group => (
            <fieldset className={styles.group} key={group.title}>
              <legend className={styles.groupLegend}>
                <Etoile taille={11} className="text-[var(--color-etoile-rouge)]" /> {group.title}
              </legend>
              <div className={styles.colorList}>
                {group.keys.map(key => (
                  <ColorRow
                    key={key}
                    colorKey={key}
                    value={theme.colors[key]}
                    onChange={value => setColor(key, value)}
                  />
                ))}
              </div>
            </fieldset>
          ))}
          <section className={styles.radiusPanel} aria-labelledby="radius-title">
            <div className={styles.radiusHead}>
              <h2 id="radius-title" className="font-bold text-white">
                Découpe des coins
              </h2>
              <output className={styles.radiusValue}>{theme.radius.toFixed(2)} rem</output>
            </div>
            <label htmlFor="theme-radius" className="sr-only">
              Rayon des coins
            </label>
            <input
              id="theme-radius"
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={theme.radius}
              onChange={event =>
                setTheme(current => (current ? { ...current, radius: Number(event.target.value) } : current))
              }
              className={styles.range}
            />
            <p className="mt-2 max-w-[55ch] text-xs leading-5 text-zinc-400">
              0 rem conserve les cases vives du manga ; les valeurs supérieures adoucissent les composants d'interface.
            </p>
          </section>
          {!valid && (
            <p className={styles.invalidNotice}>Une ou plusieurs couleurs ne sont pas des valeurs HEX valides.</p>
          )}
        </div>
        <Preview theme={theme} />
      </div>
    </main>
  );
}
