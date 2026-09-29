// SPDX-License-Identifier: Apache-2.0
// Dependency-free constants shared by every entry (the client bundle imports only these).

/** Theme preference persisted in the cookie: a forced mode or the OS preference. */
export type M3ThemeMode = "light" | "dark" | "system";

/** Cookie that carries the theme preference between the client toggle and the server render. */
export const M3_THEME_COOKIE = "m3-theme";
/** The Material 3 baseline source colour. */
export const M3_BASELINE_SEED = "#6750a4";
/** One year, in seconds: the lifetime of the theme cookie. */
export const M3_THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The `Set-Cookie`-style string the client toggle writes. */
export function themeCookie(mode: M3ThemeMode, name: string = M3_THEME_COOKIE): string {
  return `${name}=${mode}; path=/; max-age=${M3_THEME_COOKIE_MAX_AGE}; samesite=lax`;
}
