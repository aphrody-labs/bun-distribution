// SPDX-License-Identifier: Apache-2.0
// Runs in <head> before first paint: restores the saved light/dark mode and theme roles, so a returning
// visitor never sees the default theme flash. main.ts stores the stylesheet whenever the theme changes.
try {
  const root = document.documentElement;
  const mode = localStorage.getItem("aph.mode");
  if (mode === "light" || mode === "dark") root.dataset.theme = mode;
  const css = localStorage.getItem("aph.themecss");
  if (css) {
    const style = document.createElement("style");
    style.id = "seed-css";
    style.textContent = css;
    document.head.append(style);
  }
} catch {
  // Storage can be unavailable (private mode, blocked cookies); the default theme then applies.
}
