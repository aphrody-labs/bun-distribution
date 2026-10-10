// SPDX-License-Identifier: Apache-2.0
// Contexts of the client router, shared by `Router`, `Link`, the navigation hooks and the boundaries.
import { createContext } from "react";

export type Params = Record<string, string | string[]>;

export interface NavigateOptions {
  /** Scroll to the top (or the hash target) after the navigation (default true). */
  scroll?: boolean;
}

export interface AppRouterInstance {
  push(href: string, options?: NavigateOptions): void;
  replace(href: string, options?: NavigateOptions): void;
  /** Fetch the current route again from the server, keeping client state. */
  refresh(): void;
  back(): void;
  forward(): void;
  prefetch(href: string): void;
}

export interface RouterLocation {
  pathname: string;
  search: string;
  params: Params;
}

export const RouterContext = createContext<AppRouterInstance | null>(null);
export const LocationContext = createContext<RouterLocation | null>(null);
