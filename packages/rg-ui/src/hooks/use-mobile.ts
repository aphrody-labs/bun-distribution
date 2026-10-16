import * as React from "react";

// Classes de fenêtre Material 3 (pixels CSS / dp web).
// Chaque valeur est la borne INCLUSIVE de la classe qu'elle nomme.
export const BREAKPOINTS = {
  MEDIUM: 600,
  EXPANDED: 840,
  LARGE: 1200,
  EXTRA_LARGE: 1600,
} as const;

export type Breakpoint =
  "compact" | "medium" | "expanded" | "large" | "extra-large";

/** Résout une largeur disponible, indépendamment du navigateur ou du device. */
export function breakpointForWidth(width: number): Breakpoint {
  if (width < BREAKPOINTS.MEDIUM) return "compact";
  if (width < BREAKPOINTS.EXPANDED) return "medium";
  if (width < BREAKPOINTS.LARGE) return "expanded";
  if (width < BREAKPOINTS.EXTRA_LARGE) return "large";
  return "extra-large";
}

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
