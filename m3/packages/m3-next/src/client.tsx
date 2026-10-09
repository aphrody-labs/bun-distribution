// SPDX-License-Identifier: Apache-2.0
// Client boundary of @aphrody/m3-next (the build prepends the `'use client'` directive to dist/client.js; Bun keeps a
// source directive after the hoisted imports, where Next rejects it): the theme provider. It carries only the mode (light, dark, system), the cookie
// bridge to the server render and the class and `color-scheme` on <html>: a few hundred bytes. The Material You engine
// (material-color-utilities, tens of KB) is imported on demand, and only when the seed, variant or contrast differ from
// the scheme the server already inlined (M3Html does), so a typical page never downloads it.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { SchemeVariant } from "@aphrody/m3-tokens/dynamic-color";
import {
  M3_BASELINE_SEED,
  M3_THEME_COOKIE,
  themeCookie,
  validateThemeCookieName,
  type M3ThemeMode,
} from "./constants";

export type { SchemeVariant };
/** `light`, `dark`, or `system` (follow the OS). */
export type ThemeMode = M3ThemeMode;

export interface M3ThemeContextType {
  themeMode: ThemeMode;
  seedColor: string;
  resolvedTheme: "light" | "dark";
  contrastLevel: number;
  variant: SchemeVariant;
  setThemeMode: (mode: ThemeMode) => void;
  setSeedColor: (seed: string) => void;
  setContrastLevel: (level: number) => void;
  setVariant: (variant: SchemeVariant) => void;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToColorScheme(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const prefersDark = (): boolean => window.matchMedia(DARK_QUERY).matches;
const serverPrefersDark = (): boolean => false;

/** The stored preference, or `undefined` when the cookie is absent or invalid. */
function readStoredMode(cookieName: string): ThemeMode | undefined {
  const prefix = `${validateThemeCookieName(cookieName)}=`;
  const value = document.cookie
    .split(/;\s*/)
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
  return value === "light" || value === "dark" || value === "system" ? value : undefined;
}

const M3ThemeContext = createContext<M3ThemeContextType | undefined>(undefined);

export interface M3ThemeProviderProps {
  children?: ReactNode;
  /** The mode the server rendered; with a static shell, the mode used until the cookie is read (default `system`). */
  defaultThemeMode?: ThemeMode;
  /** Source colour of the scheme in the document (default `#6750a4`). */
  defaultSeedColor?: string;
  defaultVariant?: SchemeVariant;
  defaultContrastLevel?: number;
  /**
   * The scheme of the default seed, variant and contrast is already in the document (M3Html inlines it).
   * Set `false` when it is not: the roles are then computed in the browser on mount.
   */
  schemeInlined?: boolean;
  /** Cookie that stores the preference (default `m3-theme`). */
  cookieName?: string;
  /** Element that receives a custom scheme (default `<html>`). */
  target?: HTMLElement;
}

/**
 * Theme state for the app. Writes the preference cookie, keeps `.dark`, `.light`, `data-m3-theme` and `color-scheme` on
 * `<html>` in step, and adopts a saved preference after hydration when the server could not read it (static shell).
 */
export function M3ThemeProvider({
  children,
  defaultThemeMode = "system",
  defaultSeedColor = M3_BASELINE_SEED,
  defaultVariant = "tonalSpot",
  defaultContrastLevel = 0,
  schemeInlined = true,
  cookieName = M3_THEME_COOKIE,
  target,
}: M3ThemeProviderProps) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(defaultThemeMode);
  const [seedColor, setSeedColor] = useState(defaultSeedColor);
  const [contrastLevel, setContrastLevel] = useState(defaultContrastLevel);
  const [variant, setVariant] = useState<SchemeVariant>(defaultVariant);
  const initial = useRef({
    seed: defaultSeedColor,
    variant: defaultVariant,
    contrast: defaultContrastLevel,
  });

  const systemDark = useSyncExternalStore(subscribeToColorScheme, prefersDark, serverPrefersDark);
  const resolvedTheme: "light" | "dark" =
    themeMode === "system" ? (systemDark ? "dark" : "light") : themeMode;

  // Cookie and <html>. The first run adopts a saved preference the server did not see, and leaves <html> to the
  // pre-paint script until the adopted mode renders; later runs write the cookie and the classes.
  const adopted = useRef(false);
  useEffect(() => {
    if (!adopted.current) {
      adopted.current = true;
      const stored = readStoredMode(cookieName);
      if (stored !== undefined && stored !== themeMode) {
        // oxlint-disable-next-line react/set-state-in-effect -- adoption unique au premier montage de la préférence de thème enregistrée dans le cookie (synchronisation avec un stockage externe)
        setThemeMode(stored);
        return;
      }
    }
    // The theme cookie is the documented bridge to the server render; Cookie Store is not in every browser yet.
    // oxlint-disable-next-line unicorn/no-document-cookie
    document.cookie = themeCookie(themeMode, cookieName);
    const root = document.documentElement;
    root.classList.toggle("light", themeMode === "light");
    root.classList.toggle("dark", resolvedTheme === "dark");
    root.dataset["m3Theme"] = themeMode;
    root.style.colorScheme = resolvedTheme;
  }, [themeMode, resolvedTheme, cookieName]);

  // A scheme other than the inlined one is computed on demand: the engine is a separate chunk.
  const applied = useRef(false);
  useEffect(() => {
    const custom =
      seedColor !== initial.current.seed ||
      variant !== initial.current.variant ||
      contrastLevel !== initial.current.contrast;
    if (schemeInlined && !custom && !applied.current) return;
    let cancelled = false;
    void (async () => {
      const { applyDynamicColor, clearDynamicColor } =
        await import("@aphrody/m3-tokens/dynamic-color");
      if (cancelled) return;
      const element = target ?? document.documentElement;
      if (schemeInlined && !custom) {
        clearDynamicColor(element);
        applied.current = false;
        return;
      }
      applyDynamicColor(seedColor, {
        dark: resolvedTheme === "dark",
        variant,
        contrastLevel,
        target: element,
      });
      applied.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [seedColor, variant, contrastLevel, resolvedTheme, schemeInlined, target]);

  const value = useMemo<M3ThemeContextType>(
    () => ({
      themeMode,
      seedColor,
      resolvedTheme,
      contrastLevel,
      variant,
      setThemeMode,
      setSeedColor,
      setContrastLevel,
      setVariant,
    }),
    [themeMode, seedColor, resolvedTheme, contrastLevel, variant],
  );
  return <M3ThemeContext.Provider value={value}>{children}</M3ThemeContext.Provider>;
}

/** The theme state and its setters; throws outside {@link M3ThemeProvider}. */
export function useM3Theme(): M3ThemeContextType {
  const context = useContext(M3ThemeContext);
  if (context === undefined) throw new Error("useM3Theme must be used within an M3ThemeProvider");
  return context;
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
  /** The server inlined the scheme of `seed` (default `true`; `M3Root` with `inlineScheme={false}` passes `false`). */
  schemeInlined?: boolean;
}

/** {@link M3ThemeProvider} with the prop names of `M3Root` (`initialMode`, `seed`, `variant`, `contrast`). */
export function M3NextThemeProvider({
  children,
  initialMode,
  seed,
  variant,
  contrast,
  cookieName,
  schemeInlined,
}: M3NextThemeProviderProps) {
  return (
    <M3ThemeProvider
      defaultThemeMode={initialMode}
      defaultSeedColor={seed}
      defaultVariant={variant}
      defaultContrastLevel={contrast}
      cookieName={cookieName}
      schemeInlined={schemeInlined}
    >
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
