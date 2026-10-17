// SPDX-License-Identifier: Apache-2.0
/**
 * Browser-safe localizer over Fluent bundles: one bundle per locale of the negotiated fallback
 * chain, the first bundle holding a message wins. Used by play's client (catalogs fetched from
 * `/api/platform/i18n/<locale>`), the play server and the sidecar of the native shell.
 */
import {
  type FluentArgs,
  FluentBundle,
  type FormatError,
  FluentResource,
} from "./fluent";

export interface LocaleInfo {
  /** Canonical BCP 47 tag. */
  tag: string;
  /** Autonym shown in the language picker (never translated). */
  name: string;
  direction: "ltr" | "rtl";
  fallbacks?: string[];
}

/** Catalog payload: per locale, the `.ftl` sources in override order (base, usr, plugins, user). */
export type CatalogSources = Record<string, string[]>;

export class Localizer {
  readonly bundles: FluentBundle[];
  readonly errors: FormatError[] = [];

  constructor(
    /** Fallback chain, most preferred first (e.g. `["fr", "en"]`). */
    readonly chain: string[],
    sources: CatalogSources,
  ) {
    this.bundles = chain.map((tag) => {
      const bundle = new FluentBundle(tag);
      for (const text of sources[tag] ?? []) {
        const resource = new FluentResource(text);
        for (const error of resource.errors)
          this.errors.push({
            id: `${tag}:${error.line}`,
            message: error.message,
          });
        bundle.addResource(resource);
      }
      return bundle;
    });
  }

  get locale(): string {
    return this.chain[0] ?? "en";
  }

  has(id: string): boolean {
    return this.bundles.some((bundle) =>
      bundle.hasMessage(id.split(".")[0] as string),
    );
  }

  /**
   * Formats `id` (or `id.attribute`). A missing key renders as the key itself so the gap is
   * visible and caught by `bun-os-platform i18n check`, never as invented text.
   */
  t(id: string, args?: FluentArgs): string {
    for (const bundle of this.bundles) {
      const value = bundle.format(id, args, this.errors);
      if (value !== null) return value;
    }
    this.errors.push({ id, message: "missing message" });
    return id;
  }

  /** Locale-aware number, date and list formatting through Intl (ICU data of the runtime). */
  number(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(this.locale, options).format(value);
  }

  date(
    value: Date | number | string,
    options?: Intl.DateTimeFormatOptions,
  ): string {
    return new Intl.DateTimeFormat(this.locale, options).format(
      new Date(value),
    );
  }

  relative(value: number, unit: Intl.RelativeTimeFormatUnit): string {
    return new Intl.RelativeTimeFormat(this.locale, { numeric: "auto" }).format(
      value,
      unit,
    );
  }

  list(values: string[], type: Intl.ListFormatType = "conjunction"): string {
    return new Intl.ListFormat(this.locale, { type }).format(values);
  }

  /** Byte sizes with the locale's digits and the unit names from Intl (kilobyte, megabyte...). */
  bytes(value: number | null | undefined): string {
    if (value == null) return this.t("common-unknown-value");
    const units = [
      "byte",
      "kilobyte",
      "megabyte",
      "gigabyte",
      "terabyte",
    ] as const;
    let n = value;
    let unit = 0;
    while (n >= 1024 && unit < units.length - 1) {
      n /= 1024;
      unit++;
    }
    return new Intl.NumberFormat(this.locale, {
      style: "unit",
      unit: units[unit],
      unitDisplay: "short",
      maximumFractionDigits: n >= 10 || unit === 0 ? 0 : 1,
    }).format(n);
  }
}

/** Negotiates against `available` with plain BCP 47 lookup (exact, then language prefix). */
export function lookupLocale(
  requested: readonly string[],
  available: readonly string[],
): string | null {
  const canon = (tag: string) => {
    try {
      return Intl.getCanonicalLocales(tag.replace(/_/g, "-"))[0] ?? null;
    } catch {
      return null;
    }
  };
  for (const raw of requested) {
    const tag = canon(raw);
    if (!tag) continue;
    if (available.includes(tag)) return tag;
    // zh-CN -> zh-Hans, zh-TW/HK -> zh-Hant (script-based catalogs).
    const max = new Intl.Locale(tag).maximize();
    const scripted = `${max.language}-${max.script}`;
    if (available.includes(scripted)) return scripted;
    const regional = available.find((a) =>
      a.startsWith(`${max.language}-${max.region}`),
    );
    if (regional) return regional;
    const language = available.find(
      (a) => a === max.language || a.startsWith(`${max.language}-`),
    );
    if (language) return language;
  }
  return null;
}

/** Fallback chain for a resolved tag: the tag, its declared fallbacks, then the default. */
export function fallbackChain(
  tag: string,
  locales: readonly LocaleInfo[],
  defaultLocale = "en",
): string[] {
  const chain: string[] = [];
  const visit = (t: string) => {
    if (chain.includes(t)) return;
    const info = locales.find((l) => l.tag === t);
    if (!info) return;
    chain.push(t);
    for (const f of info.fallbacks ?? []) visit(f);
  };
  visit(tag);
  if (!chain.includes(defaultLocale)) chain.push(defaultLocale);
  return chain;
}
