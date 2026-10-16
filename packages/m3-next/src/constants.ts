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

/** Reject names that cannot be represented by a single HTTP cookie. */
export function validateThemeCookieName(name: string): string {
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
    throw new Error("M3 theme cookie name must be an HTTP cookie token");
  }
  return name;
}

/** The `Set-Cookie`-style string the client toggle writes. */
export function themeCookie(mode: M3ThemeMode, name: string = M3_THEME_COOKIE): string {
  return `${validateThemeCookieName(name)}=${mode}; path=/; max-age=${M3_THEME_COOKIE_MAX_AGE}; samesite=lax`;
}

/** Parse a cookie value into a theme mode; anything else yields `fallback`. */
export function parseThemeMode(
  value: string | undefined | null,
  fallback: M3ThemeMode = "system",
): M3ThemeMode {
  return value === "light" || value === "dark" || value === "system" ? value : fallback;
}
