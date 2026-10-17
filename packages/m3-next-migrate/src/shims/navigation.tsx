// SPDX-License-Identifier: Apache-2.0
"use client";

import { useMemo } from "react";
import { useNextMigrateContext } from "./provider";

export interface AppRouterInstance {
  back(): void;
  forward(): void;
  refresh(): void;
  push(href: string, options?: { scroll?: boolean }): void;
  replace(href: string, options?: { scroll?: boolean }): void;
  prefetch(href: string): void;
}

export function useRouter(): AppRouterInstance {
  const ctx = useNextMigrateContext();

  return useMemo(
    () => ({
      back: () => ctx.back(),
      forward: () => ctx.forward(),
      refresh: () => ctx.refresh(),
      push: (href: string, options?: { scroll?: boolean }) => {
        ctx.navigate(href, { replace: false, scroll: options?.scroll });
      },
      replace: (href: string, options?: { scroll?: boolean }) => {
        ctx.navigate(href, { replace: true, scroll: options?.scroll });
      },
      prefetch: (_href: string) => {
        // No-op in client SPA / Tauri webview
      },
    }),
    [ctx],
  );
}

export function usePathname(): string {
  const ctx = useNextMigrateContext();
  return ctx.pathname;
}

export function useSearchParams(): URLSearchParams {
  const ctx = useNextMigrateContext();
  return ctx.searchParams;
}

export function useParams<T extends Record<string, string | string[]> = Record<string, string>>(): T {
  const ctx = useNextMigrateContext();
  return (ctx.params || {}) as T;
}

export function useSelectedLayoutSegment(): string | null {
  const pathname = usePathname();
  return pathname.split("/").find(Boolean) ?? null;
}

export function useSelectedLayoutSegments(): string[] {
  const pathname = usePathname();
  return pathname.split("/").filter(Boolean);
}

export class NavigationRedirectError extends Error {
  url: string;
  constructor(url: string) {
    super(`NEXT_REDIRECT: ${url}`);
    this.name = "NavigationRedirectError";
    this.url = url;
  }
}

export class NavigationNotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NavigationNotFoundError";
  }
}

export function redirect(url: string): never {
  if (typeof window !== "undefined") {
    if (window.location.hash.startsWith("#/")) {
      window.location.hash = `#${url.startsWith("/") ? url : `/${url}`}`;
    } else {
      window.location.assign(url);
    }
  }
  throw new NavigationRedirectError(url);
}

export function permanentRedirect(url: string): never {
  return redirect(url);
}

export function notFound(): never {
  throw new NavigationNotFoundError();
}
