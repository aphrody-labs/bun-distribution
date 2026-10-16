// SPDX-License-Identifier: Apache-2.0
import {
  classifyHeight,
  classifyWidth,
  navigationFor,
  panesFor,
  type NavigationKind,
  type WindowHeightClass,
  type WindowSizeClass,
} from "@aphrody/m3-tokens/breakpoints";

export interface WindowClassState {
  width: WindowSizeClass;
  height: WindowHeightClass;
  navigation: NavigationKind;
  panes: 1 | 2 | 3;
}

export function windowClassFor(
  widthDp: number,
  heightDp: number,
): WindowClassState {
  const width = classifyWidth(widthDp);
  return {
    width,
    height: classifyHeight(heightDp),
    navigation: navigationFor(width),
    panes: panesFor(width),
  };
}

/**
 * Observe the window size classes and mirror them on `target` as `data-m3-width`, `data-m3-height`,
 * `data-m3-nav`. Calls `onChange` when a class changes. Returns a disposer.
 */
export function observeWindowClass(
  onChange?: (s: WindowClassState) => void,
  target: HTMLElement = document.documentElement,
  win: Window = window,
): () => void {
  let last = "";
  const update = (): void => {
    const s = windowClassFor(win.innerWidth, win.innerHeight);
    target.dataset["m3Width"] = s.width;
    target.dataset["m3Height"] = s.height;
    target.dataset["m3Nav"] = s.navigation;
    const key = `${s.width}/${s.height}`;
    if (key !== last) {
      last = key;
      onChange?.(s);
    }
  };
  update();
  win.addEventListener("resize", update);
  return () => win.removeEventListener("resize", update);
}
