// SPDX-License-Identifier: Apache-2.0
/** Public destinations share the application's router and navigation. */
export const publicDestinations = [
  { route: "/", label: "Aphrody", icon: "home" },
  { route: "/docs", label: "Documentation", icon: "menu_book" },
  { route: "/templates", label: "Templates", icon: "dashboard_customize" },
  { route: "/material-3", label: "Material 3", icon: "palette" },
] as const;

export function isPublicDestination(pathname: string): boolean {
  return (
    pathname === "/" ||
    publicDestinations
      .slice(1)
      .some(
        ({ route }) => pathname === route || pathname.startsWith(`${route}/`),
      ) ||
    pathname === "/showcase" ||
    pathname.startsWith("/showcase/")
  );
}
