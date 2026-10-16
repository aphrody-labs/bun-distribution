/**
 * Design tokens of `@shenron/ui`, generated from `src/styles.css`.
 *
 * Do not edit by hand: run `bun packages/shenron-ui/scripts/generate-tokens.ts`.
 * `--check` and `test/tokens.test.ts` fail when this file drifts from the
 * stylesheet.
 *
 * `color` holds the fallbacks of `var(--dbz-*, <default>)`, i.e. what the site
 * renders while /admin/design has no saved theme. `ember` records its two
 * defaults, pinned by owner decision OWN-7: the stylesheet fallback follows the
 * accent colour, while the editor default (`DEFAULT_SITE_THEME`) is injected as
 * soon as any theme colour is saved.
 */

/** Runtime override variable of each colour token (/admin/design). */
export const colorVars = {
  bg: "--dbz-bg",
  card: "--dbz-card",
  border: "--dbz-border",
  orange: "--dbz-orange",
  orangeDark: "--dbz-orange-dark",
  blue: "--dbz-blue",
  blueLight: "--dbz-blue-light",
  yellow: "--dbz-yellow",
  red: "--dbz-red",
  green: "--dbz-green",
  purple: "--dbz-purple",
  gold: "--dbz-gold",
  cyan: "--dbz-cyan",
  pink: "--dbz-pink",
  encre: "--dbz-encre",
  os: "--dbz-os",
  kintoLumiere: "--dbz-kinto-lumiere",
  kintoOmbre: "--dbz-kinto-ombre",
  logoHaut: "--dbz-logo-haut",
  logoMilieu: "--dbz-logo-milieu",
  logoBas: "--dbz-logo-bas",
  logoJaune: "--dbz-logo-jaune",
  logoRouge: "--dbz-logo-rouge",
  logoTitre2: "--dbz-logo-titre2",
  caseCiel: "--dbz-case-ciel",
  giClair: "--dbz-gi-clair",
  giOmbre: "--dbz-gi-ombre",
  ecailleClaire: "--dbz-ecaille-claire",
  ecailleOmbre: "--dbz-ecaille-ombre",
  peau: "--dbz-peau",
  nuageFond: "--dbz-nuage-fond",
  nuageTrait: "--dbz-nuage-trait",
  pastilleBord: "--dbz-pastille-bord",
  etoileRouge: "--dbz-etoile-rouge",
  ember: "--dbz-ember",
  ki: "--dbz-ki",
  amber: "--dbz-amber",
} as const;

export const tokens = {
  color: {
    bg: "#0a0a0a",
    card: "#141410",
    border: "#2a2a26",
    orange: "#e78220",
    orangeDark: "#c46f1b",
    blue: "#1e244d",
    blueLight: "#cdcdcd",
    yellow: "#fefd03",
    red: "#f10c3b",
    green: "#2e9b41",
    purple: "#a855f7",
    gold: "#fefd03",
    cyan: "#22d3ee",
    pink: "#ec4899",
    encre: "#131b08",
    os: "#efe9d8",
    kintoLumiere: "#fcf03a",
    kintoOmbre: "#e4be05",
    logoHaut: "#176285",
    logoMilieu: "#1f9ec8",
    logoBas: "#52c5ef",
    logoJaune: "#fefd03",
    logoRouge: "#de0b36",
    logoTitre2: "#c4102a",
    caseCiel: "#3f5aa7",
    giClair: "#f48f20",
    giOmbre: "#dc7f2b",
    ecailleClaire: "#42b147",
    ecailleOmbre: "#298942",
    peau: "#f7dbad",
    nuageFond: "#cfcfe7",
    nuageTrait: "#4141a1",
    pastilleBord: "#ed5102",
    etoileRouge: "#ba151c",
    ember: "var(--color-dbz-orange)",
    ki: "#4ba8ff",
    amber: "#ffd23f",
  },
  radius: {
    sm: "calc(var(--radius) * 0.6)",
    md: "calc(var(--radius) * 0.8)",
    lg: "var(--radius)",
    xl: "calc(var(--radius) * 1.4)",
    base: "0.5rem",
  },
  font: {
    sans: "var(--font-sans)",
    display: "var(--font-sans)",
    serif: 'var(--font-serif-src), Georgia, "Times New Roman", serif',
    mono: 'var(--font-mono-src), ui-monospace, "SF Mono", monospace',
    jp: "var(--font-jp)",
    saiyan: "var(--font-sans)",
    scouter: 'var(--font-mono-src), ui-monospace, "SF Mono", monospace',
  },
  ember: {
    css: "var(--color-dbz-orange)",
    siteThemeDefault: "#ff6b1a",
  },
} as const;

export type Tokens = typeof tokens;
export type ColorToken = keyof typeof tokens.color;
