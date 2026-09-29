// SPDX-License-Identifier: Apache-2.0
/**
 * `@shenron/api/next` — Next.js App Router adapter. No `next/*` import: the
 * cache functions (`revalidatePath`, `revalidateTag`) are injected by the site.
 * Runtime class: `server`.
 */
import type { InvalidationPort } from "./http";

export interface NextRouteHandlers {
	GET(request: Request): Promise<Response>;
	HEAD(request: Request): Promise<Response>;
	OPTIONS(request: Request): Promise<Response>;
}

/** The part of `ShenronApi` (`./server`) the adapter needs; declared structurally so this module never reaches hono. */
export interface FetchableApi {
	fetch(request: Request): Promise<Response>;
}

/** Route handlers for `app/api/public/[...route]/route.ts`. */
export function toNextRouteHandlers(api: FetchableApi): NextRouteHandlers {
	const handle = (request: Request) => api.fetch(request);
	return { GET: handle, HEAD: handle, OPTIONS: handle };
}

export interface NextCacheFunctions {
	revalidatePath(path: string): void;
	revalidateTag(tag: string): void;
}

/** Invalidation port over the injected Next cache functions. */
export function nextInvalidationPort(fns: NextCacheFunctions): InvalidationPort {
	return {
		async paths(paths) {
			for (const path of paths) fns.revalidatePath(path);
		},
		async tags(tags) {
			for (const tag of tags) fns.revalidateTag(tag);
		},
	};
}
