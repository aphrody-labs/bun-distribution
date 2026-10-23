// SPDX-License-Identifier: Apache-2.0
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { AdaptiveState } from "../adaptive/window.ts";
import type { Destination } from "../nav.ts";
export interface PageProps {
  adaptive: AdaptiveState;
  /** Public catalogs do not expose the standalone Bun host's process API. */
  host?: "native" | "bun";
  /** Pages this host can run (material/nav.ts `hostDestinations`); every page by default. */
  destinations?: readonly Destination[];
}
type PageComponent = LazyExoticComponent<ComponentType<PageProps>>;
export const PAGES = {
  overview: lazy(() => import("./Overview.tsx")),
  theme: lazy(() => import("./Theme.tsx")),
  components: lazy(() => import("./Components.tsx")),
  primitives: lazy(() => import("./Primitives.tsx")),
  forms: lazy(() => import("./Forms.tsx")),
  explorer: lazy(() => import("./Explorer.tsx")),
  motion: lazy(() => import("./Motion.tsx")),
  icons: lazy(() => import("./Icons.tsx")),
  ai: lazy(() => import("./Ai.tsx")),
  reader: lazy(() => import("./Reader.tsx")),
  design: lazy(() => import("./Design.tsx")),
  next: lazy(() => import("./Next.tsx")),
  system: lazy(() => import("./System.tsx")),
  brands: lazy(() => import("./Brands.tsx")),
  adaptive: lazy(() => import("./Adaptive.tsx")),
} satisfies Record<string, PageComponent>;
export type PageId = keyof typeof PAGES;
