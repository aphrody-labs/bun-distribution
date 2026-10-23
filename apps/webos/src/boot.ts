// SPDX-License-Identifier: Apache-2.0
// Runs in <head> before first paint: replays the boot snapshot of the appearance preferences (mode, theme
// stylesheet, CSS custom properties and data attributes), so a returning visitor never sees the default flash.
// appearance.ts writes the snapshot whenever an appearance preference changes; IndexedDB holds the real values.
try {
  const root = document.documentElement;
  const raw = localStorage.getItem("aph.boot");
  const snap = raw
    ? (JSON.parse(raw) as {
        mode?: string;
        css?: string;
        vars?: Record<string, string>;
        attrs?: Record<string, string>;
      })
    : {
        mode: localStorage.getItem("aph.mode") ?? undefined,
        css: localStorage.getItem("aph.themecss") ?? undefined,
      };
  if (snap.mode === "light" || snap.mode === "dark")
    root.dataset.theme = snap.mode;
  for (const [k, v] of Object.entries(snap.vars ?? {}))
    root.style.setProperty(k, v);
  for (const [k, v] of Object.entries(snap.attrs ?? {})) root.dataset[k] = v;
  if (snap.css) {
    const style = document.createElement("style");
    style.id = "seed-css";
    style.textContent = snap.css;
    document.head.append(style);
  }
} catch {
  // Storage can be unavailable (private mode, blocked cookies); the default theme then applies.
}
