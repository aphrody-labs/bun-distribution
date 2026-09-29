import "reflect-metadata";

import { Buffer } from "node:buffer";
import crypto from "node:crypto";

import { createPostgresClient } from "@rosegriffon/db/service";

import { Service } from "../utils/decorators/Service";
import { env } from "../utils/types/environment";

export const MAX_IMAGE_UPLOAD_BYTES = 6 * 1024 * 1024;

const MIME_EXT = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
} as const;

export type SupportedImageMime = keyof typeof MIME_EXT;

interface StorageBucketClient {
	upload(
		path: string,
		body: Uint8Array,
		options: { cacheControl: string; contentType: string; upsert: boolean }
	): Promise<{ error: { message: string } | null }>;
	remove(paths: string[]): Promise<{ error: { message: string } | null }>;
	getPublicUrl(path: string): { data: { publicUrl: string } };
}

export interface StorageClientLike {
	storage: {
		from(bucket: string): StorageBucketClient;
	};
}

export interface SupabaseStorageConfig {
	url: string;
	serviceKey: string;
	bucket: string;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
	const payload = token.split(".")[1];
	if (!payload) return null;
	try {
		return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
	} catch {
		return null;
	}
}

export function validateSupabaseStorageConfig(config: SupabaseStorageConfig): void {
	let endpoint: URL;
	try {
		endpoint = new URL(config.url);
	} catch {
		throw new Error("SUPABASE_URL invalide");
	}

	const loopback = ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname);
	if (endpoint.protocol !== "https:" && !loopback) {
		throw new Error("SUPABASE_URL doit utiliser HTTPS hors développement local");
	}
	if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
		throw new Error("SUPABASE_URL ne doit contenir ni identifiants ni paramètres");
	}
	if (!/^[a-z0-9][a-z0-9._-]{1,62}$/i.test(config.bucket)) {
		throw new Error("SUPABASE_STORAGE_BUCKET invalide");
	}
	if (!config.serviceKey.trim()) {
		throw new Error("SUPABASE_SERVICE_KEY absente");
	}
	if (config.serviceKey.startsWith("sb_publishable_")) {
		throw new Error("Une clé publique ne peut pas être utilisée pour les uploads serveur");
	}
	const jwtRole = decodeJwtPayload(config.serviceKey)?.role;
	if (jwtRole === "anon") {
		throw new Error("La clé anon ne peut pas être utilisée pour les uploads serveur");
	}
}

function validatePathSegment(value: string, label: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) {
		throw new Error(`${label} invalide`);
	}
}

export function sniffImageMime(buffer: Uint8Array): SupportedImageMime | null {
	if (
		buffer.length >= 8 &&
		buffer[0] === 0x89 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x4e &&
		buffer[3] === 0x47 &&
		buffer[4] === 0x0d &&
		buffer[5] === 0x0a &&
		buffer[6] === 0x1a &&
		buffer[7] === 0x0a
	) {
		return "image/png";
	}
	if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
		return "image/jpeg";
	}
	if (buffer.length >= 6) {
		const signature = Buffer.from(buffer.subarray(0, 6)).toString("ascii");
		if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
	}
	if (
		buffer.length >= 12 &&
		Buffer.from(buffer.subarray(0, 4)).toString("ascii") === "RIFF" &&
		Buffer.from(buffer.subarray(8, 12)).toString("ascii") === "WEBP"
	) {
		return "image/webp";
	}
	return null;
}

/** Client Storage sans état d'auth utilisateur, testable sans requête distante. */
export class ServerImageStorageClient {
	private readonly bucket: StorageBucketClient;

	constructor(config: SupabaseStorageConfig, client?: StorageClientLike) {
		const normalizedConfig = { ...config, url: config.url.replace(/\/+$/, "") };
		validateSupabaseStorageConfig(normalizedConfig);
		const storageClient = client ?? createPostgresClient();
		this.bucket = storageClient.storage.from(normalizedConfig.bucket);
	}

	async uploadImageBuffer(
		buffer: Buffer,
		mimeType: string,
		folder: string
	): Promise<{ id: string; url: string }> {
		validatePathSegment(folder, "Dossier Storage");
		if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
			throw new Error(`Taille d'image invalide (maximum ${MAX_IMAGE_UPLOAD_BYTES} octets)`);
		}

		const detectedMime = sniffImageMime(buffer);
		if (!detectedMime || !(mimeType in MIME_EXT) || detectedMime !== mimeType) {
			throw new Error("Le contenu du fichier ne correspond pas à un type d'image autorisé");
		}

		const extension = MIME_EXT[detectedMime];
		const id = `${crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 24)}.${extension}`;
		const objectKey = `${folder}/${id}`;
		const { error } = await this.bucket.upload(objectKey, new Uint8Array(buffer), {
			cacheControl: "31536000",
			contentType: detectedMime,
			upsert: true,
		});
		if (error) throw new Error(`Upload Supabase Storage échoué: ${error.message}`);

		return { id, url: this.bucket.getPublicUrl(objectKey).data.publicUrl };
	}

	async deleteImage(id: string, folder: string): Promise<boolean> {
		validatePathSegment(folder, "Dossier Storage");
		if (!/^[a-f0-9]{24}\.(?:png|jpg|webp|gif)$/.test(id)) {
			throw new Error("Identifiant d'image invalide");
		}
		const { error } = await this.bucket.remove([`${folder}/${id}`]);
		return error === null;
	}
}

@Service()
export class SupabaseImageStorage {
	private readonly client: ServerImageStorageClient | null;

	constructor() {
		const config = {
			url: env.SUPABASE_URL ?? "",
			serviceKey: env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_KEY ?? "",
			bucket: env.SUPABASE_STORAGE_BUCKET,
		};
		this.client = config.url && config.serviceKey ? new ServerImageStorageClient(config) : null;
	}

	isEnabled(): boolean {
		return this.client !== null;
	}

	uploadImageBuffer(buffer: Buffer, mimeType: string, folder: string) {
		if (!this.client) throw new Error("Supabase Storage serveur non configuré");
		return this.client.uploadImageBuffer(buffer, mimeType, folder);
	}

	deleteImage(id: string, folder: string) {
		if (!this.client) throw new Error("Supabase Storage serveur non configuré");
		return this.client.deleteImage(id, folder);
	}
}
