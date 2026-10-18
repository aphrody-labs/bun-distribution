// SPDX-License-Identifier: Apache-2.0
// UI preferences shared by the main window and the quick ask bar. Inside the desktop they live
// in the vendored Tauri store plugin (`preferences.json` in the app data directory), which the
// Rust side reads too (crates/ui/app/src/models.rs: `modelsDir` becomes
// `APHRODY_MODELS_DIR` for every `aphrody` child). Values written by earlier builds to
// `localStorage` are migrated once. Outside Tauri (the plain web build) `localStorage` is the
// store. Model routing stays in the `APHRODY_AI_*` contract read by `aphrody app-server`.
import { invoke } from "./web-runtime";

import { isTauri } from "./tauri-bridge";

export type SearchSources = {
  /** Match past app-server threads while typing. */
  history: boolean;
  /** Answer arithmetic inline. */
  calculator: boolean;
  /** Direct navigation to areas and surfaces. */
  navigation?: boolean;
  /** Direct system commands starting with '>' or keywords. */
  commands?: boolean;
  /** Recent files and locations. */
  files?: boolean;
};

export type Preferences = {
  version: 1;
  onboarded: boolean;
  sources: SearchSources;
  /** Models folder chosen in onboarding; `null` keeps the CLI default store root. */
  modelsDir: string | null;
  language: string;
  startWithSystem: boolean;
  keepInTray: boolean;
  openWithDefault: boolean;
  theme: "system" | "light" | "dark";
  reducedMotion: boolean;
  fontSize: number;
  defaultModel: string;
  defaultEffort: "none" | "low" | "medium" | "high";
  accessMode: "read-only" | "workspace-write" | "dangerously-bypass";
  trustedFolders: string[];
  agentBinary: string;
};

export const PREFERENCES_KEY = "aphrody.preferences";
/** Store plugin file and keys (mirrored in crates/ui/app/src/models.rs). */
export const STORE_FILE = "preferences.json";
export const STORE_PREFERENCES = "preferences";
export const STORE_THEME = "theme";
export const STORE_SIDEBAR_COLLAPSED = "sidebar.collapsed";
export const SIDEBAR_COLLAPSED_KEY = "aphrody.sidebar.collapsed";
/** `localStorage` keys of earlier builds, migrated once into the store. */
const LEGACY_KEYS: Array<[storeKey: string, legacyKey: string]> = [
  [STORE_PREFERENCES, PREFERENCES_KEY],
  [STORE_THEME, "aphrody.theme"],
  [STORE_SIDEBAR_COLLAPSED, SIDEBAR_COLLAPSED_KEY],
];

/**
 * Detect the operating system language. Defaults to French ("fr") for French systems,
 * otherwise English ("en").
 */
export function detectSystemLanguage(): "fr" | "en" {
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
  }
  return "fr";
}

/**
 * Returns the effective UI language considering user preference and system detection.
 */
export function getEffectiveLanguage(pref?: string): "fr" | "en" {
  const chosen = pref || "system";
  if (chosen === "system") {
    return detectSystemLanguage();
  }
  return chosen.startsWith("fr") ? "fr" : "en";
}

export const DEFAULT_PREFERENCES: Preferences = {
  version: 1,
  onboarded: false,
  sources: {
    history: true,
    calculator: true,
    navigation: true,
    commands: true,
    files: true,
  },
  modelsDir: null,
  language: "system",
  startWithSystem: false,
  keepInTray: true,
  openWithDefault: true,
  theme: "system",
  reducedMotion: false,
  fontSize: 18,
  defaultModel: "gpt-6-luna",
  defaultEffort: "medium",
  accessMode: "dangerously-bypass",
  trustedFolders: [],
  agentBinary: "aphrody",
};

const bool = (item: unknown, fallback: boolean) => (typeof item === "boolean" ? item : fallback);

const str = (item: unknown, fallback: string) => (typeof item === "string" && item.trim() ? item.trim() : fallback);

const num = (item: unknown, fallback: number) => (typeof item === "number" && !isNaN(item) ? item : fallback);

const arr = (item: unknown, fallback: string[]) =>
  Array.isArray(item) ? item.filter((x): x is string => typeof x === "string") : fallback;

/** Merge an untrusted stored value over the defaults, keeping only known fields. */
export function normalizePreferences(value: unknown): Preferences {
  const stored = (value && typeof value === "object" ? value : {}) as Partial<Preferences>;
  const sources = (stored.sources ?? {}) as Partial<SearchSources>;
  const modelsDir = typeof stored.modelsDir === "string" && stored.modelsDir.trim() ? stored.modelsDir.trim() : null;

  return {
    version: 1,
    onboarded: bool(stored.onboarded, DEFAULT_PREFERENCES.onboarded),
    sources: {
      history: bool(sources.history, DEFAULT_PREFERENCES.sources.history),
      calculator: bool(sources.calculator, DEFAULT_PREFERENCES.sources.calculator),
      navigation: bool(sources.navigation, DEFAULT_PREFERENCES.sources.navigation ?? true),
      commands: bool(sources.commands, DEFAULT_PREFERENCES.sources.commands ?? true),
      files: bool(sources.files, DEFAULT_PREFERENCES.sources.files ?? true),
    },
    modelsDir,
    language: str(stored.language, DEFAULT_PREFERENCES.language),
    startWithSystem: bool(stored.startWithSystem, DEFAULT_PREFERENCES.startWithSystem),
    keepInTray: bool(stored.keepInTray, DEFAULT_PREFERENCES.keepInTray),
    openWithDefault: bool(stored.openWithDefault, DEFAULT_PREFERENCES.openWithDefault),
    theme:
      stored.theme === "light" || stored.theme === "dark" || stored.theme === "system"
        ? stored.theme
        : DEFAULT_PREFERENCES.theme,
    reducedMotion: bool(stored.reducedMotion, DEFAULT_PREFERENCES.reducedMotion),
    fontSize: num(stored.fontSize, DEFAULT_PREFERENCES.fontSize),
    defaultModel: str(stored.defaultModel, DEFAULT_PREFERENCES.defaultModel),
    defaultEffort:
      stored.defaultEffort === "none" || stored.defaultEffort === "low" || stored.defaultEffort === "high"
        ? stored.defaultEffort
        : "medium",
    accessMode:
      stored.accessMode === "read-only" || stored.accessMode === "workspace-write"
        ? stored.accessMode
        : "dangerously-bypass",
    trustedFolders: arr(stored.trustedFolders, DEFAULT_PREFERENCES.trustedFolders),
    agentBinary: str(stored.agentBinary, DEFAULT_PREFERENCES.agentBinary),
  };
}

/** Parse a serialized value (legacy `localStorage` form); garbage yields the defaults. */
export function parsePreferences(raw: string | null | undefined): Preferences {
  try {
    return normalizePreferences(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizePreferences({});
  }
}

let storeRid: Promise<number> | null = null;

/** Load the store once per window and migrate the legacy `localStorage` keys into it. */
function openStore(): Promise<number> {
  storeRid ??= invoke<number>("plugin:store|load", { path: STORE_FILE }).then(async rid => {
    await migrateLegacy(rid, globalThis.localStorage);
    return rid;
  });
  storeRid.catch(() => {
    storeRid = null;
  });
  return storeRid;
}

async function migrateLegacy(rid: number, legacy: Storage | undefined) {
  if (!legacy) return;
  const pending = LEGACY_KEYS.flatMap(([storeKey, legacyKey]) => {
    const raw = legacy.getItem(legacyKey);
    return raw === null ? [] : [{ storeKey, legacyKey, raw }];
  });
  if (pending.length === 0) return;
  // A value already in the store wins: the migration runs once, then the legacy key is gone.
  const copied = await Promise.all(
    pending.map(async ({ storeKey, raw }) => {
      const [, exists] = await invoke<[unknown, boolean]>("plugin:store|get", {
        rid,
        key: storeKey,
      });
      if (exists) return false;
      const value = storeKey === STORE_PREFERENCES ? parsePreferences(raw) : raw;
      await invoke("plugin:store|set", { rid, key: storeKey, value });
      return true;
    }),
  );
  if (copied.some(Boolean)) await invoke("plugin:store|save", { rid });
  for (const { legacyKey } of pending) legacy.removeItem(legacyKey);
}

/** Read one setting; `undefined` when it was never written. */
export async function readSetting<T>(key: string): Promise<T | undefined> {
  if (!isTauri()) {
    const raw = globalThis.localStorage?.getItem(`aphrody.${key}`);
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as T;
    }
  }
  const rid = await openStore();
  const [value, exists] = await invoke<[T, boolean]>("plugin:store|get", {
    rid,
    key,
  });
  return exists ? value : undefined;
}

/** Write and flush one setting. Errors propagate to the caller. */
export async function writeSetting(key: string, value: unknown): Promise<void> {
  if (!isTauri()) {
    globalThis.localStorage?.setItem(`aphrody.${key}`, JSON.stringify(value));
    return;
  }
  const rid = await openStore();
  await invoke("plugin:store|set", { rid, key, value });
  await invoke("plugin:store|save", { rid });
}

let cache: Preferences = DEFAULT_PREFERENCES;

/** Last preferences read or written in this window (defaults until {@link hydratePreferences}). */
export function loadPreferences(): Preferences {
  return cache;
}

/** Read the persisted preferences (after the one-time migration) and refresh the cache. */
export async function hydratePreferences(): Promise<Preferences> {
  cache = normalizePreferences(await readSetting<unknown>(STORE_PREFERENCES));
  return cache;
}

/** Persist `prefs` and update the cache. */
export async function savePreferences(prefs: Preferences): Promise<void> {
  await writeSetting(STORE_PREFERENCES, prefs);
  cache = prefs;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("aphrody:preferences-changed", { detail: prefs }));
  }
}

/** Update a subset of preferences, write to persistent store and update the cache. */
export async function updatePreferences(partial: Partial<Preferences>): Promise<Preferences> {
  const current = await hydratePreferences();
  const merged = normalizePreferences({ ...current, ...partial });
  await savePreferences(merged);
  return merged;
}

export type ShortcutEntry = {
  keys: string[];
  action: string;
  scope: "global" | "quickbar";
};

/** Shortcuts actually wired today (global one in crates/ui/app/src/quickbar.rs). */
export const SHORTCUTS: ShortcutEntry[] = [
  {
    keys: ["Ctrl", "K"],
    action: "Open Command Palette / Unified Spotlight",
    scope: "global",
  },
  {
    keys: ["Alt", "Space"],
    action: "Show or hide the quick ask bar",
    scope: "global",
  },
  {
    keys: ["Enter"],
    action: "Ask the question or execute action",
    scope: "quickbar",
  },
  {
    keys: ["Esc"],
    action: "Hide the quick ask bar or command palette",
    scope: "quickbar",
  },
  { keys: ["↑", "↓"], action: "Move through suggestions", scope: "quickbar" },
];

export const ACTIVE_MODEL_KEY = "activeModel";
export const DEFAULT_MODEL_KEY = "defaultModel";

export async function getActiveModelSetting(): Promise<string | null> {
  const stored = await readSetting<string>(ACTIVE_MODEL_KEY);
  if (typeof stored === "string" && stored.trim()) return stored.trim();
  const local = globalThis.localStorage?.getItem(`aphrody.${ACTIVE_MODEL_KEY}`);
  return local && local.trim() ? local.trim() : null;
}

export async function setActiveModelSetting(model: string): Promise<void> {
  await writeSetting(ACTIVE_MODEL_KEY, model.trim());
}

export async function getDefaultModelSetting(): Promise<string | null> {
  const stored = await readSetting<string>(DEFAULT_MODEL_KEY);
  if (typeof stored === "string" && stored.trim()) return stored.trim();
  const local = globalThis.localStorage?.getItem(`aphrody.${DEFAULT_MODEL_KEY}`);
  return local && local.trim() ? local.trim() : null;
}

export async function setDefaultModelSetting(model: string): Promise<void> {
  await writeSetting(DEFAULT_MODEL_KEY, model.trim());
}
