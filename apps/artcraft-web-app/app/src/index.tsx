import { StrictMode, useEffect } from "react";
import { useSignals, useSignalEffect } from "@preact/signals-react/runtime";
import { BrowserRouter } from "react-router-dom";
import { MainApp } from "./pages/MainApp";
import { GlobalFileDropHandler } from "./components/GlobalFileDropHandler/GlobalFileDropHandler";
import { createRoot } from "react-dom/client";
import "./styles/normalize.css";
import "./styles/tailwind.css";
import "./styles/base.css";
import "m3:theme.css";
import "./styles/aphrody.css";
import EnvironmentVariables from "~/Classes/EnvironmentVariables";
import { pageHeight, pageWidth, persistLogin } from "~/signals";
import { SyncStorytellerApiConfig } from "./api/SyncStorytellerApiConfig";
import { posthog } from "posthog-js";
import { SoundManager } from "@storyteller/soundboard";
import { useModelsStore } from "@storyteller/tauri-api";

// TODO(bt,2025-04-19): Make these configurable
const ENV = {
  GOOGLE_API: "https://studio.storyteller.ai",
  FUNNEL_API: "https://studio.storyteller.ai",
  CDN_API: "https://cdn-2.fakeyou.com",
  GRAVATAR_API: "https://studio.storyteller.ai",
  DEPLOY_PRIME_URL: "https://studio.storyteller.ai",
};

const themeRoot = document.documentElement;
const allowedThemes = [
  "light",
  "dark",
  "gray",
  "black",
  "aurora",
  "sunset",
  "gradient",
];
let storedTheme = "dark";
try {
  storedTheme = (localStorage.getItem("st-theme") || "dark").trim();
} catch {
  // A blocked localStorage should not prevent the editor from rendering.
}
const initialTheme = allowedThemes.includes(storedTheme)
  ? storedTheme === "gradient"
    ? "aurora"
    : storedTheme
  : "dark";
for (let index = themeRoot.classList.length - 1; index >= 0; index--) {
  const themeClass = themeRoot.classList.item(index);
  if (themeClass?.startsWith("theme-")) themeRoot.classList.remove(themeClass);
}
themeRoot.classList.add(`theme-${initialTheme}`);

const syncM3Mode = () => {
  const dark = !themeRoot.classList.contains("theme-light");
  themeRoot.classList.toggle("dark", dark);
  themeRoot.classList.toggle("light", !dark);
};
syncM3Mode();

const GlobalSettingsManager = ({ env }: { env: Record<string, string> }) => {
  console.log("GlobalSettingsManager()");

  SyncStorytellerApiConfig();

  useSignals();

  useSignalEffect(() => {
    persistLogin();
  });

  useEffect(() => {
    const observer = new MutationObserver(syncM3Mode);
    observer.observe(themeRoot, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  /// Initizations that depends on ENV vars ///
  function PostHogInit() {
    const apiKey = import.meta.env.VITE_POSTHOG_API_KEY;
    if (!apiKey) return;
    posthog.init(apiKey, {
      api_host: "https://us.i.posthog.com/",
      ui_host: "https://us.i.posthog.com/",
    });
  }

  useEffect(() => {
    EnvironmentVariables.initialize(env);
    if (import.meta.env.DEV) {
      return;
    }
    PostHogInit();
  }, [env]);

  /// Initizations that run only once on 1ST mount ///
  function setPage() {
    // TODO address this issue with zooming
    pageHeight.value = window.innerHeight;
    pageWidth.value = window.innerWidth;
  }

  useEffect(() => {
    setPage();
    window.addEventListener("resize", setPage);
    return () => {
      window.removeEventListener("resize", setPage);
    };
  }, []);

  useEffect(() => {
    SoundManager.install();
  }, []);

  // Reconcile the model dropdowns against the backend omni listing once on boot.
  // The store is already seeded with the static overlay, so a failure here is a
  // no-op (the UI keeps the overlay models).
  useEffect(() => {
    void useModelsStore.getState().loadModelsFromBackend();
  }, []);

  return null;
};

// TODO: Replace environment variables from `root.tsx`
createRoot(document.getElementById("root")!).render(
  <>
    <StrictMode>
      <BrowserRouter>
        <GlobalSettingsManager env={ENV} />
        <div className="topbar-spacer" data-tauri-drag-region={true} />
        <MainApp />
        <GlobalFileDropHandler />
      </BrowserRouter>
    </StrictMode>
  </>,
);
