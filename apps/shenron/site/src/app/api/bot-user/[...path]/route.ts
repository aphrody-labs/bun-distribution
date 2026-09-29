/**
 * Proxy user-authenticated /api/bot-user/* → shenron bot REST API.
 *
 * Diffère du proxy admin (`/api/bot-admin/*`) :
 *  - Ne nécessite PAS `roleAdmin === true`, juste une session Better Auth valide
 *  - Ajoute headers HMAC `X-Acting-User`/`X-Acting-Ts`/`X-Acting-Sig` que le
 *    bot vérifie via `API_USER_SECRET` partagé entre les deux applis
 *  - Permet à un user normal d'agir sur le bot pour jouer (/games/*),
 *    récupérer son profil (/me/*), etc.
 */
import { getCurrentUser } from "@/lib/session";
import { env } from "@/lib/env";
import { API_URL as API } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import { signActingUser } from "@shenron/auth/acting-user";

const USER_SECRET = env.SHENRON_USER_SECRET ?? "";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
	const me = await getCurrentUser();
	if (!me?.discordId) {
		return NextResponse.json({ error: "Login requis" }, { status: 401 });
	}
	if (!USER_SECRET) {
		return NextResponse.json(
			{ error: "SHENRON_USER_SECRET non configuré côté site" },
			{ status: 500 }
		);
	}

	const { path } = await ctx.params;
	// Durcissement défense-en-profondeur : refuse toute traversée de chemin
	// (`..`, `.`, séparateurs) qui sortirait du préfixe `/api/` de l'hôte bot.
	// Ce proxy est authentifié (HMAC) → on évite tout confused-deputy.
	if (path.some((s) => s === ".." || s === "." || s.includes("/") || s.includes("\\"))) {
		return NextResponse.json({ error: "invalid path" }, { status: 400 });
	}
	const url = `${API}/api/${path.join("/")}${req.nextUrl.search}`;
	const body =
		req.method === "GET" || req.method === "HEAD"
			? undefined
			: await req.text().catch(() => undefined);

	// En-têtes `x-acting-user` / `x-acting-ts` / `x-acting-sig` (ordre et octets
	// inchangés), signés par le module partagé `@shenron/auth/acting-user`.
	const acting = signActingUser({ secret: USER_SECRET, discordId: me.discordId });
	const res = await fetch(url, {
		method: req.method,
		body,
		headers: {
			"content-type": req.headers.get("content-type") ?? "application/json",
			accept: req.headers.get("accept") ?? "application/json",
			...acting,
		},
		cache: "no-store",
		signal: req.signal,
	});

	const ct = res.headers.get("content-type") ?? "application/json";
	if (ct.includes("text/event-stream") && res.body) {
		return new NextResponse(res.body, {
			status: res.status,
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache, no-transform",
				connection: "keep-alive",
				"x-accel-buffering": "no",
			},
		});
	}
	// Binaire (images canvas WebP/PNG, assets) : NE PAS passer par res.text()
	// qui décode les octets en UTF-8 et corrompt le fichier. Forward le buffer
	// brut + préserve le Cache-Control.
	if (!ct.includes("application/json") && !ct.startsWith("text/")) {
		const buf = await res.arrayBuffer();
		const headers = new Headers({ "content-type": ct });
		const cc = res.headers.get("cache-control");
		if (cc) headers.set("cache-control", cc);
		return new NextResponse(buf, { status: res.status, headers });
	}

	const text = await res.text();
	return new NextResponse(text, {
		status: res.status,
		headers: { "content-type": ct },
	});
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
