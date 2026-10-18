// SPDX-License-Identifier: Apache-2.0
// Applies the open requests the OS hands to Aphrody (`aphrody://` links, "Open with"): the native
// side queues them and emits `aphrody://open`; the main window drains the queue here.
import { listen } from "./web-runtime";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { desktopRoutes } from "./desktop-navigation";
import { filesPrompt, intentsOf, type LinkDestination, type OpenIntent, type OpenRequest } from "./open-requests";
import { isTauri, tauriInvoke } from "./tauri-bridge";

export const OPEN_EVENT = "aphrody://open";

/** Route of each link destination. */
export const destinationRoutes: Record<LinkDestination, string> = {
  agent: desktopRoutes.chat,
  chat: desktopRoutes.chat,
  files: desktopRoutes.files,
  drive: `${desktopRoutes.studio}?section=drive`,
  models: desktopRoutes.models,
  windows: desktopRoutes.settings,
  settings: desktopRoutes.settings,
  creator: desktopRoutes.creator,
  admin: desktopRoutes.admin,
};

/** Where one intent leads and the navigation state it carries. */
export function routeOf(intent: OpenIntent): {
  to: string;
  state?: { initialPrompt: string };
} {
  switch (intent.kind) {
    case "navigate":
      return { to: destinationRoutes[intent.destination] };
    case "ask":
      return {
        to: desktopRoutes.chat,
        state: { initialPrompt: intent.prompt },
      };
    case "files":
      return {
        to: desktopRoutes.chat,
        state: { initialPrompt: filesPrompt(intent.paths) },
      };
    case "thread":
      return { to: desktopRoutes.chat };
  }
}

export function useOpenRequests(): void {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    const drain = async () => {
      const requests = (await tauriInvoke<OpenRequest[]>("aphrody_take_open_requests")) ?? [];
      // The last intent wins: one navigation per batch.
      const last = intentsOf(requests).at(-1);
      if (active && last) {
        const { to, state } = routeOf(last);
        navigate(to, state ? { state } : undefined);
      }
    };
    void drain().catch(() => undefined);
    const unlisten = listen(OPEN_EVENT, () => void drain().catch(() => undefined));
    return () => {
      active = false;
      void unlisten.then(stop => stop()).catch(() => undefined);
    };
  }, [navigate]);
}
