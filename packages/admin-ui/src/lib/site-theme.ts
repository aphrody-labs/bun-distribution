// Source: apps/shenron/site/src/lib/site-theme.ts at 8172f535ce (preserved Git history).
/**
 * site-theme — thème de design global éditable (client-safe).
 *
 * Un document unique décrit la palette + le rayon des coins du site. Il est lu
 * côté serveur (lib/theme-config.ts) et injecté en `:root { --dbz-*: … }` dans le
 * layout racine → surcharge les défauts de `globals.css` (tokens `@theme inline`
 * passés en `var(--dbz-*, <défaut>)`). Sans thème en DB, rien n'est injecté et le
 * site garde sa palette d'origine (zéro régression). Types + défauts + résolution
 * défensive vivent ici pour être partagés par l'éditeur admin et le serveur.
 */

/** Clés de couleur ⇄ variable CSS surchargée (`--dbz-<var>`). */
export const THEME_COLOR_VARS = {
  bg: "--dbz-bg",
  card: "--dbz-card",
  border: "--dbz-border",
  orange: "--dbz-orange",
  orangeDark: "--dbz-orange-dark",
  blue: "--dbz-blue",
  blueLight: "--dbz-blue-light",
  yellow: "--dbz-yellow",
  red: "--dbz-red",
  ember: "--dbz-ember",
  ki: "--dbz-ki",
  amber: "--dbz-amber",
} as const;

export type ThemeColorKey = keyof typeof THEME_COLOR_VARS;

export interface ThemeColorMeta {
  key: ThemeColorKey;
  label: string;
  hint: string;
}

/** Métadonnées d'édition (libellés FR + aide). */
export const THEME_COLORS: readonly ThemeColorMeta[] = [
  { key: "orange", label: "Accent doré", hint: "Couleur signature (boutons, liens, titres)" },
  { key: "yellow", label: "Accent secondaire", hint: "Alias doré (HUD, eyebrows)" },
  { key: "red", label: "Rouge énergie", hint: "Accents ki / alertes" },
  { key: "bg", label: "Fond", hint: "Arrière-plan profond du site" },
  { key: "card", label: "Surface", hint: "Cartes et panneaux élevés" },
  { key: "border", label: "Bordure", hint: "Filets et séparateurs" },
  { key: "blue", label: "Bleu profond", hint: "Navy secondaire" },
  { key: "blueLight", label: "Gris clair", hint: "Texte secondaire clair" },
  { key: "orangeDark", label: "Doré foncé", hint: "État pressé des boutons" },
  { key: "ember", label: "Orange braise", hint: "Halos, sunburst, dégradé galactique" },
  { key: "ki", label: "Bleu ki", hint: "LED, halos de planètes, effets d'énergie" },
  { key: "amber", label: "Ambre", hint: "Dégradés et texte des boutons fantômes" },
];

type ThemeColors = Record<ThemeColorKey, string>;

export interface SiteTheme {
  version: 1;
  colors: ThemeColors;
  /** Rayon des coins de base (rem). */
  radius: number;
}

export const DEFAULT_SITE_THEME: SiteTheme = {
  version: 1,
  colors: {
    bg: "#0a0a0a",
    card: "#141410",
    border: "#2a2a26",
    // Palette relevée sur la couverture de tankōbon — cf.
    // docs/couverture-analyse-visuelle.md. `orange` est l'orange du gi de
    // Goku, `yellow` le jaune du titre, `red` le rouge du titre éclairci de
    // 4 % pour tenir AA sur le fond noir.
    orange: "#e78220",
    orangeDark: "#c46f1b",
    blue: "#1e244d",
    blueLight: "#cdcdcd",
    yellow: "#fefd03",
    red: "#f10c3b",
    ember: "#ff6b1a",
    ki: "#4ba8ff",
    amber: "#ffd23f",
  },
  radius: 0.5,
};

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const hex = (v: unknown, dflt: string): string => (typeof v === "string" && HEX.test(v.trim()) ? v.trim() : dflt);

/** Fusionne un patch (JSON DB / éditeur) au-dessus des défauts, en validant les hex. */
export function resolveSiteTheme(patch: unknown): SiteTheme {
  if (!patch || typeof patch !== "object") return DEFAULT_SITE_THEME;
  const p = patch as Record<string, unknown>;
  const cp = (p.colors ?? {}) as Record<string, unknown>;
  const colors = {} as ThemeColors;
  for (const key of Object.keys(THEME_COLOR_VARS) as ThemeColorKey[]) {
    colors[key] = hex(cp[key], DEFAULT_SITE_THEME.colors[key]);
  }
  const r = typeof p.radius === "number" ? p.radius : Number(p.radius);
  const radius = Number.isFinite(r) ? Math.max(0, Math.min(2, r)) : DEFAULT_SITE_THEME.radius;
  return { version: 1, colors, radius };
}

/** Indique si le thème est identique aux défauts (⇒ aucune injection nécessaire). */
export function isDefaultTheme(theme: SiteTheme): boolean {
  if (theme.radius !== DEFAULT_SITE_THEME.radius) return false;
  return (Object.keys(THEME_COLOR_VARS) as ThemeColorKey[]).every(
    k => theme.colors[k].toLowerCase() === DEFAULT_SITE_THEME.colors[k].toLowerCase(),
  );
}

/** Corps du `:root { … }` à injecter (chaîne de déclarations CSS). Vide si défaut. */
export function themeCssVars(theme: SiteTheme): string {
  if (isDefaultTheme(theme)) return "";
  const parts: string[] = [];
  for (const key of Object.keys(THEME_COLOR_VARS) as ThemeColorKey[]) {
    parts.push(`${THEME_COLOR_VARS[key]}:${theme.colors[key]}`);
  }
  parts.push(`--radius:${theme.radius}rem`);
  return parts.join(";");
}
