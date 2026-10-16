// SPDX-License-Identifier: Apache-2.0
// The page's compiled sheets carry the build-time theme (`m3:theme.css`, a brand sheet), so the
// provider only sets the mode until the seed, variant or contrast changes; a change installs the
// Rust `scheme` sheet returned by `sheet`. No colour is computed here and no colour role is inline.

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  applyDynamicFusionTheme,
  applyM3Mode,
  clearM3Scheme,
  type M3SchemeSheet,
  type SchemeVariant,
} from "./index";

export type { M3SchemeRequest, M3SchemeSheet, SchemeVariant } from "./index";

export type ThemeMode = "light" | "dark" | "system";

export interface M3ThemeContextType {
  themeMode: ThemeMode;
  seedColor: string;
  resolvedTheme: "light" | "dark";
  contrastLevel: number;
  variant: SchemeVariant;
  /** Source of the Rust scheme sheets, when runtime theme changes are possible. */
  sheet: M3SchemeSheet | undefined;
  /** Failure of the last Rust scheme sheet request; the previous colours stay in place. */
  schemeError: Error | undefined;
  setThemeMode: (mode: ThemeMode) => void;
  /** Throws when the provider has no `sheet`: only the compiled theme is available then. */
  setSeedColor: (seed: string) => void;
  setContrastLevel: (level: number) => void;
  setVariant: (variant: SchemeVariant) => void;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToColorScheme(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches;
}

const M3ThemeContext = createContext<M3ThemeContextType | undefined>(undefined);

export interface M3ThemeProviderProps {
  children: React.ReactNode;
  /** Seed of the theme compiled into the page's CSS. */
  defaultSeedColor?: string;
  defaultThemeMode?: ThemeMode;
  /** Contrast of the compiled theme. */
  defaultContrastLevel?: number;
  /** Variant of the compiled theme. */
  defaultVariant?: SchemeVariant;
  /** Element receiving the mode and the runtime scheme. Defaults to document.documentElement. */
  target?: HTMLElement;
  /** Rust scheme sheets for runtime theme changes (`m3Css`, or an app-server route). */
  sheet?: M3SchemeSheet;
}

function missingSheet(): Error {
  return new Error(
    "M3ThemeProvider: changing the seed, variant or contrast needs the `sheet` prop (Rust m3Css scheme sheets); only the compiled theme is available",
  );
}

/** A setter that refuses anything but the compiled value when no Rust sheet source exists. */
function guard<T>(
  sheet: M3SchemeSheet | undefined,
  set: (value: T) => void,
  compiled: T,
): (value: T) => void {
  return (value) => {
    if (!sheet && value !== compiled) throw missingSheet();
    set(value);
  };
}

export function M3ThemeProvider({
  children,
  defaultSeedColor = "#6750a4",
  defaultThemeMode = "system",
  defaultContrastLevel = 0,
  defaultVariant = "tonalSpot",
  target,
  sheet,
}: M3ThemeProviderProps) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(defaultThemeMode);
  const [seedColor, setSeed] = useState<string>(defaultSeedColor);
  const [contrastLevel, setContrast] = useState<number>(defaultContrastLevel);
  const [variant, setVariantState] = useState<SchemeVariant>(defaultVariant);
  const [failure, setFailure] = useState<{ key: string; error: Error }>();

  const systemDark = useSyncExternalStore(
    subscribeToColorScheme,
    prefersDark,
    () => false,
  );
  const resolvedTheme: "light" | "dark" =
    themeMode === "system" ? (systemDark ? "dark" : "light") : themeMode;
  const compiled =
    seedColor.toLowerCase() === defaultSeedColor.toLowerCase() &&
    variant === defaultVariant &&
    contrastLevel === defaultContrastLevel;
  const schemeKey = JSON.stringify([
    seedColor,
    variant,
    contrastLevel,
    resolvedTheme,
  ]);
  const schemeError =
    !compiled && failure?.key === schemeKey ? failure.error : undefined;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const element = target ?? document.documentElement;
    applyM3Mode(resolvedTheme === "dark", element);
    if (compiled) {
      clearM3Scheme(element);
      return;
    }
    let current = true;
    applyDynamicFusionTheme(seedColor, {
      dark: resolvedTheme === "dark",
      target: element,
      contrastLevel,
      variant,
      sheet,
    }).catch((error: unknown) => {
      if (current)
        setFailure({
          key: schemeKey,
          error: error instanceof Error ? error : new Error(String(error)),
        });
    });
    return () => {
      current = false;
    };
  }, [
    compiled,
    schemeKey,
    seedColor,
    resolvedTheme,
    target,
    contrastLevel,
    variant,
    sheet,
  ]);

  const setSeedColor = useMemo(
    () => guard(sheet, setSeed, defaultSeedColor),
    [sheet, defaultSeedColor],
  );
  const setContrastLevel = useMemo(
    () => guard(sheet, setContrast, defaultContrastLevel),
    [sheet, defaultContrastLevel],
  );
  const setVariant = useMemo(
    () => guard(sheet, setVariantState, defaultVariant),
    [sheet, defaultVariant],
  );

  const value = useMemo<M3ThemeContextType>(
    () => ({
      themeMode,
      seedColor,
      resolvedTheme,
      contrastLevel,
      variant,
      sheet,
      schemeError,
      setThemeMode,
      setSeedColor,
      setContrastLevel,
      setVariant,
    }),
    [
      themeMode,
      seedColor,
      resolvedTheme,
      contrastLevel,
      variant,
      sheet,
      schemeError,
      setSeedColor,
      setContrastLevel,
      setVariant,
    ],
  );

  return (
    <M3ThemeContext.Provider value={value}>{children}</M3ThemeContext.Provider>
  );
}

export function useM3Theme(): M3ThemeContextType {
  const context = useContext(M3ThemeContext);
  if (context === undefined) {
    throw new Error("useM3Theme must be used within an M3ThemeProvider");
  }
  return context;
}
