// Shared pieces of the Bun Engine frontend: types, state, the API client, toasts, footer hints
// (with the glyphs of the connected pad) and focus helpers.
import { glyph, type PadKind, type Token } from "./glyphs";
import { play } from "./sounds";

export interface Route {
  id: string;
  kind: "native" | "bin" | "libretro" | "embedded";
  label: string;
  available: boolean;
  reason?: string;
  extensions?: string[];
}

export interface SystemRow {
  id: string;
  name: string;
  manufacturer: string;
  year: number;
  extensions: string[];
  games: number;
  /** The id of a game whose cover the card shows. */
  cover: number | null;
  routes: Route[];
  defaultRoute: string | null;
}

export interface Game {
  id: number;
  system: string;
  path: string;
  file: string;
  name: string;
  source: string;
  size: number;
  crc: string | null;
  md5: string | null;
  title: string | null;
  description: string | null;
  developer: string | null;
  year: string | null;
  region: string | null;
  dat: string | null;
  route: string | null;
  cover: string | null;
  favorite: number;
  playCount: number;
  lastPlayed: string | null;
}

export interface Job {
  id: number;
  title: string;
  status: "running" | "done" | "failed";
  result?: unknown;
  error?: string;
}

export interface LaunchResult {
  ok: boolean;
  route: string;
  mode: string;
  pid?: number;
  exitCode?: number | null;
  alive?: boolean;
  ms: number;
  output?: string;
  error?: string;
  player?: string;
}

export type Tab = "home" | "systems" | "games" | "game" | "search" | "settings" | "bios" | "installer" | "sources";

/** A declared non-game app (home page tile), as /api/apps reports it. */
export interface AppRow {
  id: string;
  title: string;
  icon: string;
  command: string[];
  available: boolean;
  reason?: string;
  pid?: number;
}

export const view = document.querySelector<HTMLElement>("#view")!;
export const hints = document.querySelector<HTMLElement>("#hints")!;
export const status = document.querySelector<HTMLElement>("#status")!;
const toastBox = document.querySelector<HTMLElement>("#toast")!;

export const state: {
  tab: Tab;
  /** Where Back goes from the current screen. */
  from: Tab;
  systems: SystemRow[];
  system?: SystemRow;
  games: Game[];
  game?: Game;
  lastSystem?: string;
  lastGame?: number;
  jobs: Job[];
  running: Array<{ pid: number; game: number; route: string }>;
  profile: string;
  pad: PadKind;
  offline: boolean;
} = {
  tab: "home",
  from: "home",
  systems: [],
  games: [],
  jobs: [],
  running: [],
  profile: localStorage.getItem("bunos.profile") || "default",
  pad: "none",
  offline: false,
};

export const h = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** A request that never reached the service (as opposed to one it answered with an error). */
export class OfflineError extends Error {
  constructor() {
    super("The Bun Engine service does not answer");
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: init?.json === undefined ? undefined : { "content-type": "application/json" },
      body: init?.json === undefined ? init?.body : JSON.stringify(init.json),
    });
  } catch {
    setOffline(true);
    throw new OfflineError();
  }
  setOffline(false);
  const value = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? response.statusText);
  return value;
}

function setOffline(offline: boolean): void {
  if (state.offline === offline) return;
  state.offline = offline;
  document.querySelector("#offline")?.toggleAttribute("hidden", !offline);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string, kind: "info" | "ok" | "error" = "info"): void {
  if (kind === "error") play("error");
  toastBox.textContent = message;
  toastBox.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastBox.className = "toast"), kind === "error" ? 7000 : 3500);
}

// ---- footer hints ---------------------------------------------------------------------------------

export type Hint = [token: Token, label: string, key?: string];
let shown: Hint[] = [];

export function setHints(items: Hint[]): void {
  shown = items;
  renderHints();
}

export const currentHints = () => shown;

export function renderHints(): void {
  hints.innerHTML = shown
    .map(([token, label, key]) => `<span class="hint">${glyph(token, state.pad, key)}<span>${h(label)}</span></span>`)
    .join("");
}

export function formatSize(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

/** "3 min ago", "2 days ago", else the date: short, own wording. */
export function ago(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  if (seconds < 86400 * 14) return `${Math.round(seconds / 86400)} days ago`;
  return new Date(iso).toLocaleDateString();
}

// ---- tabs and focus -------------------------------------------------------------------------------

export function markTab(active: Tab = state.tab): void {
  // a game page belongs to the page it was opened from
  const base: Tab = active === "game" ? (state.from === "game" ? "home" : state.from) : active;
  const group: Tab = base === "games" ? "systems" : ["bios", "installer", "sources"].includes(base) ? "settings" : base;
  for (const button of document.querySelectorAll<HTMLElement>("[data-tab]")) {
    const on = button.dataset.tab === group;
    button.classList.toggle("active", on);
    if (on) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}

export function motionReduced(): boolean {
  const forced = document.documentElement.dataset.motion;
  if (forced === "reduced") return true;
  if (forced === "full") return false;
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Brings a focused element into view: shelves centre it sideways, the hero pulls the page up. */
export function reveal(element: HTMLElement): void {
  const behavior: ScrollBehavior = motionReduced() ? "auto" : "smooth";
  if (element.closest(".hero")) document.querySelector("#view")?.scrollTo({ top: 0, behavior });
  else element.scrollIntoView({ block: "nearest", inline: element.closest(".shelf") ? "center" : "nearest", behavior });
}

/** Open overlays, the last one on top: the pad and Tab only reach the top one. */
export const overlayStack: HTMLElement[] = [];

export function focusFirst(selector: string): void {
  const scope: ParentNode = overlayStack.at(-1) ?? document;
  const element = scope.querySelector<HTMLElement>(selector) ?? focusable().find(item => !item.closest("#top"));
  element?.focus({ preventScroll: true });
  if (element) reveal(element);
}

/** The controls the pad can reach: inside the open overlay only, else the whole page. */
export function focusable(): HTMLElement[] {
  const scope: ParentNode = overlayStack.at(-1) ?? document;
  return [...scope.querySelectorAll<HTMLElement>("[data-nav]")].filter(
    element => element.offsetParent !== null && !element.closest("[inert]"),
  );
}
