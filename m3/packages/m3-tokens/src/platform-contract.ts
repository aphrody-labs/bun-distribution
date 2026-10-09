/**
 * Cross-runtime M3 contract consumed by Bun, React, Material Web and Tauri.
 * Rust consumers use the equivalent `aphrody_m3_tokens::adaptive::Breakpoint`
 * enum and its `navigation`/`recommended_panes` methods.
 */
import {
  BREAKPOINTS,
  classifyWidth,
  marginFor,
  navigationFor,
  panesFor,
  type NavigationKind,
  type WindowSizeClass,
} from "./breakpoints";

export interface M3PlatformState {
  sizeClass: WindowSizeClass;
  navigation: NavigationKind;
  panes: 1 | 2 | 3;
  marginDp: 16 | 24;
}

export function platformState(widthDp: number): M3PlatformState {
  const sizeClass = classifyWidth(widthDp);
  return {
    sizeClass,
    navigation: navigationFor(sizeClass),
    panes: panesFor(sizeClass),
    marginDp: marginFor(sizeClass) as 16 | 24,
  };
}

export const M3_PLATFORM_CONTRACT = Object.freeze({
  breakpoints: BREAKPOINTS,
  compactTouchTargetDp: 48,
  baseGridDp: 4,
  mediumMarginDp: 24,
  compactMarginDp: 16,
  platformAdapters: ["tauri-cef", "windows-11", "gnome-libadwaita", "cosmic"],
});
