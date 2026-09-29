// SPDX-License-Identifier: Apache-2.0
/**
 * Test helpers shared by every `@shenron/*` package.
 *
 * Runtime class: `pure` (only `Request`, `Response`, `Headers`, `URL`).
 */

export interface RecordedCall {
	method: string;
	url: string;
	headers: Headers;
	body: string | null;
}

export type RecordingRouteHandler = (req: Request) => Response | Promise<Response>;

function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Candidate route keys for a request, most specific first:
 * `"METHOD url"`, `"METHOD origin+path"`, `"METHOD path"`, then the same three
 * without the method, then the catch-all `"*"`. The URL keys ignore the hash.
 */
function routeKeys(request: Request): string[] {
	const url = new URL(request.url);
	url.hash = "";
	const full = url.href;
	const originPath = `${url.origin}${url.pathname}`;
	const path = url.pathname;
	const method = request.method.toUpperCase();
	return [
		`${method} ${full}`,
		`${method} ${originPath}`,
		`${method} ${path}`,
		full,
		originPath,
		path,
		"*",
	];
}

/**
 * Builds a `fetch` replacement that records every call (method, normalised
 * URL, a copy of the headers, the body as text or `null`) and answers from
 * `routes`.
 *
 * Route keys, most specific first: `"POST http://host/api/x?q=1"`,
 * `"POST http://host/api/x"`, `"POST /api/x"`, the same without the method,
 * and `"*"`. A request that matches no route is still recorded, then rejected
 * with a `TypeError` like a network failure. An aborted `signal` rejects with
 * its reason, before or while the handler runs.
 */
export function createRecordingFetch(routes: Record<string, RecordingRouteHandler>): {
	fetch: typeof fetch;
	calls: RecordedCall[];
} {
	const calls: RecordedCall[] = [];

	const recordingFetch = async (
		input: string | URL | Request,
		init?: RequestInit
	): Promise<Response> => {
		const request = new Request(input, init);
		const body = request.body === null ? null : await request.clone().text();
		calls.push({
			method: request.method.toUpperCase(),
			url: request.url,
			headers: new Headers(request.headers),
			body,
		});
		if (request.signal.aborted) throw abortReason(request.signal);

		const key = routeKeys(request).find((candidate) => Object.hasOwn(routes, candidate));
		const handler = key === undefined ? undefined : routes[key];
		if (!handler) {
			throw new TypeError(
				`createRecordingFetch: no route for ${request.method.toUpperCase()} ${request.url}`
			);
		}

		const signal = request.signal;
		let onAbort: (() => void) | undefined;
		const aborted = new Promise<never>((_, reject) => {
			onAbort = () => reject(abortReason(signal));
			signal.addEventListener("abort", onAbort, { once: true });
		});
		try {
			return await Promise.race([Promise.resolve(handler(request)), aborted]);
		} finally {
			if (onAbort) signal.removeEventListener("abort", onAbort);
		}
	};

	const fetchLike = Object.assign(recordingFetch, {
		preconnect(_url: string | URL, _options?: unknown): void {
			/* nothing to warm up: no network is involved */
		},
	});
	return { fetch: fetchLike as unknown as typeof fetch, calls };
}
