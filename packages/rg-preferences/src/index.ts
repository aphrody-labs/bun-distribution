/**
 * Cross-runtime presentation preferences.
 *
 * This module deliberately has no DOM, framework, storage, network, or database
 * dependency. Applications are responsible for loading the four input layers;
 * this package only validates and resolves them deterministically.
 */

export const THEME_IDS = ["roy", "gaelle", "azalee-light", "azalee-dark", "achillea"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const LOCALE_IDS = ["fr", "en", "ja"] as const;
export type LocaleId = (typeof LOCALE_IDS)[number];

export const FONT_IDS = [
  "system",
  "geist-sans",
  "geist-mono",
  "roboto",
  "poppins",
  "noto-sans",
  "lato",
  "super-cartoon",
  "brad-bun-r",
  "aklatan",
] as const;
export type FontId = (typeof FONT_IDS)[number];

export const DENSITY_IDS = ["compact", "comfortable", "spacious"] as const;
export type Density = (typeof DENSITY_IDS)[number];

export const CONTRAST_IDS = ["standard", "high"] as const;
export type Contrast = (typeof CONTRAST_IDS)[number];

export const FONT_SCALE_MIN = 0.75;
export const FONT_SCALE_MAX = 2;

/** A complete, validated configuration that can be serialized as JSON. */
export interface ExperienceConfig {
  readonly theme: ThemeId;
  readonly locale: LocaleId;
  readonly font: FontId;
  readonly fontScale: number;
  readonly density: Density;
  readonly contrast: Contrast;
  readonly reducedMotion: boolean;
  readonly readingMode: boolean;
}

/** Values explicitly selected by an end user. */
export type UserExperiencePreferences = Readonly<Partial<ExperienceConfig>>;

/**
 * Untrusted serialized input, for example a cookie, HTTP payload, or database
 * row. Unknown values are ignored instead of being coerced.
 */
export type ExperienceCandidate = Readonly<Partial<Record<keyof ExperienceConfig, unknown>>>;

export interface ExperienceWhitelist {
  readonly themes?: readonly ThemeId[];
  readonly locales?: readonly LocaleId[];
  readonly fonts?: readonly FontId[];
}

export type ExperienceSource = "user" | "domain" | "device" | "defaults";
export type ExperienceSources = Readonly<{
  [K in keyof ExperienceConfig]: ExperienceSource;
}>;

/** A complete configuration plus the layer that supplied every field. */
export interface ResolvedExperience extends ExperienceConfig {
  readonly sources: ExperienceSources;
}

export interface ResolveExperienceInput {
  /** Product-level fallback. Missing or invalid fields use DEFAULT_EXPERIENCE. */
  readonly defaults?: ExperienceCandidate | null;
  /** Hints derived by the caller from the operating system or user agent. */
  readonly deviceHints?: ExperienceCandidate | null;
  /** Server-owned configuration for the current domain or tenant. */
  readonly domain?: ExperienceCandidate | null;
  /** Persisted choices made by the current user. */
  readonly user?: UserExperiencePreferences | ExperienceCandidate | null;
  /** Optional deployment allowlists. Empty/invalid lists fall back safely. */
  readonly whitelist?: ExperienceWhitelist | null;
}

export const DEFAULT_EXPERIENCE: Readonly<ExperienceConfig> = Object.freeze({
  contrast: "standard",
  density: "comfortable",
  font: "system",
  fontScale: 1,
  locale: "fr",
  readingMode: false,
  reducedMotion: false,
  theme: "roy",
});

function includes<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function isThemeId(value: unknown): value is ThemeId {
  return includes(THEME_IDS, value);
}

export function isLocaleId(value: unknown): value is LocaleId {
  return includes(LOCALE_IDS, value);
}

export function isFontId(value: unknown): value is FontId {
  return includes(FONT_IDS, value);
}

export function isDensity(value: unknown): value is Density {
  return includes(DENSITY_IDS, value);
}

export function isContrast(value: unknown): value is Contrast {
  return includes(CONTRAST_IDS, value);
}

export function isFontScale(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= FONT_SCALE_MIN && value <= FONT_SCALE_MAX;
}

type Layer = Readonly<{
  source: ExperienceSource;
  value: ExperienceCandidate | null | undefined;
}>;

function sanitizeWhitelist<T extends string>(
  requested: readonly T[] | undefined,
  known: readonly T[],
  fallback: T,
): readonly T[] {
  if (requested === undefined) return known;

  const knownSet = new Set<string>(known);
  const unique = [...new Set(requested.filter(value => knownSet.has(value)))];
  return unique.length > 0 ? unique : [fallback];
}

function firstValid<T>(
  key: keyof ExperienceConfig,
  layers: readonly Layer[],
  isValid: (value: unknown) => value is T,
  fallback: T,
): readonly [value: T, source: ExperienceSource] {
  for (const layer of layers) {
    const value = layer.value?.[key];
    if (isValid(value)) return [value, layer.source];
  }
  return [fallback, "defaults"];
}

/**
 * Resolve every preference independently using this fixed precedence:
 * user > server domain > device hints > product defaults > safe built-in.
 *
 * Invalid higher-priority values never mask a valid lower-priority value.
 */
export function resolveExperience(input: ResolveExperienceInput = {}): ResolvedExperience {
  const allowedThemes = sanitizeWhitelist(input.whitelist?.themes, THEME_IDS, DEFAULT_EXPERIENCE.theme);
  const allowedLocales = sanitizeWhitelist(input.whitelist?.locales, LOCALE_IDS, DEFAULT_EXPERIENCE.locale);
  const allowedFonts = sanitizeWhitelist(input.whitelist?.fonts, FONT_IDS, DEFAULT_EXPERIENCE.font);

  const layers: readonly Layer[] = [
    { source: "user", value: input.user },
    { source: "domain", value: input.domain },
    { source: "device", value: input.deviceHints },
    { source: "defaults", value: input.defaults },
  ];

  const fallbackTheme = allowedThemes.includes(DEFAULT_EXPERIENCE.theme) ? DEFAULT_EXPERIENCE.theme : allowedThemes[0]!;
  const fallbackLocale = allowedLocales.includes(DEFAULT_EXPERIENCE.locale)
    ? DEFAULT_EXPERIENCE.locale
    : allowedLocales[0]!;
  const fallbackFont = allowedFonts.includes(DEFAULT_EXPERIENCE.font) ? DEFAULT_EXPERIENCE.font : allowedFonts[0]!;

  const [theme, themeSource] = firstValid(
    "theme",
    layers,
    (value): value is ThemeId => isThemeId(value) && allowedThemes.includes(value),
    fallbackTheme,
  );
  const [locale, localeSource] = firstValid(
    "locale",
    layers,
    (value): value is LocaleId => isLocaleId(value) && allowedLocales.includes(value),
    fallbackLocale,
  );
  const [font, fontSource] = firstValid(
    "font",
    layers,
    (value): value is FontId => isFontId(value) && allowedFonts.includes(value),
    fallbackFont,
  );
  const [fontScale, fontScaleSource] = firstValid("fontScale", layers, isFontScale, DEFAULT_EXPERIENCE.fontScale);
  const [density, densitySource] = firstValid("density", layers, isDensity, DEFAULT_EXPERIENCE.density);
  const [contrast, contrastSource] = firstValid("contrast", layers, isContrast, DEFAULT_EXPERIENCE.contrast);
  const [reducedMotion, reducedMotionSource] = firstValid(
    "reducedMotion",
    layers,
    (value): value is boolean => typeof value === "boolean",
    DEFAULT_EXPERIENCE.reducedMotion,
  );
  const [readingMode, readingModeSource] = firstValid(
    "readingMode",
    layers,
    (value): value is boolean => typeof value === "boolean",
    DEFAULT_EXPERIENCE.readingMode,
  );

  const sources: ExperienceSources = Object.freeze({
    contrast: contrastSource,
    density: densitySource,
    font: fontSource,
    fontScale: fontScaleSource,
    locale: localeSource,
    readingMode: readingModeSource,
    reducedMotion: reducedMotionSource,
    theme: themeSource,
  });

  return Object.freeze({
    contrast,
    density,
    font,
    fontScale,
    locale,
    readingMode,
    reducedMotion,
    sources,
    theme,
  });
}
