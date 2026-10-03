// SPDX-License-Identifier: Apache-2.0
/** Observe real HTTP calls without storing credentials or replacing responses. */
export interface LiveRagRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  authenticated: boolean;
  body: unknown;
}

export function recordLiveRagRequests() {
  const transport = globalThis.fetch;
  const calls: LiveRagRequest[] = [];
  const fetcher = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      calls.push({
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        authenticated:
          request.headers.get("authorization") === `Bearer ${process.env.APHRODY_AI_HTTP_TOKEN}`,
        body: request.body === null ? null : await request.clone().json(),
      });
      return transport(request);
    },
    { preconnect: transport.preconnect.bind(transport) },
  );
  return { calls, fetcher };
}
