// SPDX-License-Identifier: Apache-2.0
// `M3App`: the root of a React @aphrody/m3 application. It composes
//   - `M3ThemeProvider` (`@aphrody/m3-theme/react`): light/dark/system over the compiled Rust theme
//     (`m3:theme.css`); seed, contrast and variant changes install Rust `scheme` sheets from `sheet`,
//   - the M3 window size class (`@aphrody/m3-react/adaptive`), exposed through `useM3SizeClass` and
//     mirrored on the root element as `data-window-size-class`,
//   - the motion defaults (`@aphrody/m3-motion` springs, `motion/react` `MotionConfig`), honouring
//     the user's reduced-motion preference.
import { m3Springs } from "@aphrody/m3-motion";
import { useWindowSizeClass, type WindowSizeClass } from "@aphrody/m3-react/adaptive";
import {
  M3ThemeProvider,
  type M3SchemeSheet,
  type SchemeVariant,
  type ThemeMode,
} from "@aphrody/m3-theme/react";
import { MotionConfig } from "motion/react";
import { createContext, type ReactNode, StrictMode, useContext, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

export { useM3Theme } from "@aphrody/m3-theme/react";
export type {
  M3SchemeRequest,
  M3SchemeSheet,
  M3ThemeContextType,
  SchemeVariant,
  ThemeMode,
} from "@aphrody/m3-theme/react";
export type { WindowSizeClass } from "@aphrody/m3-react/adaptive";
export { DataTable, dataColumns, dataTableFeatures, VirtualList } from "@aphrody/m3-react/data";
export type {
  DataColumn,
  DataTableFeatures,
  DataTableProps,
  VirtualListProps,
} from "@aphrody/m3-react/data";

/** Speed of the default spring (`m3Springs` of `@aphrody/m3-motion`). */
export type M3MotionSpeed = keyof typeof m3Springs;

export interface M3AppTheme {
  seed?: string;
  mode?: ThemeMode;
  contrast?: number;
  variant?: SchemeVariant;
}

export interface M3AppProps {
  children: ReactNode;
  /** The theme compiled into the page's CSS (`m3.config.ts` `theme`); `useM3Theme()` changes it at runtime. */
  theme?: M3AppTheme;
  /** Rust `scheme` sheets for runtime theme changes (`m3Css` or an app-server route). */
  sheet?: M3SchemeSheet;
  /** Default spring for `motion` components (default `default`). */
  motion?: M3MotionSpeed;
  /** `user` follows `prefers-reduced-motion` (default), `always` disables motion, `never` ignores it. */
  reducedMotion?: "user" | "always" | "never";
  /** Size class used on the server and the first client render (default `compact`). */
  ssrSizeClass?: WindowSizeClass;
  /** Element receiving the theme properties and `data-window-size-class` (default `<html>`). */
  target?: HTMLElement;
}

const SizeClassContext = createContext<WindowSizeClass | undefined>(undefined);

/** The current M3 window size class, from the nearest `M3App`. */
export function useM3SizeClass(): WindowSizeClass {
  const value = useContext(SizeClassContext);
  if (value === undefined) throw new Error("useM3SizeClass must be used within an M3App");
  return value;
}

const COMPILED_THEME: M3AppTheme = {};

/** Root provider of an @aphrody/m3 React application. */
export function M3App({
  children,
  theme = COMPILED_THEME,
  motion = "default",
  reducedMotion = "user",
  ssrSizeClass = "compact",
  target,
  sheet,
}: M3AppProps) {
  const sizeClass = useWindowSizeClass(ssrSizeClass);
  useEffect(() => {
    if (typeof document === "undefined") return;
    (target ?? document.documentElement).setAttribute("data-window-size-class", sizeClass);
  }, [sizeClass, target]);

  return (
    <M3ThemeProvider
      defaultSeedColor={theme.seed}
      defaultThemeMode={theme.mode}
      defaultContrastLevel={theme.contrast}
      defaultVariant={theme.variant}
      target={target}
      sheet={sheet}
    >
      <MotionConfig transition={m3Springs[motion].spatial} reducedMotion={reducedMotion}>
        <SizeClassContext.Provider value={sizeClass}>{children}</SizeClassContext.Provider>
      </MotionConfig>
    </M3ThemeProvider>
  );
}

/**
 * Mount `app` inside `M3App` (and `StrictMode`) on `container` (an element or a selector).
 * Returns the React root.
 */
export function mountM3App(
  container: Element | string,
  app: ReactNode,
  props: Omit<M3AppProps, "children"> = {},
): Root {
  const element = typeof container === "string" ? document.querySelector(container) : container;
  if (!element) throw new Error(`mountM3App: no element matches ${String(container)}`);
  const root = createRoot(element);
  root.render(
    <StrictMode>
      <M3App {...props}>{app}</M3App>
    </StrictMode>,
  );
  return root;
}
