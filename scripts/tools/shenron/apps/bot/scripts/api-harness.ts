#!/usr/bin/env bun
/**
 * api-harness.ts — `Bun.serve` local (boucle locale, port aléatoire) qui reproduit
 * l'ordre de résolution du bot pour l'API publique : table `routes` historique
 * d'abord, puis le repli `fetch` (`/graphql` limité S9, `@shenron/api` B14,
 * 404 JSON historique). Sert aux essais `curl` et au test de montage.
 *
 *   bun apps/bot/scripts/api-harness.ts            # port wiki de démonstration (en mémoire)
 *   bun apps/bot/scripts/api-harness.ts --pg       # port wiki PostgreSQL via PgService (env du process)
 *   bun apps/bot/scripts/api-harness.ts --no-wiki  # groupe wiki désactivé (comme sans PostgreSQL)
 *
 * Les routes historiques de ce banc répondent `{ legacy: "<route>" }` : elles
 * n'ont pas les services du bot (SQLite, Discord) et ne servent qu'à prouver
 * qu'elles gardent la priorité sur Hono.
 */
import type { WikiReadPort } from "@shenron/api/server";
import {
	createBotShenronApi,
	createPublicFallback,
	createRemoteAddressRegistry,
	type PgSource,
	type PublicRateBuckets,
} from "../src/api/shenron-api";

/** Routes publiques historiques du wiki qui priment sur `/api/public/wiki/{category}`. */
export const LEGACY_WIKI_ROUTES = [
	"/api/public/wiki/characters",
	"/api/public/wiki/characters/:id",
	"/api/public/wiki/arcs/:slug",
	"/api/public/wiki/episodes",
	"/api/public/wiki/episodes/:id",
	"/api/public/wiki/sagas",
	"/api/public/wiki/sagas/:slug",
	"/api/public/wiki/races",
	"/api/public/wiki/races/:slug",
	"/api/public/wiki/techniques",
	"/api/public/wiki/techniques/:slug",
	"/api/public/wiki/transformations",
	"/api/public/wiki/planets",
	"/api/public/wiki/planets/:id",
	"/api/public/wiki/movies",
	"/api/public/wiki/movies/:slug",
	"/api/public/wiki/games",
	"/api/public/wiki/games/:slug",
	"/api/public/wiki/tools",
	"/api/public/wiki/tools/:slug",
	"/api/public/wiki/search",
	"/api/public/wiki/news",
] as const;

export interface HarnessOptions {
	wiki?: WikiReadPort | null;
	pg?: PgSource | null;
	graphql?: (request: Request) => Response | Promise<Response>;
	buckets?: PublicRateBuckets;
	port?: number;
}

/** Port wiki en mémoire pour les essais manuels sans PostgreSQL. */
export const demoWikiPort: WikiReadPort = {
	async categories() {
		return [{ name: "battles", label: "Combats", total: 1 }];
	},
	async list({ category }) {
		return category === "battles"
			? { items: [{ id: 12, slug: "goku-vs-freezer", name: "Goku vs Freezer" }], total: 1 }
			: { items: [], total: 0 };
	},
	async get({ category, idOrSlug }) {
		return category === "battles" && (idOrSlug === "12" || idOrSlug === "goku-vs-freezer")
			? { id: 12, slug: "goku-vs-freezer", name: "Goku vs Freezer" }
			: null;
	},
};

export function startHarness(o: HarnessOptions = {}) {
	const buckets: PublicRateBuckets = o.buckets ?? new Map();
	const remoteAddresses = createRemoteAddressRegistry();
	const fallback = createPublicFallback({
		api: createBotShenronApi({
			...(o.wiki !== undefined ? { wiki: o.wiki } : {}),
			pg: o.pg ?? null,
			buckets,
			remoteAddress: (request) => remoteAddresses.lookup(request),
		}),
		buckets,
		graphql: o.graphql ?? (() => Response.json({ data: { __typename: "Query" } })),
	});
	const routes: Record<string, (req: Request) => Response> = {};
	for (const route of LEGACY_WIKI_ROUTES) routes[route] = () => Response.json({ legacy: route });

	return Bun.serve({
		hostname: "127.0.0.1",
		port: o.port ?? 0,
		development: false,
		routes,
		async fetch(req, server) {
			const url = new URL(req.url);
			if (url.pathname === "/graphql" || url.pathname.startsWith("/graphql/")) {
				return fallback.graphql(req, server);
			}
			if (fallback.handles(url.pathname)) {
				remoteAddresses.remember(req, server);
				return fallback.fetch(req);
			}
			return Response.json({ error: "Not found" }, { status: 404 });
		},
	});
}

if (import.meta.main) {
	const args = new Set(process.argv.slice(2));
	let options: HarnessOptions = { wiki: demoWikiPort };
	if (args.has("--no-wiki")) options = { wiki: null };
	else if (args.has("--pg")) {
		const { PgService } = await import("../src/db/pg");
		options = { pg: PgService.withEnv(process.env) };
	}
	const server = startHarness(options);
	console.log(`api-harness sur ${server.url.href} (Ctrl+C pour arrêter)`);
	console.log(`  curl ${server.url.href}api/public/wiki/categories`);
}
