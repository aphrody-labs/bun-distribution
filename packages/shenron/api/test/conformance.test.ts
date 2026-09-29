// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { fullSchema } from "@shenron/db/full-schema";
import { createWikiReadRepository } from "@shenron/db/repos/wiki";
import { drizzle } from "drizzle-orm/postgres-js";
import { createMemoryRateLimiter, createPublicCache, noopInvalidation } from "../src/http";
import { createShenronApi, type WikiReadPort } from "../src/server";

describe("WikiReadPort conformance", () => {
	test("createWikiReadRepository(drizzle.mock({ schema: fullSchema })) satisfies WikiReadPort", () => {
		const repository = createWikiReadRepository(
			drizzle.mock({ schema: fullSchema })
		) satisfies WikiReadPort;
		const port: WikiReadPort = repository;
		expect(typeof port.categories).toBe("function");
		expect(typeof port.list).toBe("function");
		expect(typeof port.get).toBe("function");
	});

	test("the repository mounts as the wiki port (no query is run)", () => {
		const api = createShenronApi(
			{
				wiki: createWikiReadRepository(drizzle.mock({ schema: fullSchema })),
				rateLimit: createMemoryRateLimiter(),
				publicCache: createPublicCache(),
				invalidation: noopInvalidation,
				cors: { allowedOrigins: [] },
				clientIp: () => "unknown",
				isDirectLoopback: () => true,
			},
			{ service: "shenron-site" }
		);
		expect(api.handles("/api/public/wiki/categories")).toBe(true);
	});
});
