// SPDX-License-Identifier: Apache-2.0
// Per-request state of the server runtime (rsc layer), reachable from `cookies()`, `headers()`,
// `redirect()` and the cache helpers through an AsyncLocalStorage shared on `globalThis`.
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestStore {
  request: Request;
  url: URL;
  cookies: Bun.CookieMap;
  /** Headers added to the response (cookies set by actions or route handlers, middleware headers). */
  responseHeaders: Headers;
  /** Status chosen while rendering (404 after `notFound()`). */
  status?: number;
  /** Redirect raised while rendering the shell. */
  redirect?: { url: string; status: number };
  /** Rendering at build time: dynamic APIs make the route dynamic. */
  prerender: boolean;
  /** Set when a dynamic API was used. */
  dynamic: boolean;
  /** Set by `revalidatePath`/`revalidateTag` during an action. */
  revalidated: boolean;
  /** Settles once the page (or the segment that failed) has rendered: status and redirect are known. */
  shell: PromiseWithResolvers<void>;
}

/** Thrown by dynamic APIs while prerendering; the route then renders per request. */
export class DynamicUsageError extends Error {
  readonly digest = "M3_DYNAMIC_USAGE";
  constructor(api: string) {
    super(`${api} is dynamic`);
  }
}

const KEY = Symbol.for("@aphrody/m3/app/store");
type WithStore = typeof globalThis & { [KEY]?: AsyncLocalStorage<RequestStore> };

export const requestStorage: AsyncLocalStorage<RequestStore> = ((globalThis as WithStore)[KEY] ??=
  new AsyncLocalStorage<RequestStore>());

export function createStore(request: Request, prerender = false): RequestStore {
  return {
    request,
    url: new URL(request.url),
    cookies: new Bun.CookieMap(request.headers.get("cookie") ?? ""),
    responseHeaders: new Headers(),
    prerender,
    dynamic: false,
    revalidated: false,
    shell: Promise.withResolvers<void>(),
  };
}

/** The current store; throws outside a request. */
export function getStore(api: string): RequestStore {
  const store = requestStorage.getStore();
  if (!store) throw new Error(`@aphrody/m3: ${api} was called outside a request`);
  return store;
}

/** Mark the current render as dynamic (throws while prerendering). */
export function markDynamic(api: string): RequestStore {
  const store = getStore(api);
  store.dynamic = true;
  if (store.prerender) throw new DynamicUsageError(api);
  return store;
}
