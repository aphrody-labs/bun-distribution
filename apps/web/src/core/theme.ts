// SPDX-License-Identifier: Apache-2.0
import { applyDynamicColor } from "../../../../m3/packages/m3-tokens/src/dynamic-color";

/**
 * Writes every --md-sys-color-* role derived from `seedColor` on <html> and toggles the `dark` class.
 * Without `dark`, keeps the mode currently set on <html>. Returns false (and changes nothing) for an
 * invalid seed.
 */
export function applyM3Theme(seedColor: string, dark?: boolean): boolean {
  if (typeof document === "undefined") return false;
  const root = document.documentElement;
  const isDark = dark ?? root.classList.contains("dark");
  try {
    applyDynamicColor(seedColor, { dark: isDark, target: root });
  } catch {
    return false;
  }
  root.classList.toggle("dark", isDark);
  return true;
}
