// Source: apps/shenron/site/src/lib/wiki-section-accents.ts at 8172f535ce (preserved Git history).
/**
 * Palette d'accents des catégories de fiche wiki (pilules, bandeaux, titres).
 * Source unique client + server — toute nouvelle couleur doit être déclarée ici
 * ET dans `globals.css` (`--color-dbz-*`).
 */

const SECTION_ACCENT_KEYS = ["orange", "blue", "red", "green", "purple", "gold", "cyan", "pink"] as const;

export type SectionAccent = (typeof SECTION_ACCENT_KEYS)[number];

export const SECTION_ACCENT_SET = new Set<string>(SECTION_ACCENT_KEYS);

export interface SectionAccentStyle {
  text: string;
  bar: string;
  line: string;
  dot: string;
  /** Pilule active (sélecteur de catégories). */
  pillActive: string;
  /** Grille de personnages liés (hover titre). */
  relatedHover: string;
}

const SECTION_ACCENT_STYLES: Record<SectionAccent, SectionAccentStyle> = {
  orange: {
    text: "text-dbz-orange",
    bar: "bg-dbz-orange",
    line: "from-dbz-orange/50",
    dot: "bg-dbz-orange",
    pillActive: "bg-dbz-orange text-black border-dbz-orange shadow-[0_0_18px_rgba(255,178,0,0.35)]",
    relatedHover: "group-hover:text-dbz-orange",
  },
  blue: {
    text: "text-dbz-blue-light",
    bar: "bg-dbz-blue-light",
    line: "from-dbz-blue-light/50",
    dot: "bg-dbz-blue-light",
    pillActive: "bg-dbz-blue-light text-black border-dbz-blue-light shadow-[0_0_18px_rgba(96,165,250,0.3)]",
    relatedHover: "group-hover:text-dbz-blue-light",
  },
  red: {
    text: "text-dbz-red",
    bar: "bg-dbz-red",
    line: "from-dbz-red/50",
    dot: "bg-dbz-red",
    pillActive: "bg-dbz-red text-black border-dbz-red shadow-[0_0_18px_rgba(220,38,38,0.3)]",
    relatedHover: "group-hover:text-dbz-red",
  },
  green: {
    text: "text-dbz-green",
    bar: "bg-dbz-green",
    line: "from-dbz-green/50",
    dot: "bg-dbz-green",
    pillActive: "bg-dbz-green text-black border-dbz-green shadow-[0_0_18px_rgba(22,163,74,0.35)]",
    relatedHover: "group-hover:text-dbz-green",
  },
  purple: {
    text: "text-dbz-purple",
    bar: "bg-dbz-purple",
    line: "from-dbz-purple/50",
    dot: "bg-dbz-purple",
    pillActive: "bg-dbz-purple text-black border-dbz-purple shadow-[0_0_18px_rgba(168,85,247,0.35)]",
    relatedHover: "group-hover:text-dbz-purple",
  },
  gold: {
    text: "text-dbz-gold",
    bar: "bg-dbz-gold",
    line: "from-dbz-gold/50",
    dot: "bg-dbz-gold",
    pillActive: "bg-dbz-gold text-black border-dbz-gold shadow-[0_0_18px_rgba(255,234,0,0.35)]",
    relatedHover: "group-hover:text-dbz-gold",
  },
  cyan: {
    text: "text-dbz-cyan",
    bar: "bg-dbz-cyan",
    line: "from-dbz-cyan/50",
    dot: "bg-dbz-cyan",
    pillActive: "bg-dbz-cyan text-black border-dbz-cyan shadow-[0_0_18px_rgba(34,211,238,0.35)]",
    relatedHover: "group-hover:text-dbz-cyan",
  },
  pink: {
    text: "text-dbz-pink",
    bar: "bg-dbz-pink",
    line: "from-dbz-pink/50",
    dot: "bg-dbz-pink",
    pillActive: "bg-dbz-pink text-black border-dbz-pink shadow-[0_0_18px_rgba(236,72,153,0.35)]",
    relatedHover: "group-hover:text-dbz-pink",
  },
};

/** Options pour le sélecteur de couleur dans le studio admin. */
export const SECTION_ACCENT_OPTIONS = SECTION_ACCENT_KEYS.map(key => ({
  key,
  label: {
    orange: "Orange",
    blue: "Bleu",
    red: "Rouge",
    green: "Vert",
    purple: "Violet",
    gold: "Or",
    cyan: "Cyan",
    pink: "Rose",
  }[key],
  dot: SECTION_ACCENT_STYLES[key].dot,
}));

const ACCENT_RULES: Array<[RegExp, SectionAccent]> = [
  [/pws|power\s*scal|puissance|niveau de force/i, "red"],
  [/transform|fusion|forme|super\s*saiyan|ssj|ultra\s*instinct/i, "purple"],
  [/personnalit|relation|caract[eè]re|affili/i, "cyan"],
  [/pouvoir|technique|capacit|comp[eé]tence|ma[iî]trise/i, "blue"],
  [/apparence|physique|corporel|tenue|costume/i, "green"],
  [/anecdote|trivia|curiosit|fun/i, "gold"],
  [/histoire|origine|parcours|biographie|enfance/i, "orange"],
];

/** Accent par défaut pour un libellé de section (orange si aucune règle ne matche). */
export function sectionAccent(label: string): SectionAccent {
  for (const [re, accent] of ACCENT_RULES) if (re.test(label)) return accent;
  return "orange";
}

/** Valide une valeur stockée en base ; repli orange si inconnue ou vide. */
export function normalizeSectionAccent(value: string | null | undefined): SectionAccent {
  return value && SECTION_ACCENT_SET.has(value) ? (value as SectionAccent) : "orange";
}

export function sectionAccentStyle(accent: SectionAccent | null | undefined): SectionAccentStyle {
  return SECTION_ACCENT_STYLES[normalizeSectionAccent(accent)];
}
