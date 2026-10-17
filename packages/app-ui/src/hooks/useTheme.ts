// SPDX-License-Identifier: Apache-2.0
import { useEffect } from "react";
import { DEFAULT_PREFERENCES, hydratePreferences, PREFERENCES_KEY, type Preferences } from "../preferences";

export const APPEARANCE_EVENT = "aphrody:preferences-changed";

export function applyTheme(theme: string) {
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme === "light"
        ? "light"
        : "dark";
  const root = document.documentElement;
  root.classList.remove(
    "light",
    "dark",
    "vanilla-theme",
    "midnight-theme",
    "noir-theme",
    "slate-theme",
    "nord-theme",
    "mocha-theme",
  );
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
}

export function applyAppearance(preferences: Pick<Preferences, "theme" | "fontSize" | "reducedMotion">) {
  applyTheme(preferences.theme);
  const size = [18, 20, 22].includes(preferences.fontSize) ? preferences.fontSize : 18;
  document.documentElement.style.setProperty("--aphrody-base-font-size", `${size}px`);
  document.documentElement.classList.toggle("reduce-motion", preferences.reducedMotion);
}

/** Appearance belongs to the application preferences, independently of Drive availability. */
export function useTheme() {
  useEffect(() => {
    let active = true;
    let current = DEFAULT_PREFERENCES;
    const apply = (preferences: Preferences) => {
      if (!active) return;
      current = preferences;
      applyAppearance(preferences);
    };
    const saved = (event: Event) => apply((event as CustomEvent<Preferences>).detail);
    const systemChanged = () => {
      if (current.theme === "system") applyTheme("system");
    };
    const reload = () => {
      void hydratePreferences()
        .then(apply)
        .catch(() => {});
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === PREFERENCES_KEY) reload();
    };
    apply(current);
    reload();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", systemChanged);
    window.addEventListener(APPEARANCE_EVENT, saved);
    window.addEventListener("storage", storageChanged);
    return () => {
      active = false;
      media.removeEventListener("change", systemChanged);
      window.removeEventListener(APPEARANCE_EVENT, saved);
      window.removeEventListener("storage", storageChanged);
    };
  }, []);
}
