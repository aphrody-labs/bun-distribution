#!/usr/bin/env bun
// seo-bxc-audit.ts — audit SEO « en masse » des sites Rose Griffon.
// Combine bxc recon (rendu navigateur réel : statut HTTP, octets, hôtes d'assets) et un
// parse meta HTML (title/description/canonical/OG/JSON-LD) sur un set curé d'URLs clés.
// Usage : bun scripts/seo-bxc-audit.ts [--full] [--json]
// Destiné à devenir une tâche cron (seo-site-audit) une fois validé.

const BXC = process.env.BXC_BIN || "bxc";
const CONCURRENCY = Number(process.env.SEO_AUDIT_CONCURRENCY || 6);

const localMode = process.argv.includes("--local");

// Set curé : indexes de section + échantillons (pas les 3100 URLs azalee — on teste les pages à fort SEO).
const BASE_URLS: string[] = [
	// website
	"https://rosegriffon.fr/",
	"https://rosegriffon.fr/notre-equipe",
	"https://rosegriffon.fr/notre-equipe/staff",
	"https://rosegriffon.fr/notre-equipe/association",
	"https://rosegriffon.fr/notre-equipe/partenaires",
	"https://rosegriffon.fr/projets",
	"https://rosegriffon.fr/evenements",
	"https://rosegriffon.fr/chroniques",
	"https://rosegriffon.fr/a-propos",
	"https://rosegriffon.fr/nous-soutenir",
	// azalee — indexes + échantillons de détail
	"https://azalee.rosegriffon.fr/",
	"https://azalee.rosegriffon.fr/chara",
	"https://azalee.rosegriffon.fr/skill",
	"https://azalee.rosegriffon.fr/item",
	"https://azalee.rosegriffon.fr/aura",
	"https://azalee.rosegriffon.fr/passive",
	"https://azalee.rosegriffon.fr/news",
];

const URLS = BASE_URLS.map(url => {
	if (localMode) {
		return url
			.replace("https://rosegriffon.fr", "http://localhost:3000")
			.replace("https://azalee.rosegriffon.fr", "http://localhost:3001");
	}
	return url;
});

interface Audit {
	url: string;
	status: number;
	bytes: number;
	title: string | null;
	titleLen: number;
	descLen: number;
	canonical: boolean;
	ogImage: boolean;
	twitterCard: boolean;
	h1: number;
	jsonLd: number;
	issues: string[];
}

async function reconStatus(url: string): Promise<{ status: number; bytes: number }> {
	// bxc recon → markdown ; on en extrait le statut HTTP et la taille du corps (rendu réel).
	try {
		const proc = Bun.spawn([BXC, "recon", url, "--profile", "http", "--plain"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		const status = Number(out.match(/HTTP status[^0-9]*(\d{3})/i)?.[1] ?? 0);
		const bytes = Number(out.match(/Body bytes[^0-9]*(\d+)/i)?.[1] ?? 0);
		return { status, bytes };
	} catch {
		return { status: 0, bytes: 0 };
	}
}

function parseMeta(html: string): Omit<Audit, "url" | "status" | "bytes" | "issues"> {
	const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
	const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? "";
	return {
		title,
		titleLen: title?.length ?? 0,
		descLen: desc.length,
		canonical: /<link[^>]+rel=["']canonical["']/i.test(html),
		ogImage: /<meta[^>]+property=["']og:image["']/i.test(html),
		twitterCard: /<meta[^>]+name=["']twitter:card["']/i.test(html),
		h1: (html.match(/<h1[\s>]/gi) ?? []).length,
		jsonLd: (html.match(/application\/ld\+json/gi) ?? []).length,
	};
}

async function audit(url: string): Promise<Audit> {
	const [recon, htmlRes] = await Promise.all([
		reconStatus(url),
		fetch(url, { headers: { "user-agent": "RoseGriffon-SEO-Audit" } }).catch(() => null),
	]);
	const html = htmlRes ? await htmlRes.text().catch(() => "") : "";
	const meta = parseMeta(html);
	const status = recon.status || htmlRes?.status || 0;
	const issues: string[] = [];
	if (status !== 200) issues.push(`statut ${status}`);
	if (!meta.title) issues.push("title absent");
	else if (meta.titleLen < 15 || meta.titleLen > 65) issues.push(`title ${meta.titleLen} car (cible 15-65)`);
	if (meta.descLen === 0) issues.push("meta description absente");
	else if (meta.descLen < 70 || meta.descLen > 165) issues.push(`description ${meta.descLen} car (cible 70-165)`);
	if (!meta.canonical) issues.push("canonical absent");
	if (!meta.ogImage) issues.push("og:image absent");
	if (!meta.twitterCard) issues.push("twitter:card absent");
	if (meta.h1 === 0) issues.push("h1 absent");
	else if (meta.h1 > 1) issues.push(`${meta.h1} h1 (1 recommandé)`);
	if (meta.jsonLd === 0) issues.push("aucun JSON-LD");
	return { url, status, bytes: recon.bytes, ...meta, issues };
}

async function pool<T>(items: string[], fn: (x: string) => Promise<T>, n: number): Promise<T[]> {
	const out: T[] = [];
	let i = 0;
	const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
		while (i < items.length) {
			const idx = i++;
			out[idx] = await fn(items[idx]);
		}
	});
	await Promise.all(workers);
	return out;
}

const jsonMode = process.argv.includes("--json");
const results = await pool(URLS, audit, CONCURRENCY);

if (jsonMode) {
	console.log(JSON.stringify(results, null, 2));
} else {
	let ok = 0;
	console.log(`\n=== Audit SEO bxc — ${results.length} URLs ===\n`);
	for (const r of results) {
		if (r.issues.length === 0) {
			ok++;
			console.log(`  OK   ${r.url}  [${r.status}, ${(r.bytes / 1024).toFixed(0)}KB, ${r.jsonLd} JSON-LD]`);
		} else {
			console.log(`  WARN ${r.url}  [${r.status}]`);
			for (const iss of r.issues) console.log(`        - ${iss}`);
		}
	}
	console.log(`\n  ${ok}/${results.length} pages sans problème SEO détecté.`);
}
