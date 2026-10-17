import { M3ThemeProvider, useM3Theme, type ThemeMode } from "@aphrody/m3-theme/react";
import { useEffect } from "react";
import { Shell } from "./shell/Shell.tsx";

export const THEME_STORAGE_KEY = "aphrody-m3-showcase-theme";

export function savedThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

function ThemePersistence() {
  const { themeMode } = useM3Theme();
  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // Session state still works when the host disables persistent browser storage.
    }
  }, [themeMode]);
  return null;
}

export function App() {
  return (
    <M3ThemeProvider defaultSeedColor="#8c6c88" defaultThemeMode={savedThemeMode()} defaultVariant="tonalSpot">
      <ThemePersistence />
      <Shell />
    </M3ThemeProvider>
  );
}
