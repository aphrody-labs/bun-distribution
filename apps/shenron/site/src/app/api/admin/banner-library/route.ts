/**
 * GET /api/admin/banner-library — galerie d'images utilisables comme bannières
 * (admin only). Agrège :
 *   - assets wiki uploadés (`apps/shenron/site/public/wiki/banners`)
 *   - assets officiels Toei / DB Official (`apps/shenron/bot/public/db/{toei,dbofficial}`)
 *
 * Chaque entrée expose un `value` stockable tel quel dans PageBanners
 * (URL absolue bot pour /db/*, chemin `./assets/wiki/...` pour les uploads).
 */
import { isAdminOrToken } from "@/lib/admin-guard";
import { API_URL } from "@/lib/config";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMG_RE = /\.(png|jpe?g|webp|gif)$/i;

type Entry = {
	/** Valeur à stocker en config (URL ou chemin DB). */
	value: string;
	/** URL d'aperçu. */
	url: string;
	/** Libellé court. */
	name: string;
	/** Groupe : official | wiki. */
	group: "official" | "wiki";
};

async function listDir(abs: string, map: (name: string) => Entry | null): Promise<Entry[]> {
	try {
		const names = await readdir(abs);
		const out: Entry[] = [];
		for (const name of names) {
			if (!IMG_RE.test(name)) continue;
			// Ignore variantes avif/webp pré-générées si le jpeg/png source existe
			// (on préfère le fichier « principal » pour la config).
			if (/\.(avif|webp)$/i.test(name)) {
				const stem = name.replace(/\.(avif|webp)$/i, "");
				const hasMaster = names.some((n) =>
					new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(png|jpe?g)$`, "i").test(n)
				);
				if (hasMaster) continue;
			}
			const e = map(name);
			if (e) out.push(e);
		}
		return out;
	} catch {
		return [];
	}
}

export async function GET(req: NextRequest) {
	if (!(await isAdminOrToken(req))) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	// Chemins relatifs au monorepo (site tourne depuis apps/shenron/site).
	const root = join(process.cwd(), "..", "..");
	const siteWikiBanners = join(process.cwd(), "public", "wiki", "banners");
	const botDb = join(process.cwd(), "..", "bot", "public", "db");
	// Fallback si cwd n'est pas apps/shenron/site (ex. monorepo root).
	const altBotDb = join(root, "apps", "bot", "public", "db");
	const altWiki = join(root, "apps", "site", "public", "wiki", "banners");

	const [wiki, toei, official] = await Promise.all([
		listDir(siteWikiBanners, (name) => ({
			value: `./assets/wiki/banners/${name}`,
			url: `${API_URL}/assets/wiki/banners/${name}`,
			name,
			group: "wiki" as const,
		})).then(async (a) =>
			a.length
				? a
				: listDir(altWiki, (name) => ({
						value: `./assets/wiki/banners/${name}`,
						url: `${API_URL}/assets/wiki/banners/${name}`,
						name,
						group: "wiki" as const,
					}))
		),
		listDir(join(botDb, "toei"), (name) => ({
			value: `${API_URL}/db/toei/${name}`,
			url: `${API_URL}/db/toei/${name}`,
			name: `toei/${name}`,
			group: "official" as const,
		})).then(async (a) =>
			a.length
				? a
				: listDir(join(altBotDb, "toei"), (name) => ({
						value: `${API_URL}/db/toei/${name}`,
						url: `${API_URL}/db/toei/${name}`,
						name: `toei/${name}`,
						group: "official" as const,
					}))
		),
		listDir(join(botDb, "dbofficial"), (name) => ({
			value: `${API_URL}/db/dbofficial/${name}`,
			url: `${API_URL}/db/dbofficial/${name}`,
			name: `dbofficial/${name}`,
			group: "official" as const,
		})).then(async (a) =>
			a.length
				? a
				: listDir(join(altBotDb, "dbofficial"), (name) => ({
						value: `${API_URL}/db/dbofficial/${name}`,
						url: `${API_URL}/db/dbofficial/${name}`,
						name: `dbofficial/${name}`,
						group: "official" as const,
					}))
		),
	]);

	const items = [...official, ...toei, ...wiki].toSorted((a, b) => a.name.localeCompare(b.name));

	return NextResponse.json({
		count: items.length,
		items,
	});
}
