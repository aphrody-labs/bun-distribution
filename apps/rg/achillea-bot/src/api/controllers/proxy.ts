import crypto from "node:crypto";

import { Controller, Get, PathParams, Post, Req, Res, UseBefore } from "@tsed/common";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import type { Generated, Kysely } from "kysely";
import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";

import { CookieAuthorize } from "@/api/middlewares";
import { SupabaseImageStorage } from "@/services/SupabaseImageStorage";
import { BaseController } from "@/utils/classes";
import { resolveDependenciesSync } from "@/utils/functions";

/** Cloisonne les objets uploadés via le proxy web dans le bucket Supabase Storage. */
const STORAGE_FOLDER = "proxy";

/** Aligné sur nginx `client_max_body_size 6M` (achillea.rosegriffon.conf). */
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

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

const db = createAchilleaSql<ImageDatabase>() as Kysely<ImageDatabase>;

const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: MAX_UPLOAD_BYTES },
	fileFilter: (_req, file, cb) => {
		if (!ALLOWED_MIME.has(file.mimetype)) {
			cb(new Error("Type d'image non supporté (png, jpeg, webp, gif uniquement)"));
			return;
		}
		cb(null, true);
	},
});

/**
 * Wrapper multer : convertit LIMIT_FILE_SIZE / fileFilter en JSON propre
 * (sinon Express renvoie 500 HTML ou laisse le front bloqué en « En attente »).
 */
function multerSingleFile(req: Request, res: Response, next: NextFunction) {
	upload.single("file")(req, res, (err: unknown) => {
		if (!err) return next();
		if (err instanceof multer.MulterError) {
			if (err.code === "LIMIT_FILE_SIZE") {
				return res.status(413).json({
					error: "File too large",
					detail: `Taille max ${MAX_UPLOAD_BYTES / (1024 * 1024)} Mo`,
				});
			}
			return res.status(400).json({ error: "Upload rejected", detail: err.message });
		}
		const message = err instanceof Error ? err.message : "Upload rejected";
		return res.status(400).json({ error: "Upload rejected", detail: message });
	});
}

/** Ids CDN type `66326123982d699d.png` (hex + extension). Interdit `..` et slash. */
function isSafeImageId(id: string): boolean {
	if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) return false;
	return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id);
}

@Controller("/proxy")
export class ProxyUploadController extends BaseController {
	private imageStorage: SupabaseImageStorage;

	constructor() {
		super();

		[this.imageStorage] = resolveDependenciesSync([SupabaseImageStorage]);
	}

	@Post("/upload")
	@UseBefore(CookieAuthorize)
	@UseBefore(multerSingleFile)
	async upload(@Req() req: Request, @Res() res: Response) {
		const file = req.file;
		if (!file) {
			return res.status(400).json({
				error: "No file uploaded",
				detail: "Aucun fichier reçu (type non supporté ou champ 'file' manquant)",
			});
		}
		if (!this.imageStorage.isEnabled()) {
			return res.status(503).json({
				error: "Image upload disabled (SUPABASE_URL/SUPABASE_SERVICE_KEY non configurés)",
			});
		}

		try {
			const buffer = file.buffer;
			const hash = crypto.createHash("md5").update(buffer).digest("hex");

			// Dédup : même contenu déjà connu → pas de re-upload
			const existing = await db
				.selectFrom("image")
				.select(["file_name", "url"])
				.where("hash", "=", hash)
				.executeTakeFirst();
			if (existing) {
				return res.status(200).json({ id: existing.file_name, url: existing.url });
			}

			const { id, url } = await this.imageStorage.uploadImageBuffer(
				buffer,
				file.mimetype,
				STORAGE_FOLDER
			);

			const now = new Date();
			await db.insertInto("image").values({
				created_at: now,
				updated_at: now,
				file_name: id,
				base_path: STORAGE_FOLDER,
				url,
				size: buffer.byteLength,
				tags: [],
				hash,
				delete_hash: "",
			}).execute();

			return res.status(200).json({ id, url });
		} catch (err: any) {
			return res.status(500).json({
				error: "Proxy upload failed",
				detail: err?.message,
			});
		}
	}

	@Get("/delete/:id")
	@UseBefore(CookieAuthorize)
	async deleteImage(@PathParams("id") id: string, @Res() res: Response) {
		if (!isSafeImageId(id)) {
			return res.status(400).json({ error: "Invalid image id" });
		}
		if (!this.imageStorage.isEnabled()) {
			return res.status(503).json({
				error: "Image deletion disabled (SUPABASE_URL/SUPABASE_SERVICE_KEY non configurés)",
			});
		}
		try {
			const ok = await this.imageStorage.deleteImage(id, STORAGE_FOLDER);

			if (ok) {
				await db.deleteFrom("image").where("file_name", "=", id).execute();
			}

			return res.status(200).json({ success: ok });
		} catch (err: any) {
			return res.status(500).json({
				error: "Proxy delete failed",
				detail: err?.message,
			});
		}
	}
}
