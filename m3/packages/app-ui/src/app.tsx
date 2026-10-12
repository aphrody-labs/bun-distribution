// SPDX-License-Identifier: Apache-2.0
// Unified Aphrody OS Application Shell - Based directly on Spacedrive M3 Navigation & Layout.
// Public Aphrody workspace: chat, files, models and settings.

// oxlint-disable-next-line import/no-unassigned-import
import "m3:symbols.css";
import { type ReactNode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { listen } from "@aphrody/api/event";
import { SpacedriveClient, HttpTransport } from "@aphrody/drive-client";
import { PlatformProvider, type Platform } from "./contexts/PlatformContext";
import { Shell } from "./Shell";
import { explorerRoutes } from "./router";
import { DesktopPet, DesktopWidget, SplashScreen } from "./desktop-surfaces";
import { PetGuide } from "./pet-guide-view";
import { QuickBar } from "./quickbar";
import { appReady, isTauri, pickDirectory, pickFile, tauriInvoke } from "./tauri-bridge";
import { wantsHttpBackend, webOsTransport } from "./webos-backend";

/**
 * Native platform adapter providing OS capabilities (dialogs, window control, links).
 */
const nativePlatform: Platform = {
  platform: isTauri() ? "tauri" : "web",
  openLink(url: string) {
    if (isTauri()) {
      void tauriInvoke("plugin:opener|open_url", { url }).catch(() =>
        window.open(url, "_blank", "noopener,noreferrer"),
      );
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  },
  confirm(message: string, callback: (result: boolean) => void) {
    callback(window.confirm(message));
  },
  async openDirectoryPickerDialog(opts?: { title?: string; multiple?: boolean }) {
    const res = await pickDirectory(opts?.title ?? "Sélectionner un dossier");
    return res;
  },
  async openFilePickerDialog(opts?: { title?: string; multiple?: boolean }) {
    const res = await pickFile(opts?.title ?? "Sélectionner un fichier");
    return res;
  },
  async getDaemonStatus() {
    if (isTauri()) {
      try {
        const res = await tauriInvoke<any>("plugin:aphrody-drive|get_daemon_status");
        if (res) return res;
      } catch {
        // A failed native probe is unavailable, not a running Drive daemon.
        // The Files surface owns the recovery action.
      }
    }
    return {
      is_running: false,
      socket_path: "",
      server_url: null,
      started_by_us: false,
    };
  },
  async getCurrentLibraryId() {
    if (isTauri()) {
      try {
        return await tauriInvoke<string | null>("plugin:aphrody-drive|get_current_library_id");
      } catch {}
    }
    return null;
  },
  getCurrentWindowLabel() {
    return "main";
  },
};

/**
 * Real Spacedrive client connected to the aphrody-drive plugin supervisor.
 */
const client = isTauri()
  ? SpacedriveClient.fromTauri(
      (cmd, args) => {
        const tauriCmd =
          cmd === "daemon_request" ||
          cmd === "subscribe_to_events" ||
          cmd === "unsubscribe_from_events" ||
          cmd === "get_daemon_status" ||
          cmd === "get_current_library_id" ||
          cmd === "set_current_library_id" ||
          cmd === "get_selected_file_ids" ||
          cmd === "set_selected_file_ids" ||
          cmd === "open_drive"
            ? `plugin:aphrody-drive|${cmd}`
            : cmd;
        return tauriInvoke(tauriCmd, args);
      },
      (event, handler) => listen(event, handler),
    )
  : new SpacedriveClient(
      wantsHttpBackend(window.location.search) ? new HttpTransport() : webOsTransport(),
    );

function App() {
  useEffect(() => {
    void appReady();
  }, []);

  return (
    <PlatformProvider platform={nativePlatform}>
      <Shell client={client} routes={explorerRoutes} />
      <PetGuide />
    </PlatformProvider>
  );
}

const view = new URLSearchParams(window.location.search).get("view");
const views: Record<string, () => ReactNode> = {
  quickbar: () => <QuickBar />,
  splash: () => <SplashScreen />,
  pet: () => <DesktopPet />,
  widget: () => <DesktopWidget />,
};

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render((view && views[view]?.()) ?? <App />);
}
