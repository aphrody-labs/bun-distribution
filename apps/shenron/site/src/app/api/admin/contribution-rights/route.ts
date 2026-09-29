/**
 * /api/admin/contribution-rights — lecture et écriture du droit de
 * contribution (wiki / databooks). Réservé au staff.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isCurrentUserAdmin } from "@/lib/session";
import { getContributionRights, setContributionRights } from "@/lib/contribution-rights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function gate(): Promise<boolean> {
	return await isCurrentUserAdmin().catch(() => false);
}

export async function GET(): Promise<NextResponse> {
	if (!(await gate())) return NextResponse.json({ ok: false }, { status: 403 });
	return NextResponse.json({ ok: true, rights: await getContributionRights() });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
	if (!(await gate())) return NextResponse.json({ ok: false }, { status: 403 });
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
	}
	const session = await getCurrentUser().catch(() => null);
	// `sanitizeRights` filtre côté serveur : le formulaire peut envoyer
	// n'importe quoi, seules des valeurs connues et des identifiants au bon
	// format sont persistés.
	const rights = await setContributionRights(
		(body as { rights?: unknown })?.rights ?? body,
		session?.user?.id ?? null
	);
	return NextResponse.json({ ok: true, rights });
}
