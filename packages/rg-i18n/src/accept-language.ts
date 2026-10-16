import { DEFAULT_LOCALE_REGISTRY, canonicalizeLocaleTag, matchLocale, type LocaleRegistry } from "./registry";

export interface LanguagePreference {
  /** Tag BCP-47 canonique, ou `*`. */
  readonly range: string;
  /** Poids HTTP compris entre 0 et 1. */
  readonly quality: number;
  /** Position d'origine, utilisée pour départager deux poids identiques. */
  readonly position: number;
}

const Q_VALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

function parseQuality(parameters: readonly string[]): number | null {
  const qualityParameters = parameters
    .map(parameter => parameter.trim())
    .filter(parameter => /^q\s*=/i.test(parameter));
  if (qualityParameters.length === 0) return 1;
  if (qualityParameters.length > 1) return null;

  const raw = qualityParameters[0]?.slice(qualityParameters[0].indexOf("=") + 1).trim() ?? "";
  if (!Q_VALUE.test(raw)) return null;
  return Number(raw);
}

/**
 * Analyse un en-tête `Accept-Language` sans lever sur les fragments invalides.
 * Les doublons sont fusionnés en conservant leur meilleur poids.
 */
export function parseAcceptLanguage(header: string | null | undefined): readonly LanguagePreference[] {
  if (!header) return Object.freeze([]);

  const preferences = new Map<string, LanguagePreference>();
  for (const [position, rawEntry] of header.split(",").entries()) {
    const [rawRange = "", ...parameters] = rawEntry.split(";");
    const trimmedRange = rawRange.trim();
    const range = trimmedRange === "*" ? "*" : canonicalizeLocaleTag(trimmedRange);
    const quality = parseQuality(parameters);
    if (!range || quality === null) continue;

    const existing = preferences.get(range);
    if (!existing || quality > existing.quality || (quality === existing.quality && position < existing.position)) {
      preferences.set(range, Object.freeze({ position, quality, range }));
    }
  }

  return Object.freeze([...preferences.values()].toSorted((a, b) => b.quality - a.quality || a.position - b.position));
}

interface WeightedLocale {
  locale: string;
  quality: number;
  position: number;
  registryPosition: number;
}

/** Sélectionne la meilleure locale du registre pour un en-tête HTTP. */
export function negotiateAcceptLanguage(
  header: string | null | undefined,
  registry: LocaleRegistry = DEFAULT_LOCALE_REGISTRY,
): string | null {
  const preferences = parseAcceptLanguage(header);
  const explicit = new Map<string, WeightedLocale>();
  let wildcard: LanguagePreference | undefined;

  for (const preference of preferences) {
    if (preference.range === "*") {
      wildcard = preference;
      continue;
    }

    const definition = matchLocale(preference.range, registry);
    if (!definition) continue;
    const existing = explicit.get(definition.tag);
    if (
      !existing ||
      preference.quality > existing.quality ||
      (preference.quality === existing.quality && preference.position < existing.position)
    ) {
      explicit.set(definition.tag, {
        locale: definition.tag,
        position: preference.position,
        quality: preference.quality,
        registryPosition: registry.locales.indexOf(definition),
      });
    }
  }

  const candidates = [...explicit.values()];
  if (wildcard && wildcard.quality > 0) {
    for (const [registryPosition, definition] of registry.locales.entries()) {
      if (explicit.has(definition.tag)) continue;
      candidates.push({
        locale: definition.tag,
        position: wildcard.position,
        quality: wildcard.quality,
        registryPosition,
      });
    }
  }

  return (
    candidates
      .filter(candidate => candidate.quality > 0)
      .toSorted(
        (a, b) => b.quality - a.quality || a.position - b.position || a.registryPosition - b.registryPosition,
      )[0]?.locale ?? null
  );
}
