"use client";
// SPDX-License-Identifier: Apache-2.0
// Client boundary of @aphrody/m3-next: the M3 theme provider from @aphrody/m3-theme/react behind
// a 'use client' directive, plus the cookie bridge that lets the server render the right mode.
import { useCallback, useEffect, type ReactNode } from "react";
import {
  M3ThemeProvider,
  useM3Theme,
  type M3ThemeContextType,
  type M3ThemeProviderProps,
  type SchemeVariant,
  type ThemeMode,
} from "@aphrody/m3-theme/react";
import { M3_THEME_COOKIE, themeCookie, type M3ThemeMode } from "./constants";

export { M3ThemeProvider, useM3Theme };
export type { M3ThemeContextType, M3ThemeProviderProps, SchemeVariant, ThemeMode };

export interface M3ThemeCookieSyncProps {
  /** Cookie that stores the preference (default `m3-theme`). */
  cookieName?: string;
}

/**
 * Persist the provider's theme mode in a cookie and keep the `.light` class (forced light) on
 * `<html>` in step, so the next server render emits the same mode. Renders nothing.
 */
export function M3ThemeCookieSync({ cookieName = M3_THEME_COOKIE }: M3ThemeCookieSyncProps) {
  const { themeMode } = useM3Theme();
  useEffect(() => {
    // The theme cookie is the documented bridge to the server render; Cookie Store is not in every browser yet.
    // oxlint-disable-next-line unicorn/no-document-cookie
    document.cookie = themeCookie(themeMode, cookieName);
    const root = document.documentElement;
    root.classList.toggle("light", themeMode === "light");
    root.dataset.m3Theme = themeMode;
    if (themeMode === "system") root.style.removeProperty("color-scheme");
  }, [themeMode, cookieName]);
  return null;
}

export interface M3NextThemeProviderProps {
  children?: ReactNode;
  /** The mode the server rendered (from the cookie). */
  initialMode?: M3ThemeMode;
  /** Source colour (default `#6750a4`). */
  seed?: string;
  variant?: SchemeVariant;
  contrast?: number;
  cookieName?: string;
}

/** `M3ThemeProvider` seeded with the server-rendered mode, plus {@link M3ThemeCookieSync}. */
export function M3NextThemeProvider({
  children,
  initialMode = "system",
  seed,
  variant,
  contrast,
  cookieName,
}: M3NextThemeProviderProps) {
  return (
    <M3ThemeProvider
      defaultThemeMode={initialMode}
      defaultSeedColor={seed}
      defaultVariant={variant}
      defaultContrastLevel={contrast}
    >
      <M3ThemeCookieSync cookieName={cookieName} />
      {children}
    </M3ThemeProvider>
  );
}

const CYCLE: Record<M3ThemeMode, M3ThemeMode> = { light: "dark", dark: "system", system: "light" };

/** The current mode, the resolved light / dark value and a `light -> dark -> system` cycle. */
export function useM3ThemeToggle(): {
  mode: M3ThemeMode;
  resolved: "light" | "dark";
  setMode: (mode: M3ThemeMode) => void;
  toggle: () => void;
} {
  const { themeMode, resolvedTheme, setThemeMode } = useM3Theme();
  const toggle = useCallback(() => setThemeMode(CYCLE[themeMode]), [setThemeMode, themeMode]);
  return { mode: themeMode, resolved: resolvedTheme, setMode: setThemeMode, toggle };
}
