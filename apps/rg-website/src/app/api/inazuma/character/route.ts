import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const BASE_ASSET_URL = "https://dxi4wb638ujep.cloudfront.net/1/k/5/a/";
const HASH_REGEX = /dxi4wb638ujep\.cloudfront\.net\/1\/k\/5\/a\/([a-zA-Z0-9]+)/;

const ALLOWED_HOSTS = new Set([
	"inazumaeleven.fandom.com",
	"characterviewer.inazuma-eleven.fr",
	"dxi4wb638ujep.cloudfront.net",
]);

function isUrlAllowed(raw: string): URL | null {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return null;
	}
	if (parsed.protocol !== "https:") {
		return null;
	}
	if (!ALLOWED_HOSTS.has(parsed.hostname)) {
		return null;
	}
	return parsed;
}

export async function GET(request: NextRequest) {
	const { searchParams } = request.nextUrl;
	const url = searchParams.get("url");

	if (!url) {
		return NextResponse.json({ error: "URL parameter is required" }, { status: 400 });
	}

	const target = isUrlAllowed(url);
	if (!target) {
		return NextResponse.json({ error: "URL not allowed" }, { status: 400 });
	}

	try {
		const ctrl = new AbortController();
		const timeout = setTimeout(() => ctrl.abort(), 5000);
		const response = await fetch(target.toString(), {
			headers: {
				"User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
			},
			redirect: "error",
			signal: ctrl.signal,
		});
		clearTimeout(timeout);

		if (!response.ok) {
			return NextResponse.json({ error: `Upstream HTTP ${response.status}` }, { status: 502 });
		}
		const html = await response.text();

		const match = html.match(HASH_REGEX);
		if (!match?.[1]) {
			return NextResponse.json({ error: "Character hash not found in page" }, { status: 404 });
		}

		const hash = match[1];
		const titleMatch = html.match(/<title>(.*?) \|/);
		const name = titleMatch?.[1]?.trim() ?? "Unknown Character";

		const assets = {
			fullbody: Array.from({ length: 8 }, (_, i) => `${BASE_ASSET_URL}${hash}_r${i}_fullbody.webp`),
			portrait: Array.from({ length: 8 }, (_, i) => `${BASE_ASSET_URL}${hash}_r${i}.webp`),
		};

		return NextResponse.json({
			assets,
			hash,
			name,
			sourceUrl: target.toString(),
		});
	} catch (error) {
		console.error("Error fetching Inazuma character:", error);
		return NextResponse.json({ error: "Failed to fetch character data" }, { status: 502 });
	}
}
