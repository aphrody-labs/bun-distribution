import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildOpenApiDocument, AGENT_API_VERSION } from "../src/lib/agent-openapi";
import { AGENT_SCOPES } from "../src/db/schema";
// `agent-scopes` est client-safe : `agent-keys` est `server-only` et ne peut pas
// être importé ici (convention des tests du dépôt).
import { parseScopes, SCOPE_DESCRIPTIONS } from "../src/lib/agent-scopes";

const APP_DIR = join(import.meta.dir, "..", "src", "app");

describe("API agents — contrat", () => {
	const doc = buildOpenApiDocument("https://dragonballfr.com") as {
		paths: Record<string, Record<string, unknown>>;
		servers: Array<{ url: string }>;
		"x-scopes": Record<string, string>;
	};

	/**
	 * Une documentation qui promet une route absente est pire qu'une absence de
	 * documentation : l'agent échoue en 404 sans comprendre pourquoi. On vérifie
	 * donc que chaque chemin déclaré existe bien comme `route.ts`.
	 */
	test("chaque chemin déclaré correspond à une route réelle", () => {
		const base = join(APP_DIR, "api", "agent", "v1");
		for (const path of Object.keys(doc.paths)) {
			const segments = path.replace(/^\//, "").split("/");
			const file = join(base, ...segments, "route.ts");
			if (!existsSync(file)) {
				throw new Error(`OpenAPI déclare ${path} mais ${file} n'existe pas`);
			}
		}
	});

	test("le schéma OpenAPI est servi par une route dédiée et versionné", () => {
		expect(existsSync(join(APP_DIR, "api", "agent", "v1", "openapi.json", "route.ts"))).toBe(true);
		expect(doc.servers[0]?.url).toBe("https://dragonballfr.com/api/agent/v1");
		// Une version absente ou non sémantique casse les générateurs de clients.
		expect(AGENT_API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
	});

	test("le serveur suit l'origine demandée (préproduction incluse)", () => {
		const local = buildOpenApiDocument("http://localhost:3000") as { servers: Array<{ url: string }> };
		// Un schéma servi en préproduction qui pointerait la production ferait écrire
		// le client généré dans la vraie base.
		expect(local.servers[0]?.url).toBe("http://localhost:3000/api/agent/v1");
	});

	/** Chaque portée doit être expliquée : une liste opaque pousse à tout cocher. */
	test("toutes les portées sont décrites", () => {
		for (const scope of AGENT_SCOPES) {
			expect(SCOPE_DESCRIPTIONS[scope]?.length ?? 0).toBeGreaterThan(10);
			expect(doc["x-scopes"][scope]).toBe(SCOPE_DESCRIPTIONS[scope]);
		}
	});

	test("les portées inconnues sont rejetées à l'entrée", () => {
		// Une portée inventée qui entrerait en base passerait ensuite tous les
		// contrôles `includes()` sans que personne ne l'ait relue.
		expect(parseScopes(["read", "root", "", null, 42])).toEqual(["read"]);
		expect(parseScopes("read" as unknown)).toEqual([]);
		// Dédoublonnage : une clé ne porte pas deux fois la même portée.
		expect(parseScopes(["read", "read", "comment"])).toEqual(["read", "comment"]);
	});

	/**
	 * Garde-fou de sécurité : publier est une portée DISTINCTE de rédiger. Si
	 * `write:articles` suffisait à mettre en ligne, une clé d'ingest compromise
	 * publierait directement sur le site.
	 */
	test("rédiger et publier sont deux portées distinctes", () => {
		expect(AGENT_SCOPES).toContain("write:articles");
		expect(AGENT_SCOPES).toContain("publish:articles");
		const post = doc.paths["/articles"]?.post as { description?: string } | undefined;
		expect(post?.description ?? "").toContain("publish:articles");
	});

	test("la proposition wiki annonce qu'elle n'écrit rien", () => {
		const post = doc.paths["/wiki/contributions"]?.post as { description?: string } | undefined;
		expect(post?.description ?? "").toContain("file de modération");
	});

	test("le contrat de contribution est découvrable avant toute écriture", () => {
		const get = doc.paths["/wiki/contribution-schema"]?.get as
			| { description?: string; summary?: string }
			| undefined;
		expect(get?.summary ?? "").toContain("contributives");
		expect(get?.description ?? "").toContain("modération");
	});

	test("le catalogue résout les rowId sans exposer le SQL", () => {
		const get = doc.paths["/wiki/entities"]?.get as { description?: string } | undefined;
		expect(get?.description ?? "").toContain("rowId");
		expect(get?.description ?? "").toContain("fiches masquées");
	});
});
