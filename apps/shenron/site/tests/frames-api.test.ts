/**
 * Test exhaustif de la route API /api/frames/search :
 * - OPTIONS : headers CORS
 * - POST : gestion des erreurs (payload vide, JSON malformé, payload > 8Mo, format non supporté, URL invalide)
 * - POST : recherche avec image valide (vector ColorLayout, index local, timecodes, tri prioritaire, preview fallback)
 */
import { describe, expect, test, mock } from "bun:test";

// server-only bypass pour les tests en environnement Bun
mock.module("server-only", () => ({}));

// Mock de la base de données Drizzle pour resolveSiteEpisodes et tests ultérieurs
mock.module("@/lib/db", () => {
	const defaultResults = [
		{
			id: 50,
			series: "DBS",
			numberInSeries: 50,
			title: "Goku contre Black ! Le chemin vers l'avenir scellé",
			image: "./assets/ext/db_episodes/dbs-50.jpg",
		},
		{
			id: 1,
			series: "DB",
			numberInSeries: 1,
			title: "Le secret de la boule de dragon",
			image: "./assets/ext/db_episodes/1.jpg",
		},
	];
	const queryBuilder: any = {
		from: () => queryBuilder,
		leftJoin: () => queryBuilder,
		where: () => queryBuilder,
		limit: () => queryBuilder,
		// oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are PromiseLike.
		then: (resolve: any) => resolve(defaultResults),
		[Symbol.iterator]: function* () {
			yield* defaultResults;
		},
	};
	return {
		db: {
			select: () => queryBuilder,
		},
	};
});

mock.module("@/lib/bxc", () => ({
	bxc: {
		frames: {
			vector: async () => ({
				hash: "mock-hash-12345",
				vector: Array(33).fill(128),
			}),
			search: async () => ({
				origin: "local",
				matches: [
					{
						title: "DBS",
						episode: 50,
						atMs: 125000,
						similarity: 0.95,
						preview: {
							image: "https://bot.dragonballfr.com/assets/ext/db_episodes/dbs-50.jpg",
							video: "/preview/dbs-50.mp4",
						},
						source: "local",
					},
				],
				quota: { used: 1, total: 100 },
			}),
		},
	},
}));

const { OPTIONS, POST } = await import("../src/app/api/frames/search/route");

// JPEG minimal 1x1 pixel valide
const VALID_JPEG_BYTES = new Uint8Array([
	0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00,
	0x60, 0x00, 0x60, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06,
	0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b,
	0x0c, 0x19, 0x12, 0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
	0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31,
	0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff,
	0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00,
	0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
	0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xbf, 0x00, 0xff, 0xd9,
]);

// PNG minimal 1x1 pixel valide
const VALID_PNG_BYTES = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
	0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
	0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00,
	0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
	0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe("API /api/frames/search — OPTIONS", () => {
	test("retourne un statut 204 avec les en-têtes CORS nécessaires", () => {
		const res = OPTIONS();
		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		expect(res.headers.get("access-control-allow-methods")).toContain("POST");
		expect(res.headers.get("access-control-allow-headers")).toContain("Content-Type");
	});
});

describe("API /api/frames/search — Gestion des erreurs POST", () => {
	test("rejette un payload JSON vide {}", async () => {
		const req = new Request("http://localhost/api/frames/search", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		const res = await POST(req);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error).toBe("Veuillez fournir une image valide (fichier ou URL).");
	});

	test("rejette un payload JSON syntaxiquement invalide", async () => {
		const req = new Request("http://localhost/api/frames/search", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{ malformed json",
		});
		const res = await POST(req);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error).toBe("Payload JSON invalide.");
	});

	test("rejette une chaîne base64 vide", async () => {
		const req = new Request("http://localhost/api/frames/search", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ imageBase64: "" }),
		});
		const res = await POST(req);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error).toBe("Veuillez fournir une image valide (fichier ou URL).");
	});

	test("rejette un fichier base64 dépassant la limite de 8 Mo", async () => {
		// Simule un payload base64 trop lourd (> 8 Mo)
		const oversizeBuffer = new Uint8Array(8 * 1024 * 1024 + 64);
		oversizeBuffer[0] = 0xff;
		oversizeBuffer[1] = 0xd8;
		oversizeBuffer[2] = 0xff;

		const base64 = Buffer.from(oversizeBuffer).toString("base64");
		const req = new Request("http://localhost/api/frames/search", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ imageBase64: `data:image/jpeg;base64,${base64}` }),
		});
		const res = await POST(req);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error).toBe("L'image dépasse la taille maximale autorisée (8 Mo).");
	});

	test("rejette un format d'image non supporté (texte brut, PDF, binaire inconnu)", async () => {
		const textBase64 = Buffer.from("Ce fichier n'est pas une image JPEG ou PNG.").toString("base64");
		const req = new Request("http://localhost/api/frames/search", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ imageBase64: `data:image/png;base64,${textBase64}` }),
		});
		const res = await POST(req);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error).toContain("Format d'image non supporté");
	});

	test("rejette un formulaire multipart vide", async () => {
		const formData = new FormData();
		const req = new Request("http://localhost/api/frames/search", {
			method: "POST",
			body: formData,
		});
		const res = await POST(req);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error).toBe("Veuillez fournir une image valide (fichier ou URL).");
	});

	test("rejette un fichier multipart dépassant la limite de 8 Mo", async () => {
		const oversize = new Uint8Array(8 * 1024 * 1024 + 10);
		oversize[0] = 0xff;
		oversize[1] = 0xd8;
		oversize[2] = 0xff;

		const formData = new FormData();
		formData.append("file", new Blob([oversize], { type: "image/jpeg" }));

		const req = new Request("http://localhost/api/frames/search", {
			method: "POST",
			body: formData,
		});
		const res = await POST(req);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error).toBe("L'image dépasse la taille maximale autorisée (8 Mo).");
	});

	test("rejette un faux fichier JPEG contenant du texte en multipart", async () => {
		const fakeFile = new TextEncoder().encode("Not a real image, fake jpeg extension");
		const formData = new FormData();
		formData.append("file", new Blob([fakeFile], { type: "image/jpeg" }));

		const req = new Request("http://localhost/api/frames/search", {
			method: "POST",
			body: formData,
		});
		const res = await POST(req);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error).toContain("Format d'image non supporté");
	});

	test("signale une erreur propre lors d'un échec de téléchargement d'URL", async () => {
		const req = new Request("http://localhost/api/frames/search", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ url: "http://127.0.0.1:54321/unreachable-image.jpg" }),
		});
		const res = await POST(req);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error).toContain("Impossible de télécharger l'image");
	});
});

describe("API /api/frames/search — Recherche et enrichissement des résultats", () => {
	test("recherche réussie via JSON imageBase64 avec extraction MPEG-7 et index local", async () => {
		const req = new Request("http://localhost/api/frames/search", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				imageBase64: Buffer.from(VALID_JPEG_BYTES).toString("base64"),
			}),
		});
		const res = await POST(req);
		expect(res.status).toBe(200);

		const json = (await res.json()) as {
			success: boolean;
			hash: string | null;
			vector: number[];
			origin: string;
			offUniverseOnly: boolean;
			matches: Array<{
				title: string;
				episode: number | null;
				timecode: string;
				similarity: number;
				isFirm: boolean;
				isPlausible: boolean;
				isDragonBall: boolean;
				siteEpisode: {
					id: number;
					series: string;
					title: string | null;
					href: string;
					image: string | null;
				} | null;
				preview: {
					image: string;
					video: string;
				};
			}>;
			quota: { used: number; total: number };
		};

		expect(json.success).toBe(true);
		expect(json.origin).toBe("local");
		expect(typeof json.hash).toBe("string");
		expect(Array.isArray(json.vector)).toBe(true);
		expect(json.vector.length).toBe(33); // 33 coefficients ColorLayout DCT

		expect(Array.isArray(json.matches)).toBe(true);
		expect(json.matches.length).toBeGreaterThan(0);

		// Le 1er résultat est DBS épisode 50, résolu sur le site
		const topMatch = json.matches[0];
		expect(topMatch.title).toBe("DBS");
		expect(topMatch.episode).toBe(50);
		expect(topMatch.timecode).toMatch(/^\d+:\d{2}$/);
		expect(topMatch.isDragonBall).toBe(true);
		expect(topMatch.isFirm).toBe(true);

		// Vérifie le rattachement et la normalisation de la vignette site
		expect(topMatch.siteEpisode).not.toBeNull();
		expect(topMatch.siteEpisode?.id).toBe(50);
		expect(topMatch.siteEpisode?.series).toBe("DBS");
		expect(topMatch.siteEpisode?.href).toMatch(new RegExp(`^/wiki/episodes/50\\?t=\\d+$`));
		expect(topMatch.siteEpisode?.image).toContain("https://bot.dragonballfr.com/assets/ext/db_episodes/dbs-50.jpg");

		// Vérifie le fallback du preview.image vers siteEpisode.image
		expect(topMatch.preview.image).toBeTruthy();
	});

	test("recherche réussie via multipart/form-data avec fichier PNG", async () => {
		const formData = new FormData();
		formData.append("file", new Blob([VALID_PNG_BYTES], { type: "image/png" }), "capture.png");

		const req = new Request("http://localhost/api/frames/search", {
			method: "POST",
			body: formData,
		});
		const res = await POST(req);
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json.success).toBe(true);
		expect(json.origin).toBe("local");
		expect(json.matches.length).toBeGreaterThan(0);
	});
});
