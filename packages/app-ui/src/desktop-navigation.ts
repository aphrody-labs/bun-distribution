// SPDX-License-Identifier: Apache-2.0

/** The only top-level destinations in the Aphrody desktop shell. */
export const desktopRoutes = {
  chat: "/chat",
  files: "/explorer",
  models: "/models",
  studio: "/studio",
  creator: "/creator",
  admin: "/admin",
  settings: "/settings",
} as const;

/** Destinations served by the in-browser Rust WebAssembly backend; absent from the Tauri app. */
export const browserOnlyRoutes = { terminal: "/terminal", games: "/games" } as const;

/**
 * Kit surfaces (crates/ui/app/src/kits.rs): shown in the navigation only when the kit answers,
 * and the admin surface only once the team's access pack is imported. Deep links
 * `aphrody://creator` and `aphrody://admin` open them in every case.
 */
export const kitDestinations = {
  creator: { route: desktopRoutes.creator, kit: "creator" },
  admin: { route: desktopRoutes.admin, kit: "omar" },
} as const;

/** Legacy URLs remain safe upgrade paths, not public desktop surfaces. */
export const legacyRouteRedirects = {
  codex: desktopRoutes.chat,
  favorites: desktopRoutes.files,
  search: desktopRoutes.files,
  jobs: desktopRoutes.files,
  tasks: desktopRoutes.files,
} as const;
