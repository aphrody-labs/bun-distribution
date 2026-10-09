// SPDX-License-Identifier: Apache-2.0
// The client router: holds the RSC payload of the current URL, fetches the next one on navigation
// (`RSC: 1` requests) and renders it inside a transition so the previous page stays interactive.
// Rendered by the SSR layer (without `load`) and hydrated by the browser runtime.
import { startTransition, use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RedirectBoundary } from "../boundaries";
import { LocationContext, RouterContext, type AppRouterInstance, type RouterLocation } from "./router-context";
import type { RscPayload } from "./shared";

type Thenable<T> = PromiseLike<T>;
type PayloadRef = RscPayload | Thenable<RscPayload>;

export interface RouterProps {
  initial: RscPayload;
  /** Fetch the payload of a same-origin URL (browser only). */
  load?: (href: string) => Thenable<RscPayload>;
}

interface RouterState {
  payload: PayloadRef;
  scroll: boolean;
  hash: string;
}

let apply: ((payload: PayloadRef) => void) | undefined;
let navigateRef: ((href: string, replace: boolean) => void) | undefined;

/** Show a payload produced outside a navigation (server action result). */
export function applyPayload(payload: PayloadRef): void {
  apply?.(payload);
}

/** Navigate from outside React (action redirects). */
export function navigate(href: string, replace = false): void {
  if (navigateRef) navigateRef(href, replace);
  else location.assign(href);
}

const isThenable = (value: PayloadRef): value is Thenable<RscPayload> =>
  typeof (value as Thenable<RscPayload>).then === "function";

const PREFETCH_LIMIT = 32;

export function Router({ initial, load }: RouterProps): ReactNode {
  const [state, setState] = useState<RouterState>({ payload: initial, scroll: false, hash: "" });
  const prefetched = useRef(new Map<string, Thenable<RscPayload>>());
  const payload = isThenable(state.payload) ? use(state.payload as Promise<RscPayload>) : state.payload;

  const router = useMemo<AppRouterInstance>(() => {
    const go = (href: string, mode: "push" | "replace" | "none", scroll: boolean) => {
      const url = new URL(href, location.href);
      if (url.origin !== location.origin || !load) {
        location.assign(url);
        return;
      }
      const key = url.pathname + url.search;
      if (mode !== "none" && key === location.pathname + location.search && url.hash) {
        history[mode === "replace" ? "replaceState" : "pushState"](history.state, "", url);
        document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView();
        return;
      }
      const next = prefetched.current.get(key) ?? load(key);
      prefetched.current.delete(key);
      if (mode !== "none") history[mode === "replace" ? "replaceState" : "pushState"](null, "", url);
      startTransition(() => setState({ payload: next, scroll, hash: url.hash }));
    };
    return {
      push: (href, options) => go(href, "push", options?.scroll ?? true),
      replace: (href, options) => go(href, "replace", options?.scroll ?? true),
      refresh: () => {
        if (!load) return;
        const next = load(location.pathname + location.search);
        startTransition(() => setState({ payload: next, scroll: false, hash: "" }));
      },
      back: () => history.back(),
      forward: () => history.forward(),
      prefetch: href => {
        if (!load) return;
        const url = new URL(href, location.href);
        if (url.origin !== location.origin) return;
        const key = url.pathname + url.search;
        if (prefetched.current.has(key)) return;
        if (prefetched.current.size >= PREFETCH_LIMIT) prefetched.current.clear();
        prefetched.current.set(key, load(key));
      },
    };
  }, [load]);

  useEffect(() => {
    apply = next => startTransition(() => setState({ payload: next, scroll: false, hash: "" }));
    navigateRef = (href, replace) => router[replace ? "replace" : "push"](href);
    const onPop = () => {
      if (!load) return;
      const next = load(location.pathname + location.search);
      startTransition(() => setState({ payload: next, scroll: false, hash: "" }));
    };
    addEventListener("popstate", onPop);
    return () => {
      removeEventListener("popstate", onPop);
      apply = undefined;
      navigateRef = undefined;
    };
  }, [router, load]);

  useEffect(() => {
    if (payload.redirect) {
      router.replace(payload.redirect);
      return;
    }
    if (payload.buildId !== initial.buildId) {
      // A new deployment: the client chunks of this page are gone.
      location.reload();
      return;
    }
    if (!state.scroll) return;
    const target = state.hash && document.getElementById(decodeURIComponent(state.hash.slice(1)));
    if (target) target.scrollIntoView();
    else scrollTo(0, 0);
  }, [payload, state, router, initial.buildId]);

  const location_ = useMemo<RouterLocation>(
    () => ({ pathname: payload.pathname, search: payload.search, params: payload.params }),
    [payload],
  );

  return (
    <RouterContext value={router}>
      <LocationContext value={location_}>
        <RedirectBoundary>{payload.root as ReactNode}</RedirectBoundary>
      </LocationContext>
    </RouterContext>
  );
}
