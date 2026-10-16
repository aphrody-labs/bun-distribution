import { tempPath } from "@aphrody/paths";
import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
	detectImageMime,
	encodeObjectPath,
	listAllObjects,
	parseCommandOptions,
	readAndValidateManifest,
	resolveStorageMigrationConfig,
	runBounded,
	runStorageMigration,
	sanitizedPlan,
	validateObjectMagic,
	validateObjectName,
	verifyBucketContract,
	type StorageMigrationConfig,
} from "./migrate-storage-objects";

const projectRef = "yftdclwvehxxffwqvhmc";
const sourceKey = `source-${"a".repeat(32)}`;
const targetKey = `target-${"b".repeat(32)}`;
const temporaryDirectories: string[] = [];

function environment(overrides: Record<string, string> = {}) {
	return {
		ACHILLEA_STORAGE_SOURCE_URL: `https://${projectRef}.supabase.co`,
		ACHILLEA_STORAGE_SOURCE_KEY: sourceKey,
		ACHILLEA_STORAGE_TARGET_KEY: targetKey,
		...overrides,
	};
}

async function temporaryConfig(): Promise<StorageMigrationConfig> {
	const directory = await mkdtemp(tempPath("achillea-storage-migration-test-"));
	temporaryDirectories.push(directory);
	return resolveStorageMigrationConfig(
		environment({ ACHILLEA_STORAGE_MIGRATION_DIR: path.join(directory, "state") })
	);
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

describe("configuration de migration Storage Achillea", () => {
	test("separe strictement la source Cloud et la cible locale", () => {
		const config = resolveStorageMigrationConfig(environment());
		expect(config.sourceOrigin).toBe(`https://${projectRef}.supabase.co`);
		expect(config.targetOrigin).toBe("http://127.0.0.1:8823");
		expect(config.targetRoot).toBe("/var/www/achillea-storage");
		expect(config.concurrency).toBe(4);
	});

	test("refuse source locale, IP, privee, RG et Azalee", () => {
		for (const source of [
			"https://localhost",
			"https://127.0.0.1",
			"https://10.0.0.2",
			"https://rg.supabase.co",
			"https://azalee.supabase.co",
		]) {
			expect(() =>
				resolveStorageMigrationConfig(environment({ ACHILLEA_STORAGE_SOURCE_URL: source }))
			).toThrow();
		}
	});

	test("refuse un autre projet Supabase et une source non TLS", () => {
		expect(() =>
			resolveStorageMigrationConfig(
				environment({ ACHILLEA_STORAGE_SOURCE_URL: "https://otherprojectref12345.supabase.co" })
			)
		).toThrow("projet Supabase Achillea attendu");
		expect(() =>
			resolveStorageMigrationConfig(
				environment({ ACHILLEA_STORAGE_SOURCE_URL: `http://${projectRef}.supabase.co` })
			)
		).toThrow("HTTPS");
	});

	test("refuse credentials dans URL et chemins sur l'origine", () => {
		expect(() =>
			resolveStorageMigrationConfig(
				environment({ ACHILLEA_STORAGE_SOURCE_URL: `https://user:pass@${projectRef}.supabase.co` })
			)
		).toThrow("ni identifiant");
		expect(() =>
			resolveStorageMigrationConfig(
				environment({ ACHILLEA_STORAGE_SOURCE_URL: `https://${projectRef}.supabase.co/storage/v1` })
			)
		).toThrow("sans chemin");
	});

	test("refuse toute autre cible ou racine locale", () => {
		expect(() =>
			resolveStorageMigrationConfig(
				environment({ ACHILLEA_STORAGE_TARGET_URL: "http://127.0.0.1:8811" })
			)
		).toThrow("8823");
		expect(() =>
			resolveStorageMigrationConfig(
				environment({ ACHILLEA_STORAGE_TARGET_ROOT: "/var/www/rg-storage" })
			)
		).toThrow("achillea-storage");
	});

	test("refuse les dossiers d'etat dans le repo ou une racine partagee", () => {
		for (const directory of [
			"/home/ubuntu/rg/tmp",
			"/var/www/rg-storage",
			"/var/www/rg-storage/migration",
			"/srv/azalee/state",
			"/home/ubuntu",
		]) {
			expect(() =>
				resolveStorageMigrationConfig(environment({ ACHILLEA_STORAGE_MIGRATION_DIR: directory }))
			).toThrow("hors repo");
		}
	});

	test("exige deux credentials nommes et distincts sans les exposer", () => {
		expect(() =>
			resolveStorageMigrationConfig(environment({ ACHILLEA_STORAGE_TARGET_KEY: sourceKey }))
		).toThrow("distincts");
		expect(() =>
			resolveStorageMigrationConfig(environment({ ACHILLEA_STORAGE_SOURCE_KEY: "" }))
		).toThrow("deux credentials");
		const plan = sanitizedPlan(
			resolveStorageMigrationConfig(environment()),
			parseCommandOptions([])
		);
		expect(JSON.stringify(plan)).not.toContain(sourceKey);
		expect(JSON.stringify(plan)).not.toContain(targetKey);
		expect(JSON.stringify(plan)).not.toContain("https://");
		expect(JSON.stringify(plan)).not.toContain("http://");
	});

	test("borne la concurrence entre un et huit", () => {
		expect(() =>
			resolveStorageMigrationConfig(environment({ ACHILLEA_STORAGE_MIGRATION_CONCURRENCY: "0" }))
		).toThrow("entre 1 et 8");
		expect(() =>
			resolveStorageMigrationConfig(environment({ ACHILLEA_STORAGE_MIGRATION_CONCURRENCY: "9" }))
		).toThrow("entre 1 et 8");
	});
});

describe("contrat des buckets", () => {
	test("accepte ranked-proofs absent sur une source Cloud historique", async () => {
		const available = await verifyBucketContract(
			`https://${projectRef}.supabase.co`,
			sourceKey,
			"source-cloud",
			async (input) => {
				const name = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1)!);
				if (name === "ranked-proofs") return new Response(null, { status: 400 });
				return Response.json({ id: "images", public: true });
			},
			true
		);
		expect([...available]).toEqual(["images"]);
	});
});

describe("garde-fous CLI et noms d'objets", () => {
	test("reste en dry-run par defaut", () => {
		expect(parseCommandOptions([])).toEqual({
			phase: "plan",
			execute: false,
			confirmation: undefined,
		});
		expect(parseCommandOptions(["--migrate"])).toMatchObject({ phase: "migrate", execute: false });
	});

	test("exige le double opt-in exact pour executer", () => {
		expect(() => parseCommandOptions(["--migrate", "--execute"])).toThrow("--confirm");
		expect(() => parseCommandOptions(["--migrate", "--execute", "--confirm", "WRONG"])).toThrow(
			"--confirm"
		);
		expect(
			parseCommandOptions(["--migrate", "--execute", "--confirm", "ACHILLEA_STORAGE_MIGRATION"])
		).toMatchObject({ phase: "migrate", execute: true });
	});

	test("refuse plusieurs phases", () => {
		expect(() => parseCommandOptions(["--inventory", "--verify"])).toThrow("une seule phase");
	});

	test("encode chaque segment et refuse les traversees", () => {
		expect(encodeObjectPath("images", "proxy/a b#c.png")).toBe("images/proxy/a%20b%23c.png");
		for (const name of [
			"",
			"/x.png",
			"../x.png",
			"a//b.png",
			"a\\b.png",
			"a/./b.png",
			"x\u0000.png",
		]) {
			expect(() => validateObjectName(name)).toThrow();
		}
	});
});

describe("validation de contenu et orchestration", () => {
	const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
	const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1]);
	const webp = new TextEncoder().encode("RIFFxxxxWEBPdata");
	const gif = new TextEncoder().encode("GIF89adata");
	const svg = new TextEncoder().encode('<?xml version="1.0"?><svg></svg>');

	test("detecte les cinq formats par magic bytes", () => {
		expect(detectImageMime(png)).toBe("image/png");
		expect(detectImageMime(jpeg)).toBe("image/jpeg");
		expect(detectImageMime(webp)).toBe("image/webp");
		expect(detectImageMime(gif)).toBe("image/gif");
		expect(detectImageMime(svg)).toBe("image/svg+xml");
		expect(detectImageMime(new TextEncoder().encode("not-image"))).toBeNull();
	});

	test("interdit GIF et contenu inconnu dans les preuves privees", () => {
		expect(validateObjectMagic("images", gif)).toBe("image/gif");
		expect(validateObjectMagic("images", svg)).toBe("image/svg+xml");
		expect(() => validateObjectMagic("ranked-proofs", gif)).toThrow("Magic bytes");
		expect(() => validateObjectMagic("ranked-proofs", svg)).toThrow("Magic bytes");
		expect(() => validateObjectMagic("images", new Uint8Array([1, 2, 3]))).toThrow("Magic bytes");
	});

	test("respecte effectivement la concurrence bornee", async () => {
		let active = 0;
		let maximum = 0;
		const result = await runBounded([1, 2, 3, 4, 5], 2, async (value) => {
			active++;
			maximum = Math.max(maximum, active);
			await Bun.sleep(2);
			active--;
			return value * 2;
		});
		expect(result).toEqual([2, 4, 6, 8, 10]);
		expect(maximum).toBe(2);
	});

	test("inventorie recursivement et pagine sans doublon", async () => {
		let rootCalls = 0;
		const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as { prefix: string; offset: number };
			if (body.prefix === "") {
				rootCalls++;
				if (body.offset === 0) {
					return Response.json([
						...Array.from({ length: 999 }, (_, index) => ({
							id: String(index),
							name: `root-${index}.png`,
							metadata: {},
						})),
						{ id: null, name: "folder", metadata: null },
					]);
				}
				return Response.json([{ id: "last", name: "last.png", metadata: {} }]);
			}
			return Response.json([{ id: "nested", name: "nested.png", metadata: {} }]);
		};
		const objects = await listAllObjects("https://source.invalid", sourceKey, "images", fetcher);
		expect(objects).toHaveLength(1_001);
		expect(objects).toContain("folder/nested.png");
		expect(rootCalls).toBe(2);
	});

	test("expurge les URL des erreurs reseau", async () => {
		const leakedUrl = "https://source.invalid/private/path";
		let message = "";
		try {
			await listAllObjects(leakedUrl, sourceKey, "images", async () => {
				throw new Error(`connexion impossible: ${leakedUrl}`);
			});
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toBe("Inventaire Storage source a echoue avant reponse");
		expect(message).not.toContain(leakedUrl);
	});

	test("le dry-run ne fait aucun appel reseau ni ecriture", async () => {
		const config = await temporaryConfig();
		let calls = 0;
		const result = await runStorageMigration(
			config,
			parseCommandOptions(["--inventory"]),
			async () => {
				calls++;
				throw new Error("interdit");
			}
		);
		expect(calls).toBe(0);
		expect(result).toMatchObject({ mode: "dry-run", phase: "inventory" });
		expect(await Bun.file(config.stateDirectory).exists()).toBe(false);
	});

	test("inventorie, migre avec reprise idempotente puis verifie", async () => {
		const config = await temporaryConfig();
		const sourceObjects = new Map([
			["images/root.png", png],
			["images/proxy/space file.webp", webp],
			["ranked-proofs/proof/match.jpg", jpeg],
		]);
		const targetObjects = new Map<string, Uint8Array>();
		const uploads: string[] = [];
		const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(String(input));
			const isSource = url.origin === config.sourceOrigin;
			const bucketMatch = url.pathname.match(/\/storage\/v1\/bucket\/([^/]+)$/);
			if (bucketMatch) {
				const name = decodeURIComponent(bucketMatch[1]);
				return Response.json({ id: name, public: name === "images" });
			}
			const listMatch = url.pathname.match(/\/storage\/v1\/object\/list\/([^/]+)$/);
			if (listMatch && isSource) {
				const bucket = decodeURIComponent(listMatch[1]);
				const { prefix } = JSON.parse(String(init?.body)) as { prefix: string };
				if (bucket === "images" && prefix === "")
					return Response.json([
						{ id: "root", name: "root.png", metadata: {} },
						{ id: null, name: "proxy", metadata: null },
					]);
				if (bucket === "images" && prefix === "proxy/")
					return Response.json([{ id: "space", name: "space file.webp", metadata: {} }]);
				if (bucket === "ranked-proofs" && prefix === "")
					return Response.json([{ id: null, name: "proof", metadata: null }]);
				if (bucket === "ranked-proofs" && prefix === "proof/")
					return Response.json([{ id: "match", name: "match.jpg", metadata: {} }]);
				return Response.json([]);
			}
			if (listMatch && !isSource) {
				const bucket = decodeURIComponent(listMatch[1]);
				const { prefix, offset, limit } = JSON.parse(String(init?.body)) as {
					prefix: string;
					offset: number;
					limit: number;
				};
				const names = [...targetObjects.keys()]
					.filter((id) => id.startsWith(`${bucket}/`))
					.map((id) => id.slice(bucket.length + 1))
					.filter((name) => name.startsWith(prefix))
					.sort()
					.slice(offset, offset + limit);
				return Response.json(names.map((name) => ({ id: name, name, metadata: {} })));
			}
			const authenticated = "/storage/v1/object/authenticated/";
			if (url.pathname.startsWith(authenticated)) {
				const id = url.pathname
					.slice(authenticated.length)
					.split("/")
					.map(decodeURIComponent)
					.join("/");
				const bytes = (isSource ? sourceObjects : targetObjects).get(id);
				return bytes
					? new Response(
							bytes.buffer.slice(
								bytes.byteOffset,
								bytes.byteOffset + bytes.byteLength
							) as ArrayBuffer
						)
					: new Response(null, { status: 404 });
			}
			const upload = "/storage/v1/object/";
			if (!isSource && init?.method === "POST" && url.pathname.startsWith(upload)) {
				const id = url.pathname.slice(upload.length).split("/").map(decodeURIComponent).join("/");
				const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
				targetObjects.set(id, bytes);
				uploads.push(id);
				return Response.json({ path: id });
			}
			return new Response(null, { status: 500 });
		};

		const execute = ["--execute", "--confirm", "ACHILLEA_STORAGE_MIGRATION"];
		const inventoried = await runStorageMigration(
			config,
			parseCommandOptions(["--inventory", ...execute]),
			fetcher
		);
		expect(inventoried).toMatchObject({ phase: "inventory", objectCount: 3 });
		const manifest = await readAndValidateManifest(config);
		expect(manifest.totalBytes).toBe(png.length + webp.length + jpeg.length);
		expect(manifest.objects.map((object) => object.name)).toEqual([
			"proxy/space file.webp",
			"root.png",
			"proof/match.jpg",
		]);
		const manifestText = await readFile(path.join(config.stateDirectory, "manifest.json"), "utf8");
		expect(manifestText).not.toContain(sourceKey);
		expect(manifestText).not.toContain(targetKey);
		expect((await stat(path.join(config.stateDirectory, "manifest.json"))).mode & 0o777).toBe(
			0o600
		);
		expect((await stat(config.stateDirectory)).mode & 0o777).toBe(0o700);

		const damagedStage = path.join(config.stateDirectory, manifest.objects[0].stagedFile);
		await Bun.write(damagedStage, jpeg);
		await chmod(damagedStage, 0o600);
		await expect(
			runStorageMigration(config, parseCommandOptions(["--migrate", ...execute]), fetcher)
		).rejects.toThrow("different du manifeste");
		expect(uploads).toHaveLength(0);
		await runStorageMigration(config, parseCommandOptions(["--inventory", ...execute]), fetcher);

		targetObjects.set("images/unexpected.png", png);
		await expect(
			runStorageMigration(config, parseCommandOptions(["--migrate", ...execute]), fetcher)
		).rejects.toThrow("hors manifeste");
		targetObjects.delete("images/unexpected.png");

		const first = await runStorageMigration(
			config,
			parseCommandOptions(["--migrate", ...execute]),
			fetcher
		);
		expect(first).toEqual({ phase: "migrate", migrated: 3, skipped: 0 });
		expect(uploads).toHaveLength(3);
		const second = await runStorageMigration(
			config,
			parseCommandOptions(["--migrate", ...execute]),
			fetcher
		);
		expect(second).toEqual({ phase: "migrate", migrated: 0, skipped: 3 });
		expect(uploads).toHaveLength(3);

		const verified = await runStorageMigration(
			config,
			parseCommandOptions(["--verify", ...execute]),
			fetcher
		);
		expect(verified).toMatchObject({ phase: "verify", objectCount: 3, failureCount: 0 });
		expect((await stat(path.join(config.stateDirectory, "verification.json"))).mode & 0o777).toBe(
			0o600
		);
	});
});
