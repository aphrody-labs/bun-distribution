import type { RequestInit } from 'undici';
import type { ResponseLike } from '../shared.js';

export async function globalFetch(url: string, init: RequestInit): Promise<ResponseLike> {
	// The transport accepts Undici options; the global Fetch API has a separate RequestInit declaration.
	const response = await fetch(url, init as globalThis.RequestInit);
	return adaptResponse(response);
}

function adaptResponse(response: globalThis.Response): ResponseLike {
	return {
		arrayBuffer: () => response.arrayBuffer(),
		get body() {
			return response.body as unknown as ResponseLike['body'];
		},
		get bodyUsed() {
			return response.bodyUsed;
		},
		clone: () => adaptResponse(response.clone()),
		headers: response.headers,
		json: () => response.json(),
		ok: response.ok,
		status: response.status,
		statusText: response.statusText,
		text: () => response.text(),
	};
}
