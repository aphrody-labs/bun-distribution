// SPDX-License-Identifier: Apache-2.0
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { setWindowTitle } from "./metadata";

export type RouterMode = "tauri" | "vite" | "browser";
export type RouteParams = Record<string, string | string[]>;

export interface NextMigrateContextValue {
  pathname: string;
  searchParams: URLSearchParams;
  params: RouteParams;
  mode: RouterMode;
  navigate: (url: string, options?: { replace?: boolean; scroll?: boolean }) => void;
  back: () => void;
  forward: () => void;
  refresh: () => void;
  openExternal: (url: string) => Promise<void>;
}

/** Minimal window surface used to hand external URLs to the OS (Tauri plugins or the browser). */
export interface ExternalOpenerWindow {
  __TAURI__?: {
    opener?: { openUrl?: (url: string) => Promise<void> };
    shell?: { open?: (url: string) => Promise<void> };
  };
  __TAURI_PLUGIN_SHELL__?: { open?: (url: string) => Promise<void> };
  open: (url: string, target: string, features: string) => unknown;
}

/**
 * Open `url` outside the app. Tauri 3 apps expose `plugin-opener` (`openUrl`), Tauri 2 apps `plugin-shell`
 * (`open`); anything else falls back to `window.open`.
 */
export async function openExternalUrl(
  url: string,
  mode: RouterMode,
  win: ExternalOpenerWindow | undefined,
): Promise<void> {
  if (!win) return;
  if (mode === "tauri") {
    try {
      const opener = win.__TAURI__?.opener;
      if (opener?.openUrl) {
        await opener.openUrl(url);
        return;
      }
      const shell = win.__TAURI__?.shell ?? win.__TAURI_PLUGIN_SHELL__;
      if (shell?.open) {
        await shell.open(url);
        return;
      }
    } catch {
      // Fall back to window.open
    }
  }
  win.open(url, "_blank", "noopener,noreferrer");
}

const NextMigrateContext = createContext<NextMigrateContextValue | null>(null);

export interface NextMigrateProviderProps {
  children: ReactNode;
  initialPath?: string;
  mode?: RouterMode;
  useHashRouting?: boolean;
  params?: RouteParams;
  onNavigate?: (url: string) => void;
}

const pathParts = (value: string): { pathname: string; search: string } => {
  const url = new URL(value || "/", "http://m3.invalid");
  return { pathname: url.pathname || "/", search: url.search };
};

function back() {
  if (typeof window !== "undefined") window.history.back();
}
function forward() {
  if (typeof window !== "undefined") window.history.forward();
}

const NO_PARAMS: RouteParams = {};

export function NextMigrateProvider({
  children,
  initialPath,
  mode = "tauri",
  useHashRouting,
  params = NO_PARAMS,
  onNavigate,
}: NextMigrateProviderProps) {
  const isHash =
    useHashRouting ?? (mode === "tauri" || (typeof window !== "undefined" && window.location.protocol === "file:"));
  const parseLocation = useCallback((): {
    pathname: string;
    search: string;
  } => {
    if (typeof window === "undefined") return pathParts(initialPath ?? "/");
    if (isHash) return pathParts(window.location.hash.replace(/^#/, ""));
    return {
      pathname: window.location.pathname || "/",
      search: window.location.search || "",
    };
  }, [initialPath, isHash]);
  // The first browser render must match the explicit server route; adopt the browser after hydration.
  const [currentLoc, setCurrentLoc] = useState(() =>
    initialPath !== undefined ? pathParts(initialPath) : parseLocation(),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleLocationChange = () => {
      setCurrentLoc(parseLocation());
    };

    window.addEventListener("popstate", handleLocationChange);
    window.addEventListener("hashchange", handleLocationChange);
    handleLocationChange();

    // Synchronize document.title to Tauri desktop window
    if (typeof document !== "undefined") {
      if (document.title) {
        setWindowTitle(document.title);
      }
      const titleElem = document.querySelector("title");
      let observer: MutationObserver | null = null;
      if (titleElem && typeof MutationObserver !== "undefined") {
        observer = new MutationObserver(() => {
          if (document.title) {
            setWindowTitle(document.title);
          }
        });
        observer.observe(titleElem, {
          subtree: true,
          characterData: true,
          childList: true,
        });
      }
      return () => {
        window.removeEventListener("popstate", handleLocationChange);
        window.removeEventListener("hashchange", handleLocationChange);
        observer?.disconnect();
      };
    }

    return () => {
      window.removeEventListener("popstate", handleLocationChange);
      window.removeEventListener("hashchange", handleLocationChange);
    };
  }, [parseLocation]);

  const searchParams = useMemo(() => {
    return new URLSearchParams(currentLoc.search);
  }, [currentLoc.search]);

  const navigate = useCallback(
    (url: string, options?: { replace?: boolean; scroll?: boolean }) => {
      if (typeof window === "undefined") return;

      if (isHash) {
        const targetHash = `#${url.startsWith("/") ? url : `/${url}`}`;
        if (options?.replace) {
          window.location.replace(targetHash);
        } else {
          window.location.hash = targetHash;
        }
        setCurrentLoc(parseLocation());
      } else {
        if (options?.replace) {
          window.history.replaceState({}, "", url);
        } else {
          window.history.pushState({}, "", url);
        }
        setCurrentLoc(parseLocation());
      }

      if (options?.scroll !== false) {
        window.scrollTo(0, 0);
      }

      onNavigate?.(url);
    },
    [isHash, onNavigate, parseLocation],
  );

  const refresh = useCallback(() => {
    setCurrentLoc(parseLocation());
  }, [parseLocation]);

  const openExternal = useCallback(
    (url: string) => openExternalUrl(url, mode, typeof window === "undefined" ? undefined : window),
    [mode],
  );

  const value = useMemo<NextMigrateContextValue>(
    () => ({
      pathname: currentLoc.pathname,
      searchParams,
      params,
      mode,
      navigate,
      back,
      forward,
      refresh,
      openExternal,
    }),
    [currentLoc.pathname, searchParams, params, mode, navigate, refresh, openExternal],
  );

  return <NextMigrateContext.Provider value={value}>{children}</NextMigrateContext.Provider>;
}

export function useNextMigrateContext(): NextMigrateContextValue {
  const ctx = useContext(NextMigrateContext);
  if (!ctx) {
    // Provide a safe fallback if used outside NextMigrateProvider
    const isBrowser = typeof window !== "undefined";
    return {
      pathname: isBrowser ? window.location.pathname || "/" : "/",
      searchParams: new URLSearchParams(isBrowser ? window.location.search : ""),
      params: {},
      mode: "browser",
      navigate: (url, opts) => {
        if (!isBrowser) return;
        if (opts?.replace) {
          window.location.replace(url);
        } else {
          window.location.assign(url);
        }
      },
      back: () => {
        if (isBrowser) window.history.back();
      },
      forward: () => {
        if (isBrowser) window.history.forward();
      },
      refresh: () => {
        if (isBrowser) window.location.reload();
      },
      openExternal: async url => {
        if (isBrowser) window.open(url, "_blank", "noopener,noreferrer");
      },
    };
  }
  return ctx;
}

/** Gives pages and their layouts the params matched by the generated router. */
export function RouteParamsProvider({ params, children }: { params: RouteParams; children: ReactNode }) {
  const context = useNextMigrateContext();
  const contextValue = useMemo(() => ({ ...context, params }), [context, params]);
  return <NextMigrateContext.Provider value={contextValue}>{children}</NextMigrateContext.Provider>;
}
