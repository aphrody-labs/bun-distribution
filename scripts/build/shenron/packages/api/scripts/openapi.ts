#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
//
// openapi.ts — writes openapi/public.json from createShenronApi(fake ports).
//
//   bun packages/api/scripts/openapi.ts           # (re)generate
//   bun packages/api/scripts/openapi.ts --check   # exit 1 when the committed file drifts
//
// The document does not depend on the enabled groups nor on any data: the
// ports below are inert and never called.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createMemoryRateLimiter, createPublicCache, noopInvalidation } from "../src/http";
import { createShenronApi } from "../src/server";

const PACKAGE_DIR = join(import.meta.dir, "..");
const OUTPUT = join(PACKAGE_DIR, "openapi", "public.json");

export function renderPublicDocument(): string {
	const api = createShenronApi(
		{
			wiki: {
				categories: async () => [],
				list: async () => ({ items: [], total: 0 }),
				get: async () => null,
			},
			rateLimit: createMemoryRateLimiter(),
			publicCache: createPublicCache(),
			invalidation: noopInvalidation,
			cors: { allowedOrigins: [] },
			clientIp: () => "unknown",
			isDirectLoopback: () => false,
		},
		{ service: "shenron-bot" }
	);
	return `${JSON.stringify(api.openApiDocument(), null, "\t")}\n`;
}

if (import.meta.main) {
	const check = process.argv.includes("--check");
	const rendered = renderPublicDocument();
	const label = relative(process.cwd(), OUTPUT) || OUTPUT;
	if (check) {
		let current: string | null = null;
		try {
			current = readFileSync(OUTPUT, "utf8").replace(/\r\n/g, "\n");
		} catch {
			current = null;
		}
		if (current !== rendered) {
			console.error(
				`${label} is out of date: run \`bun packages/api/scripts/openapi.ts\` and commit the result.`
			);
			process.exit(1);
		}
		console.log(`${label} is up to date.`);
	} else {
		mkdirSync(dirname(OUTPUT), { recursive: true });
		writeFileSync(OUTPUT, rendered);
		console.log(`wrote ${label}`);
	}
}
