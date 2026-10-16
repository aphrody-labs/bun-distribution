"use client";

import { useResetState } from "@/hooks/use-reset-state";

import { createIntlFormatters, directionForLocale, type DateValue } from "@rosegriffon/i18n";
import type { LocaleId } from "@rosegriffon/preferences";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
// Import default locale directly to prevent hydration mismatch and flash of keys
import frDictionary from "@/public/locales/fr.json";

export type Language = LocaleId;

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (hash: string | number | undefined | null) => string;
  formatDate: (value: DateValue, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number | bigint, options?: Intl.NumberFormatOptions) => string;
  formatList: (value: readonly string[], options?: Intl.ListFormatOptions) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getLocalized: (obj: any, fieldPrefix?: string) => string;
  isLoading: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const DEFAULT_LANGUAGE: Language = "fr";
const LANGUAGE_COOKIE = "rg-locale";

function persistLanguage(language: Language) {
  try {
    localStorage.setItem("app_language", language);
  } catch {
    // Le cookie reste la source portable quand le stockage local est bloqué.
  }
  try {
    document.cookie = `${LANGUAGE_COOKIE}=${language}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch {
    // L'état React continue de fonctionner dans un shell sans cookies.
  }
}

export function LanguageProvider({
  children,
  initialLanguage = DEFAULT_LANGUAGE,
}: {
  children: ReactNode;
  initialLanguage?: Language;
}) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);
  // Initialize with static FR dictionary
  const [dictionary, setDictionary] = useResetState<Record<string, string>>(
    frDictionary as Record<string, string>,
    language,
  );
  const [isLoading, setIsLoading] = useResetState(language !== "fr", language);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    persistLanguage(lang);
  };

  // Le serveur initialise déjà lang/dir depuis le cookie et Accept-Language.
  // Cette synchronisation maintient le document juste lors d'un changement
  // interactif, sans qu'un ancien localStorage puisse écraser la décision SSR.
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = directionForLocale(language);
  }, [language]);

  // Load dictionary dynamically for non-default languages
  useEffect(() => {
    if (language === "fr") return;

    const controller = new AbortController();
    fetch(`/locales/${language}.json`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Locale ${language}: HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setDictionary({
          ...(frDictionary as Record<string, string>),
          ...(data as Record<string, string>),
        });
        setIsLoading(false);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Failed to load locale", error);
        setDictionary(frDictionary as Record<string, string>);
        setLanguageState(DEFAULT_LANGUAGE);
        persistLanguage(DEFAULT_LANGUAGE);
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [language]);

  const formatters = useMemo(() => createIntlFormatters(language), [language]);

  const t = (hash: string | number | undefined | null) => {
    if (hash === undefined || hash === null) {
      return "";
    }
    const key = hash.toString();
    return dictionary[key] || key;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getLocalized = (obj: any, fieldPrefix: string = "name") => {
    if (!obj) {
      return "";
    }

    const langSuffix = language.toUpperCase(); // FR, EN, JA
    const targetKey = `${fieldPrefix}_${langSuffix}`;

    if (obj[targetKey]) {
      return obj[targetKey];
    }

    // Fallback to FR
    if (obj[`${fieldPrefix}_FR`]) {
      return obj[`${fieldPrefix}_FR`];
    }

    // Fallback to plain field or EN
    if (obj[fieldPrefix]) {
      return obj[fieldPrefix];
    }

    return "";
  };

  return (
    <LanguageContext.Provider
      value={{
        formatDate: formatters.date,
        formatList: formatters.list,
        formatNumber: formatters.number,
        getLocalized,
        isLoading,
        language,
        setLanguage,
        t,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

const defaultLanguageContext: LanguageContextType = {
  formatDate: createIntlFormatters(DEFAULT_LANGUAGE).date,
  formatList: createIntlFormatters(DEFAULT_LANGUAGE).list,
  formatNumber: createIntlFormatters(DEFAULT_LANGUAGE).number,
  getLocalized: (obj: any, fieldPrefix: string = "name") => {
    if (!obj) {
      return "";
    }
    return obj[`${fieldPrefix}_FR`] || obj[fieldPrefix] || "";
  },
  isLoading: false,
  language: "fr",
  setLanguage: () => {},
  t: (hash: string | number | undefined | null) => {
    if (hash === undefined || hash === null) {
      return "";
    }
    const key = hash.toString();
    return (frDictionary as Record<string, string>)[key] || key;
  },
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  return context ?? defaultLanguageContext;
};
