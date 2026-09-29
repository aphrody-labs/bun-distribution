import { Buffer } from "node:buffer";

import { describe, expect, test } from "bun:test";

import { RankedProofStorage, type RankedStorageClientLike } from "../../src/ranked/storage";

function rankedStorageMock() {
	const uploads: string[] = [];
	const signed: Array<{ path: string; ttl: number }> = [];
	const client: RankedStorageClientLike = {
		storage: {
			from(bucket) {
				expect(bucket).toBe("ranked-proofs");
				return {
					async upload(path) {
						uploads.push(path);
						return { error: null };
					},
					async createSignedUrl(path, ttl) {
						signed.push({ path, ttl });
						return {
							data: { signedUrl: `https://project.supabase.co/storage/signed/${path}` },
							error: null,
						};
					},
				};
			},
		},
	};
	return { client, uploads, signed };
}

function createStorage(client: RankedStorageClientLike) {
	return new RankedProofStorage(
		{
			url: "https://project.supabase.co",
			secretKey: "test-server-secret-key",
			bucket: "ranked-proofs",
			signedUrlTtlSeconds: 3600,
		},
		client
	);
}

describe("RankedProofStorage", () => {
	test("persiste une référence privée et ne retourne qu'une URL signée", async () => {
		const mock = rankedStorageMock();
		const storage = createStorage(mock.client);
		const result = await storage.upload({
			buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
			lobbyId: 42,
			userId: "1427690638576582697",
			ext: ".png",
		});

		expect(result.reference).toMatch(
			/^supabase-private:proof\/42\/1427690638576582697-[a-f0-9]{24}\.png$/
		);
		expect(result.signedUrl).toStartWith("https://project.supabase.co/storage/signed/");
		expect(mock.uploads).toHaveLength(1);
		expect(mock.signed[0]?.ttl).toBe(3600);
	});

	test("re-signe une référence privée et conserve les références locales historiques", async () => {
		const mock = rankedStorageMock();
		const storage = createStorage(mock.client);
		const reference = `supabase-private:proof/7/1427690638576582697-${"a".repeat(24)}.webp`;

		expect(await storage.signReference(reference)).toContain("/proof/7/");
		expect(await storage.signReference("/storage/disputes/legacy.png")).toBe(
			"/storage/disputes/legacy.png"
		);
		expect(await storage.signReference("supabase-private:../../secret")).toBeNull();
	});

	test("refuse les identifiants non sûrs et les TTL excessifs", async () => {
		const mock = rankedStorageMock();
		const storage = createStorage(mock.client);
		await expect(
			storage.upload({
				buffer: Buffer.from([1]),
				lobbyId: 1,
				userId: "../../admin",
				ext: ".png",
			})
		).rejects.toThrow("Identifiant utilisateur invalide");

		expect(
			() =>
				new RankedProofStorage(
					{
						url: "https://project.supabase.co",
						secretKey: "test-server-secret-key",
						bucket: "ranked-proofs",
						signedUrlTtlSeconds: 86_401,
					},
					mock.client
				)
		).toThrow("86400");
	});
});
