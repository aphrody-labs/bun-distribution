/**
 * /api/admin/wiki-contributions — modération des propositions communautaires.
 *
 *   GET  ?status&table&limit&offset → { rows, total, counts }
 *   POST { id, action: "accept" | "reject", note? }
 *
 * Gate admin. « accept » applique la valeur au wiki par le chemin normal
 * (`updateWiki` + révision au nom du CONTRIBUTEUR), donc annulable depuis
 * /admin/wiki/history comme n'importe quelle édition.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isCurrentUserAdmin } from "@/lib/session";
import type { RevisionActor } from "@/lib/wiki-revisions";
import {
	acceptContribution,
	ContributionError,
	countByStatus,
	listContributions,
	rejectContribution,
} from "@/lib/wiki-contributions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forbidden = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });

async function currentActor(): Promise<RevisionActor> {
	try {
		const me = await getCurrentUser();
		if (!me?.user) return null;
		return { id: me.user.id ?? null, name: me.user.username ?? null };
	} catch {
		return null;
	}
}

export async function GET(req: NextRequest): Promise<NextResponse> {
	if (!(await isCurrentUserAdmin())) return forbidden();
	const sp = req.nextUrl.searchParams;
	const [result, counts] = await Promise.all([
		listContributions({
			status: sp.get("status") ?? undefined,
			table: sp.get("table") ?? undefined,
			limit: Number(sp.get("limit")) || 50,
			offset: Number(sp.get("offset")) || 0,
		}),
		countByStatus(),
	]);
	return NextResponse.json({ ...result, counts });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
	if (!(await isCurrentUserAdmin())) return forbidden();

	let body: { id?: string; action?: string; note?: string };
	try {
		body = await req.json();
	} catch {
		return NextResponse.json({ error: "bad_request" }, { status: 400 });
	}
	if (!body.id || (body.action !== "accept" && body.action !== "reject")) {
		return NextResponse.json({ error: "bad_request" }, { status: 400 });
	}

	const actor = await currentActor();
	try {
		const contribution =
			body.action === "accept"
				? await acceptContribution(body.id, actor, body.note ?? null)
				: await rejectContribution(body.id, actor, body.note ?? null);
		return NextResponse.json({ ok: true, contribution });
	} catch (err) {
		if (err instanceof ContributionError) {
			return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
		}
		console.error("[contributions] moderation failed", err);
		return NextResponse.json({ error: "failed" }, { status: 500 });
	}
}
