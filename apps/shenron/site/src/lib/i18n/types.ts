// SPDX-License-Identifier: Apache-2.0

export type SupportedLocale = "fr" | "ja" | "en";

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ["fr", "ja", "en"] as const;
export const DEFAULT_LOCALE: SupportedLocale = "fr";

export interface LocaleInfo {
	code: SupportedLocale;
	name: string;
	nativeName: string;
	flag: string;
	dir: "ltr";
}

export const LOCALES_INFO: Record<SupportedLocale, LocaleInfo> = {
	fr: { code: "fr", name: "Français", nativeName: "Français", flag: "🇫🇷", dir: "ltr" },
	ja: { code: "ja", name: "Japonais", nativeName: "日本語", flag: "🇯🇵", dir: "ltr" },
	en: { code: "en", name: "Anglais", nativeName: "English", flag: "🇬🇧", dir: "ltr" },
};

