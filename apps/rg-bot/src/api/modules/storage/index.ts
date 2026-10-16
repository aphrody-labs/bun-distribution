import { Elysia } from "elysia";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(process.env.RG_STORAGE_ROOT ?? "/var/www/rg-storage");

export const storageController = new Elysia({ prefix: "/storage" })
	.get("/health", () => ({
		service: "rg-storage-elysia",
		root: ROOT,
		ok: true
	}))
	.get("/public/*", async ({ params, set }) => {
		const rawPath = params["*"];
		if (!rawPath) {
			set.status = 400;
			return { error: "InvalidRequest", message: "Missing object path" };
		}

		const full = resolve(ROOT, rawPath);
		if (!full.startsWith(ROOT)) {
			set.status = 403;
			return { error: "Forbidden", message: "Directory traversal prohibited" };
		}

		const file = Bun.file(full);
		if (!(await file.exists())) {
			set.status = 404;
			return { error: "not_found", message: "Object not found" };
		}

		set.headers["cache-control"] = "public, max-age=3600";
		set.headers["content-type"] = file.type || "application/octet-stream";
		return file;
	});
