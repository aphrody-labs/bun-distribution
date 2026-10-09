// SPDX-License-Identifier: Apache-2.0
// `next/navigation` for client components (the rsc layer resolves `navigation.server.ts`).
import { useContext, useMemo } from "react";
import { LocationContext, RouterContext, type AppRouterInstance, type Params } from "./runtime/router-context";

export { notFound, permanentRedirect, redirect, type RedirectType } from "./runtime/shared";
export type { AppRouterInstance, NavigateOptions } from "./runtime/router-context";

const missing = (hook: string): never => {
  throw new Error(`@aphrody/m3: ${hook} needs the App Router (render under an app/ route)`);
};

export function useRouter(): AppRouterInstance {
  return useContext(RouterContext) ?? missing("useRouter()");
}

export function usePathname(): string {
  return (useContext(LocationContext) ?? missing("usePathname()")).pathname;
}

export function useSearchParams(): URLSearchParams {
  const search = (useContext(LocationContext) ?? missing("useSearchParams()")).search;
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useParams<T extends Params = Params>(): T {
  return (useContext(LocationContext) ?? missing("useParams()")).params as T;
}
