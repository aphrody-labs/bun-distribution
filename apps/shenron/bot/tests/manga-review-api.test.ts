import "./setup";
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createMangaReviewApi, type StaffDecision } from "../src/api/shenron-api";
import { mangaCandidate } from "./manga-candidate-fixture";

const STAFF_TOKEN = "Bearer staff";

function harness() {
	const db = new Database(":memory:");
	const api = createMangaReviewApi({
		sqlite: () => db,
		now: () => 42,
		async authorizeStaff(req): Promise<StaffDecision> {
			const auth = req.headers.get("authorization");
			if (auth === STAFF_TOKEN) return { ok: true, reviewer: "discord:staff" };
			return {
				ok: false,
				response: Response.json({ error: "Authorization requise." }, { status: auth ? 403 : 401 }),
			};
		},
	});
	const call = (method: string, path: string, body?: unknown, staff = true) =>
		api.fetch(
			new Request(`http://bot.test${path}`, {
				method,
				headers: {
					...(staff ? { authorization: STAFF_TOKEN } : {}),
					"content-type": "application/json",
				},
				...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			})
		);
	return { api, call };
}

describe("API revue manga", () => {
	it("route uniquement ses chemins", () => {
		const { api } = harness();
		expect(api.handles("/api/manga/candidates")).toBe(true);
		expect(api.handles("/api/manga/candidates/3/approve")).toBe(true);
		expect(api.handles("/api/manga/planche/DB:vol1:12/traduction")).toBe(true);
		expect(api.handles("/api/manga/status")).toBe(false);
		expect(api.handles("/api/manga/candidates/3/delete")).toBe(false);
	});

	it("réserve les candidats au staff", async () => {
		const { call } = harness();
		expect((await call("GET", "/api/manga/candidates", undefined, false)).status).toBe(401);
		expect((await call("POST", "/api/manga/candidates", mangaCandidate(), false)).status).toBe(401);
		expect((await call("POST", "/api/manga/candidates/1/approve", undefined, false)).status).toBe(401);
	});

	it("dépôt → file → approbation → traduction publique", async () => {
		const { call } = harness();
		const created = await call("POST", "/api/manga/candidates", mangaCandidate());
		expect(created.status).toBe(201);
		const { data } = (await created.json()) as { data: { id: number; status: string } };
		expect(data.status).toBe("unreviewed");
		expect((await call("POST", "/api/manga/candidates", mangaCandidate())).status).toBe(200);
		expect((await call("POST", "/api/manga/candidates", { schema: "x" })).status).toBe(422);
		expect((await call("GET", "/api/manga/candidates?status=bogus")).status).toBe(400);

		const queue = (await (await call("GET", "/api/manga/candidates?status=unreviewed")).json()) as {
			data: unknown[];
		};
		expect(queue.data).toHaveLength(1);

		const before = await call("GET", "/api/manga/planche/DB%3Avol1%3A12/traduction", undefined, false);
		expect(before.status).toBe(404);

		const approved = await call("POST", `/api/manga/candidates/${data.id}/approve`);
		expect(approved.status).toBe(200);
		expect(((await approved.json()) as { data: { status: string; reviewer: string } }).data).toMatchObject({
			status: "published",
			reviewer: "discord:staff",
		});
		expect((await call("POST", `/api/manga/candidates/${data.id}/reject`)).status).toBe(409);
		expect((await call("POST", "/api/manga/candidates/999/approve")).status).toBe(404);

		const pub = await call("GET", "/api/manga/planche/DB:vol1:12/traduction", undefined, false);
		expect(pub.status).toBe(200);
		const body = (await pub.json()) as { data: { pairs: { translatedText: string }[]; publishedAt: number } };
		expect(body.data.pairs.map((p) => p.translatedText)).toEqual(["Goku", "Kamé Hamé Ha !"]);
		expect(body.data.publishedAt).toBe(42);
		expect((await call("GET", "/api/manga/planche/nope/traduction", undefined, false)).status).toBe(400);
	});

	it("rejet d'un candidat", async () => {
		const { call } = harness();
		const created = await call("POST", "/api/manga/candidates", mangaCandidate({ pageId: "DBS:vol2:3" }));
		const { data } = (await created.json()) as { data: { id: number } };
		const r = await call("POST", `/api/manga/candidates/${data.id}/reject`);
		expect(r.status).toBe(200);
		expect((await call("POST", `/api/manga/candidates/${data.id}/approve`)).status).toBe(409);
	});
});
