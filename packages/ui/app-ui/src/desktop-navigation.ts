// SPDX-License-Identifier: Apache-2.0

/** The only top-level destinations in the Aphrody desktop shell. */
export const desktopRoutes = {
  chat: "/chat",
  files: "/explorer",
  models: "/models",
  studio: "/studio",
  settings: "/settings",
} as const;

/** Legacy URLs remain safe upgrade paths, not public desktop surfaces. */
export const legacyRouteRedirects = {
  codex: desktopRoutes.chat,
  favorites: desktopRoutes.files,
  search: desktopRoutes.files,
  jobs: desktopRoutes.files,
  tasks: desktopRoutes.files,
} as const;
