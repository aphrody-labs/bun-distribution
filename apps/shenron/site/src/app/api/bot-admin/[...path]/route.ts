/**
 * Proxy générique /api/bot-admin/* → shenron bot REST API (Bearer).
 * Sécurise le SHENRON_ADMIN_TOKEN côté server (jamais leak au browser).
 * Refuse l'accès sans session admin (Better Auth + DB User.roleAdmin).
 * Stream les Server-Sent Events sans bufferiser (Content-Type: text/event-stream).
 */
import { isCurrentUserAdmin } from "@/lib/session";
import { env } from "@/lib/env";
import { API_URL as API } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";

const TOKEN = env.SHENRON_ADMIN_TOKEN ?? "";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
	if (!(await isCurrentUserAdmin())) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
	const { path } = await ctx.params;
	// Durcissement défense-en-profondeur : refuse toute traversée de chemin
	// (`..`, `.`, séparateurs) qui sortirait du préfixe `/api/` de l'hôte bot.
	if (path.some((s) => s === ".." || s === "." || s.includes("/") || s.includes("\\"))) {
		return NextResponse.json({ error: "invalid path" }, { status: 400 });
	}
	const url = `${API}/api/${path.join("/")}${req.nextUrl.search}`;
	const body =
		req.method === "GET" || req.method === "HEAD"
			? undefined
			: await req.text().catch(() => undefined);

	const accept = req.headers.get("accept") ?? "application/json";
	const res = await fetch(url, {
		method: req.method,
		body,
		headers: {
			authorization: `Bearer ${TOKEN}`,
			"content-type": req.headers.get("content-type") ?? "application/json",
			accept,
		},
		cache: "no-store",
		signal: req.signal,
	});

	const ct = res.headers.get("content-type") ?? "application/json";

	// SSE / streaming : forward le body tel quel, headers no-buffer
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
	// brut + préserve le Cache-Control (le canvas met en cache 60 s côté bot).
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
