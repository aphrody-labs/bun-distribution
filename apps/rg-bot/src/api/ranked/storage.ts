// Stockage privé des preuves ranked dans Supabase Storage.

import crypto from "node:crypto";

import { createPostgresClient } from "@rosegriffon/db/postgres-client";

const PRIVATE_REFERENCE_PREFIX = "supabase-private:";
const DEFAULT_BUCKET = "ranked-proofs";
const DEFAULT_SIGNED_URL_TTL = 60 * 60;
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

interface RankedBucketClient {
	upload(
		path: string,
		body: Uint8Array,
		options: { cacheControl: string; contentType: string; upsert: boolean }
	): Promise<{ error: { message: string } | null }>;
	createSignedUrl(
		path: string,
		expiresIn: number
	): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
}

export interface RankedStorageClientLike {
	storage: { from(bucket: string): RankedBucketClient };
}

export interface RankedStorageConfig {
	url: string;
	secretKey: string;
	bucket: string;
	signedUrlTtlSeconds: number;
}

export interface ProofUploadInput {
	buffer: Buffer;
	lobbyId: number;
	userId: string;
	ext: string;
}

export interface StoredRankedProof {
	reference: string;
	signedUrl: string;
}

function validateConfig(config: RankedStorageConfig): void {
	const url = new URL(config.url);
	const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
	if (url.protocol !== "https:" && !loopback) throw new Error("SUPABASE_URL doit utiliser HTTPS");
	if (!config.secretKey || config.secretKey.startsWith("sb_publishable_")) {
		throw new Error("Une clé secrète serveur Supabase est requise");
	}
	if (!/^[a-z0-9][a-z0-9._-]{1,62}$/i.test(config.bucket)) {
		throw new Error("SUPABASE_PRIVATE_STORAGE_BUCKET invalide");
	}
	if (
		!Number.isInteger(config.signedUrlTtlSeconds) ||
		config.signedUrlTtlSeconds < 60 ||
		config.signedUrlTtlSeconds > 86_400
	) {
		throw new Error("SUPABASE_SIGNED_URL_TTL doit être compris entre 60 et 86400 secondes");
	}
}

function contentTypeForExt(ext: string): string | null {
	switch (ext) {
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		default:
			return null;
	}
}

export class RankedProofStorage {
	private readonly bucket: RankedBucketClient;

	constructor(
		private readonly config: RankedStorageConfig,
		client?: RankedStorageClientLike
	) {
		validateConfig(config);
		const storageClient = client ?? createPostgresClient();
		this.bucket = storageClient.storage.from(config.bucket);
	}

	async upload(input: ProofUploadInput): Promise<StoredRankedProof> {
		if (!Number.isSafeInteger(input.lobbyId) || input.lobbyId < 1) {
			throw new Error("Identifiant de lobby invalide");
		}
		if (!/^\d{5,24}$/.test(input.userId)) throw new Error("Identifiant utilisateur invalide");
		if (input.buffer.byteLength === 0 || input.buffer.byteLength > MAX_UPLOAD_BYTES) {
			throw new Error("Taille de preuve invalide");
		}
		const contentType = contentTypeForExt(input.ext);
		if (!contentType) throw new Error("Type de preuve invalide");

		const hash = crypto.createHash("sha256").update(input.buffer).digest("hex").slice(0, 24);
		const objectKey = `proof/${input.lobbyId}/${input.userId}-${hash}${input.ext}`;
		const { error } = await this.bucket.upload(objectKey, new Uint8Array(input.buffer), {
			cacheControl: "3600",
			contentType,
			upsert: true,
		});
		if (error) throw new Error(`Upload de preuve impossible: ${error.message}`);

		const signedUrl = await this.signReference(`${PRIVATE_REFERENCE_PREFIX}${objectKey}`);
		if (!signedUrl) throw new Error("Création de l'URL signée impossible");
		return { reference: `${PRIVATE_REFERENCE_PREFIX}${objectKey}`, signedUrl };
	}

	async signReference(reference: string): Promise<string | null> {
		if (!reference.startsWith(PRIVATE_REFERENCE_PREFIX)) return reference || null;
		const objectKey = reference.slice(PRIVATE_REFERENCE_PREFIX.length);
		if (!/^proof\/\d+\/\d{5,24}-[a-f0-9]{24}\.(?:png|jpg|jpeg|webp)$/.test(objectKey)) {
			return null;
		}
		const { data, error } = await this.bucket.createSignedUrl(
			objectKey,
			this.config.signedUrlTtlSeconds
		);
		return error ? null : (data?.signedUrl ?? null);
	}
}

function createConfiguredStorage(): RankedProofStorage | null {
	const url = process.env.SUPABASE_URL ?? "";
	const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? "";
	if (!url || !secretKey) return null;
	return new RankedProofStorage({
		url,
		secretKey,
		bucket: process.env.SUPABASE_PRIVATE_STORAGE_BUCKET ?? DEFAULT_BUCKET,
		signedUrlTtlSeconds: Number(process.env.SUPABASE_SIGNED_URL_TTL ?? DEFAULT_SIGNED_URL_TTL),
	});
}

const configuredStorage = createConfiguredStorage();

export function isSupabaseStorageEnabled(): boolean {
	return configuredStorage !== null;
}

export async function uploadRankedProof(
	input: ProofUploadInput
): Promise<StoredRankedProof | null> {
	if (!configuredStorage) return null;
	try {
		return await configuredStorage.upload(input);
	} catch (error) {
		console.error("[ranked] upload Supabase Storage échoué", error);
		return null;
	}
}

/** Signe une référence privée ; laisse les anciennes URL et références locales intactes. */
export async function resolveRankedProofUrl(reference: string | null): Promise<string | null> {
	if (!reference) return null;
	if (!reference.startsWith(PRIVATE_REFERENCE_PREFIX)) return reference;
	if (!configuredStorage) return null;
	return configuredStorage.signReference(reference);
}
