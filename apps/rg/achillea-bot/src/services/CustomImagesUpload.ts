import { Buffer } from "node:buffer";
import crypto from "node:crypto";

import axios from "axios";
import type { Attachment } from "discord.js";
import sharp from "sharp";
import type { Generated, Kysely } from "kysely";
import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";

import { coreManagerConfig } from "@/configs";
import { discordBotProfile } from "@/configs/discord-profile";
import { Service } from "@/decorators";
import { SupabaseImageStorage } from "@/services/SupabaseImageStorage";

/** Cloisonne les images issues des flux Discord (attachments/emojis) dans le bucket Supabase Storage. */
const STORAGE_FOLDER = "discord";

interface ImageDatabase {
	image: {
		id: Generated<number>;
		created_at: Generated<Date>;
		updated_at: Generated<Date>;
		file_name: string;
		base_path: string;
		url: string;
		size: number;
		tags: string[];
		hash: string;
		delete_hash: string;
	};
}

const sql = createAchilleaSql<ImageDatabase>() as Kysely<ImageDatabase>;

@Service()
export class CustomImagesUpload {
	constructor(
		private imageStorage: SupabaseImageStorage
	) {}

	async hashAttachmentStream(url: string): Promise<{ hash: string; buffer: Buffer }> {
		const res = await axios.get(url, { responseType: "stream" });
		const hash = crypto.createHash("md5");

		const chunks: Buffer[] = [];

		return new Promise((resolve, reject) => {
			res.data.on("data", (chunk: Buffer) => {
				hash.update(chunk);
				chunks.push(chunk);
			});
			res.data.on("end", () => {
				const digest = hash.digest("hex");
				const buffer = Buffer.concat(chunks);
				resolve({ hash: digest, buffer });
			});
			res.data.on("error", reject);
		});
	}

	async uploadImageBuffer(buffer: Buffer, mimeType: string): Promise<string[]> {
		const { id, url } = await this.imageStorage.uploadImageBuffer(buffer, mimeType, STORAGE_FOLDER);

		return [id, url];
	}

	async processAttachment(
		attachment: Attachment,
		uploadEmoji: boolean,
		overrideEmoji: boolean,
		emojiName?: string,
	emojiId?: string
	): Promise<string | { url: string; emoji?: string }> {
		// Only process images (png, jpg, jpeg)
		const ext = attachment.name ? attachment.name.split(".").pop()?.toLowerCase() : "";
		const mimeType =
			ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : null;

		if (!mimeType) throw new Error("Unsupported file type.");

		// Step 1: stream & hash
		const { hash, buffer } = await this.hashAttachmentStream(attachment.url);

		// Step 2: check DB for existing hash
		const existing = await sql
			.selectFrom("image")
			.select("url")
			.where("hash", "=", hash)
			.executeTakeFirst();
		if (existing) {
			// Already stored, return existing URL
			return existing.url;
		}

		// Step 3: upload since new image
		const [fileName, uploadedUrl] = await this.uploadImageBuffer(buffer, mimeType);

		// Step 4: store new record in DB
		await sql.insertInto("image").values({
			created_at: new Date(),
			updated_at: new Date(),
			file_name: fileName,
			base_path: STORAGE_FOLDER,
			url: uploadedUrl,
			size: buffer.length,
			tags: [],
			hash,
			delete_hash: "",
		}).execute();
		// Step 5: delete emoji if override is true
		if (overrideEmoji && emojiId) this.deleteEmoji(emojiId).catch((err) => console.error(err));

		// Step 6: optionally upload as emoji
		return uploadEmoji && emojiName !== undefined
			? await this.uploadAsEmoji(buffer, mimeType, emojiName, uploadedUrl)
			: uploadedUrl;
	}

	async deleteDistantImage(image: { fileName: string }) {
		return this.imageStorage.deleteImage(image.fileName, STORAGE_FOLDER);
	}

	async ensureBufferSize(imageBuffer: Buffer) {
		let buffer = await sharp(imageBuffer)
			.resize(128, 128, { fit: "inside" })
			.png({ compressionLevel: 9, palette: true })
			.toBuffer();

		if (buffer.length > 256 * 1024) {
			buffer = await sharp(imageBuffer)
				.resize(128, 128, { fit: "inside" })
				.jpeg({ quality: 80 })
				.toBuffer();
		}

		if (buffer.length > 256 * 1024) {
			throw new Error(
				`Emoji too large even after compression (${(buffer.length / 1024).toFixed(1)} KB)`
			);
		}

		return buffer;
	}

	async uploadAsEmoji(
		buffer: Buffer,
		mimeType: string,
		name: string,
		fallbackUrl: string
	): Promise<{ url: string; emojiId: string }> {
		const newBuffer = await this.ensureBufferSize(buffer);

		const base64 = `data:${mimeType};base64,${newBuffer.toString("base64")}`;
		const token = discordBotProfile.token;

		const res = await axios.post(
			`https://discord.com/api/v10/applications/${coreManagerConfig.botId}/emojis`,
			{
				name,
				image: base64,
			},
			{
				headers: {
					Authorization: `Bot ${token}`,
					"Content-Type": "application/json",
				},
			}
		);

		const emojiData = res.data; // { id, name }
		const emojiId = `${emojiData.id}`;

		return { url: fallbackUrl, emojiId };
	}

	async deleteEmoji(emojiId: string): Promise<void> {
		const url = `https://discord.com/api/v10/applications/${coreManagerConfig.botId}/emojis/${emojiId}`;

		const token = discordBotProfile.token;

		await axios.delete(url, {
			headers: {
				Authorization: `Bot ${token}`,
			},
		});
	}

	async editEmoji(emojiId: string, newName: string): Promise<void> {
		const url = `https://discord.com/api/v10/applications/${coreManagerConfig.botId}/emojis/${emojiId}`;

		await axios.patch(
			url,
			{ name: newName },
			{
				headers: {
					Authorization: `Bot ${discordBotProfile.token}`,
					"Content-Type": "application/json",
				},
			}
		);
	}

	async fetchImageAsBuffer(imageUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
		// Download image as arraybuffer, auto-detect content-type
		const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
		const buffer = Buffer.from(response.data);
		const mimeType = (response.headers["content-type"] as string | undefined) || "image/png"; // fallback

		return { buffer, mimeType };
	}
}
