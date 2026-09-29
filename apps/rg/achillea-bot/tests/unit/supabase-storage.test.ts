import { Buffer } from "node:buffer";

import { describe, expect, test } from "bun:test";

import {
	MAX_IMAGE_UPLOAD_BYTES,
	ServerImageStorageClient,
	sniffImageMime,
	type StorageClientLike,
	validateSupabaseStorageConfig,
} from "../../src/services/SupabaseImageStorage";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

function storageMock(error: { message: string } | null = null) {
	const uploads: Array<{ path: string; body: Uint8Array; options: unknown }> = [];
	const removals: string[][] = [];
	const client: StorageClientLike = {
		storage: {
			from(bucket) {
				expect(bucket).toBe("images");
				return {
					async upload(path, body, options) {
						uploads.push({ path, body, options });
						return { error };
					},
					async remove(paths) {
						removals.push(paths);
						return { error };
					},
					getPublicUrl(path) {
						return { data: { publicUrl: `https://cdn.example.test/${path}` } };
					},
				};
			},
		},
	};
	return { client, uploads, removals };
}

function createStorage(client: StorageClientLike) {
	return new ServerImageStorageClient(
		{
			url: "https://project.supabase.co",
			serviceKey: "test-server-secret-key",
			bucket: "images",
		},
		client
	);
}

describe("Supabase Storage serveur", () => {
	test("détecte les signatures d'image autorisées", () => {
		expect(sniffImageMime(PNG)).toBe("image/png");
		expect(sniffImageMime(Buffer.from("GIF89a"))).toBe("image/gif");
		expect(sniffImageMime(Buffer.from("not an image"))).toBeNull();
	});

	test("upload avec un chemin cloisonné et des options sûres", async () => {
		const mock = storageMock();
		const storage = createStorage(mock.client);
		const result = await storage.uploadImageBuffer(PNG, "image/png", "proxy");

		expect(mock.uploads).toHaveLength(1);
		expect(mock.uploads[0]?.path).toMatch(/^proxy\/[a-f0-9]{24}\.png$/);
		expect(mock.uploads[0]?.options).toEqual({
			cacheControl: "31536000",
			contentType: "image/png",
			upsert: true,
		});
		expect(result.url).toStartWith("https://cdn.example.test/proxy/");
	});

	test("refuse MIME usurpé, chemin traversant et fichier trop volumineux", async () => {
		const mock = storageMock();
		const storage = createStorage(mock.client);

		await expect(storage.uploadImageBuffer(PNG, "image/jpeg", "proxy")).rejects.toThrow(
			"ne correspond pas"
		);
		await expect(storage.uploadImageBuffer(PNG, "image/png", "../proxy")).rejects.toThrow(
			"Dossier Storage invalide"
		);
		await expect(
			storage.uploadImageBuffer(Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES + 1, 0), "image/png", "proxy")
		).rejects.toThrow("Taille d'image invalide");
		expect(mock.uploads).toHaveLength(0);
	});

	test("supprime uniquement un identifiant généré par le service", async () => {
		const mock = storageMock();
		const storage = createStorage(mock.client);

		expect(await storage.deleteImage(`${"a".repeat(24)}.webp`, "proxy")).toBe(true);
		expect(mock.removals).toEqual([[`proxy/${"a".repeat(24)}.webp`]]);
		await expect(storage.deleteImage("../secret", "proxy")).rejects.toThrow(
			"Identifiant d'image invalide"
		);
	});

	test("refuse URL non TLS, bucket invalide et clé publique", () => {
		expect(() =>
			validateSupabaseStorageConfig({
				url: "http://project.supabase.co",
				serviceKey: "test-server-secret-key",
				bucket: "images",
			})
		).toThrow("HTTPS");
		expect(() =>
			validateSupabaseStorageConfig({
				url: "https://project.supabase.co",
				serviceKey: "test-server-secret-key",
				bucket: "../images",
			})
		).toThrow("BUCKET invalide");
		expect(() =>
			validateSupabaseStorageConfig({
				url: "https://project.supabase.co",
				serviceKey: "sb_publishable_test-only",
				bucket: "images",
			})
		).toThrow("clé publique");
	});
});
