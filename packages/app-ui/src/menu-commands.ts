// SPDX-License-Identifier: Apache-2.0
// App menu commands: the native macOS menu (crates/ui/app/src/lib.rs) emits
// `aphrody://menu/*` events; on Windows/Linux there is no native menu, so the same
// accelerators are handled in the webview. Both paths run the same UI actions.

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { desktopRoutes } from "./desktop-navigation";
import { useChatStore } from "./stores/chat-store";
import { isTauri, pickDirectory, pickFile } from "./tauri-bridge";

export type MenuCommand = "new-session" | "open-file" | "open-folder";

/** Tauri event emitted by the native menu for each command. */
export const MENU_EVENTS: Record<MenuCommand, string> = {
  "new-session": "aphrody://menu/new-session",
  "open-file": "aphrody://menu/open-file",
  "open-folder": "aphrody://menu/open-folder",
};

/** Window event other UI (command palette) dispatches to run a menu command. */
export const MENU_COMMAND_EVENT = "aphrody:menu-command";

export function dispatchMenuCommand(command: MenuCommand): void {
  window.dispatchEvent(new CustomEvent<MenuCommand>(MENU_COMMAND_EVENT, { detail: command }));
}

/** Display label of each accelerator (CmdOrCtrl on the native side). */
export function menuShortcut(command: MenuCommand, mac: boolean): string[] {
  const mod = mac ? "⌘" : "Ctrl";
  switch (command) {
    case "new-session":
      return [mod, "N"];
    case "open-file":
      return [mod, "O"];
    case "open-folder":
      return [mod, mac ? "⇧" : "Shift", "O"];
  }
}

interface PlatformNavigator {
  platform?: string;
  userAgentData?: { platform?: string };
}

/** True on macOS (where the native menu owns the accelerators). */
export function isMacPlatform(nav: PlatformNavigator | undefined = globalThis.navigator): boolean {
  if (!nav) return false;
  const platform = nav.userAgentData?.platform || nav.platform || "";
  return /mac|iphone|ipad/i.test(platform);
}

type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** Map a non-macOS keydown to a menu command (Ctrl+N, Ctrl+O, Ctrl+Shift+O). */
export function menuCommandForKey(event: KeyLike): MenuCommand | null {
  if (!event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "n" && !event.shiftKey) return "new-session";
  if (key === "o") return event.shiftKey ? "open-folder" : "open-file";
  return null;
}

/** Mount once in the shell: wires native menu events and the non-macOS accelerators. */
export function useMenuCommands(): void {
  const navigate = useNavigate();
  const requestNewSession = useChatStore(state => state.requestNewSession);

  useEffect(() => {
    const run = async (command: MenuCommand) => {
      if (command === "new-session") {
        requestNewSession();
        navigate(desktopRoutes.chat);
        return;
      }
      const path =
        command === "open-file" ? await pickFile("Ouvrir un fichier") : await pickDirectory("Ouvrir un dossier");
      if (path) navigate(`/explorer?path=${encodeURIComponent(path)}`);
    };

    let disposed = false;
    const unlisteners: Array<() => void> = [];
    if (isTauri()) {
      void (async () => {
        const { listen } = await import("@aphrody/tauri/api/event");
        const commands = Object.keys(MENU_EVENTS) as MenuCommand[];
        const handles = await Promise.all(
          commands.map(command => listen(MENU_EVENTS[command], () => void run(command))),
        );
        for (const unlisten of handles) {
          if (disposed) unlisten();
          else unlisteners.push(unlisten);
        }
      })().catch(() => {});
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const command = menuCommandForKey(event);
      if (!command) return;
      event.preventDefault();
      void run(command);
    };
    const onDispatch = (event: Event) => {
      const command = (event as CustomEvent<MenuCommand>).detail;
      if (command in MENU_EVENTS) void run(command);
    };
    window.addEventListener(MENU_COMMAND_EVENT, onDispatch);
    const keyboard = !isMacPlatform();
    if (keyboard) window.addEventListener("keydown", onKeyDown);

    return () => {
      disposed = true;
      window.removeEventListener(MENU_COMMAND_EVENT, onDispatch);
      for (const unlisten of unlisteners) unlisten();
      if (keyboard) window.removeEventListener("keydown", onKeyDown);
    };
  }, [navigate, requestNewSession]);
}
