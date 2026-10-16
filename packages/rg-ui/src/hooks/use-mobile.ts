import * as React from "react";

import { BREAKPOINTS as M3_BREAKPOINTS, classifyWidth, type WindowSizeClass } from "@aphrody/m3-tokens/breakpoints";
export const BREAKPOINTS = {
  MEDIUM: M3_BREAKPOINTS.medium,
  EXPANDED: M3_BREAKPOINTS.expanded,
  LARGE: M3_BREAKPOINTS.large,
  EXTRA_LARGE: M3_BREAKPOINTS["extra-large"],
} as const;
export type Breakpoint = WindowSizeClass;
export const breakpointForWidth = classifyWidth;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(false);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${BREAKPOINTS.MEDIUM - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < BREAKPOINTS.MEDIUM);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < BREAKPOINTS.MEDIUM);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = React.useState<Breakpoint>("compact");

  React.useEffect(() => {
    const updateBreakpoint = () => {
      setBreakpoint(breakpointForWidth(window.innerWidth));
    };

    updateBreakpoint();
    window.addEventListener("resize", updateBreakpoint);
    return () => window.removeEventListener("resize", updateBreakpoint);
  }, []);

  return breakpoint;
}
