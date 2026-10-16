// SPDX-License-Identifier: Apache-2.0
import {
  windowClassFor,
  type WindowClassState,
} from "@aphrody/m3-front/window-class";
import { useSyncExternalStore } from "react";

export type LayoutMode = "mobile" | "desktop" | "tv";
export const LAYOUT_MODES: readonly LayoutMode[] = ["mobile", "desktop", "tv"];
export const TV_USER_AGENT =
  /SMART-TV|SmartTV|Tizen|Web0S|WebOS|NetCast|HbbTV|BRAVIA|AFTM|AFTB|AFTT|AFTS|Android TV|GoogleTV|CrKey|Viera|Roku|AppleTV|PlayStation|Xbox/i;
export function layoutModeFor(
  width: WindowClassState["width"],
  tv: boolean,
): LayoutMode {
  return tv ? "tv" : width === "compact" ? "mobile" : "desktop";
}
export interface LayoutOverride {
  mode: LayoutMode | null;
}
export function parseOverride(
  search: string,
  stored: string | null,
): LayoutMode | null {
  const params = new URLSearchParams(search);
  const value = params.get("layout") ?? (params.has("tv") ? "tv" : stored);
  return (LAYOUT_MODES as readonly string[]).includes(value ?? "")
    ? (value as LayoutMode)
    : null;
}
export interface AdaptiveState extends WindowClassState {
  widthPx: number;
  heightPx: number;
  mode: LayoutMode;
  tv: boolean;
  source: "user-agent" | "override" | "viewport";
  landscape: boolean;
  touch: boolean;
}
export const STORAGE_KEY = "m3-showcase:layout";
export function adaptiveFor(input: {
  width: number;
  height: number;
  userAgent: string;
  override: LayoutMode | null;
  touch: boolean;
}): AdaptiveState {
  const classes = windowClassFor(input.width, input.height);
  const uaTv = TV_USER_AGENT.test(input.userAgent);
  const mode = input.override ?? layoutModeFor(classes.width, uaTv);
  return {
    ...classes,
    widthPx: input.width,
    heightPx: input.height,
    mode,
    tv: mode === "tv",
    source: input.override ? "override" : uaTv ? "user-agent" : "viewport",
    landscape: input.width >= input.height,
    touch: input.touch,
  };
}
type Listener = () => void;
const listeners = new Set<Listener>();
let snapshot: AdaptiveState | undefined;
// An explicit choice works even when storage is unavailable; a URL is an initial preference.
let sessionOverride: LayoutMode | null | undefined;
const SERVER_SNAPSHOT = adaptiveFor({
  width: 1280,
  height: 800,
  userAgent: "",
  override: null,
  touch: false,
});
let pointerQuery: MediaQueryList | undefined;
function read(): AdaptiveState {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* The session preference still works. */
  }
  const next = adaptiveFor({
    width: window.innerWidth,
    height: window.innerHeight,
    userAgent: navigator.userAgent,
    override:
      sessionOverride === undefined
        ? parseOverride(location.search, stored)
        : sessionOverride,
    touch: window.matchMedia?.("(pointer: coarse)").matches ?? false,
  });
  if (snapshot && JSON.stringify(snapshot) === JSON.stringify(next))
    return snapshot;
  snapshot = next;
  const data = document.documentElement.dataset;
  data["layout"] = next.mode;
  data["m3Width"] = next.width;
  data["m3Height"] = next.height;
  data["m3Nav"] = next.navigation;
  return next;
}
function emit(): void {
  read();
  for (const listener of listeners) listener();
}
function onStorage(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  sessionOverride = undefined;
  emit();
}
/** Set a live preference; persistence is best effort. Clearing returns to the viewport/TV detection. */
export function setLayoutOverride(mode: LayoutMode | null): void {
  if (mode !== null && !LAYOUT_MODES.includes(mode))
    throw new TypeError("Unknown layout mode");
  sessionOverride = mode;
  try {
    if (mode) localStorage.setItem(STORAGE_KEY, mode);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Session only. */
  }
  emit();
}
function subscribe(listener: Listener): () => void {
  if (listeners.size === 0) {
    window.addEventListener("resize", emit, { passive: true });
    window.addEventListener("orientationchange", emit);
    window.addEventListener("popstate", emit);
    window.addEventListener("storage", onStorage);
    pointerQuery = window.matchMedia?.("(pointer: coarse)");
    pointerQuery?.addEventListener("change", emit);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("resize", emit);
      window.removeEventListener("orientationchange", emit);
      window.removeEventListener("popstate", emit);
      window.removeEventListener("storage", onStorage);
      pointerQuery?.removeEventListener("change", emit);
      pointerQuery = undefined;
    }
  };
}
export function useAdaptive(): AdaptiveState {
  return useSyncExternalStore(subscribe, read, () => SERVER_SNAPSHOT);
}
