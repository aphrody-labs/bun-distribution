// The frontend session: whether it runs as a gamescope kiosk, and the hooks the power menu
// (`POST /api/session/:action`) uses to leave the session or restart the app window. `runFrontend`
// registers the hooks; a bare `bun-engine web` server has none and the page only reloads.
import { runningGames, stopGame } from "./launch";

export type SessionAction = "exit" | "restart";

export interface SessionHooks {
  /** The app window can be closed and reopened (the page is a kiosk window we spawned). */
  window: boolean;
  exit(): void;
  restart(): void;
}

let hooks: SessionHooks | undefined;

export function setSessionHooks(next: SessionHooks | undefined): void {
  hooks = next;
}

export function sessionHooks(): SessionHooks | undefined {
  return hooks;
}

/** Running as a gamescope session: its Wayland/X11 display, or the session variables it sets. */
export function underGamescope(): boolean {
  return Boolean(Bun.env.GAMESCOPE_WAYLAND_DISPLAY) || Bun.env.XDG_CURRENT_DESKTOP === "gamescope";
}

/**
 * Stops every running game, then runs the session action after the response is out.
 * `reload` tells the page to reload itself (restart without an app window of ours).
 */
export function sessionAction(action: SessionAction): { action: SessionAction; stopped: number; reload: boolean } {
  const stopped = runningGames().filter(game => stopGame(game.pid)).length;
  const reload = action === "restart" && !hooks?.window;
  if (action === "exit" && !hooks) throw new Error("this server has no session window to close");
  setTimeout(() => {
    if (action === "exit") hooks?.exit();
    else if (hooks?.window) hooks.restart();
  }, 200);
  return { action, stopped, reload };
}
