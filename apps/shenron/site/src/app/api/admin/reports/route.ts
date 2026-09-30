import { NextRequest, NextResponse } from "next/server";
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { siteReports, wikiRevisions } from "@/db/schema";
import { adminUserOrToken, isAdminOrToken } from "@/lib/admin-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reports — Liste les signalements avec filtres et compteurs par statut.
 * Les signalements supprimés logiquement (visible: false) sont toujours exclus.
 */
export async function GET(req: NextRequest) {
	if (!(await isAdminOrToken(req))) {
		return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
	}

	const url = req.nextUrl;
	const statusFilter = url.searchParams.get("status") ?? "open";

	const [allRows, countRows] = await Promise.all([
		db
			.select()
			.from(siteReports)
			.where(
				statusFilter === "all"
					? eq(siteReports.visible, true)
					: and(eq(siteReports.visible, true), eq(siteReports.status, statusFilter))
			)
			.orderBy(desc(siteReports.createdAt)),
		db
			.select({
				status: siteReports.status,
				total: count(),
			})
			.from(siteReports)
			.where(eq(siteReports.visible, true))
			.groupBy(siteReports.status),
	]);

	const counts: Record<string, number> = {
		open: 0,
		in_progress: 0,
		resolved: 0,
		closed: 0,
		all: 0,
	};

	let grandTotal = 0;
	for (const row of countRows) {
		const n = Number(row.total);
		counts[row.status] = n;
		grandTotal += n;
	}
	counts.all = grandTotal;

	return NextResponse.json({
		ok: true,
		items: allRows,
		counts,
	});
}

/**
 * PATCH /api/admin/reports — Mise à jour d'un signalement :
 * - statut, note interne, résolution
 * - bascule de visibilité (suppression / restauration logique) avec historique wikiRevisions
 */
export async function PATCH(req: NextRequest) {
	const { allowed, me } = await adminUserOrToken(req);
	if (!allowed) {
		return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
	}

	const body = await req.json();
	const id = String(body.id ?? "");
	if (!id) {
		return NextResponse.json({ error: "Identifiant manquant" }, { status: 400 });
	}

	if (typeof body.visible === "boolean") {
		const updated = await db.transaction(async (tx) => {
			const [before] = await tx
				.select()
				.from(siteReports)
				.where(eq(siteReports.id, id))
				.limit(1);
			if (!before) return null;

			const [after] = await tx
				.update(siteReports)
				.set({
					visible: body.visible,
					updatedAt: new Date(),
				})
				.where(eq(siteReports.id, id))
				.returning();

			await tx.insert(wikiRevisions).values({
				tableName: "site_reports",
				rowId: id,
				action: "visibility",
				label: (before.message ?? id).slice(0, 200),
				before,
				after: after ?? { ...before, visible: body.visible },
				editorId: me?.user?.id ?? "token-admin",
				editorName: me?.user?.username ?? "Admin",
			});

			return after ?? { ...before, visible: body.visible };
		});

		if (!updated) {
			return NextResponse.json({ error: "Signalement introuvable" }, { status: 404 });
		}
		return NextResponse.json({ ok: true, report: updated });
	}

	const updatePayload: Record<string, unknown> = {
		updatedAt: new Date(),
	};
	if (typeof body.status === "string") updatePayload.status = body.status;
	if (typeof body.adminNote === "string") updatePayload.adminNote = body.adminNote;
	if (body.status === "resolved") {
		updatePayload.resolvedBy = me?.user?.username ?? "Admin";
		updatePayload.resolvedAt = new Date();
	}

	const [updated] = await db
		.update(siteReports)
		.set(updatePayload)
		.where(eq(siteReports.id, id))
		.returning();

	if (!updated) {
		return NextResponse.json({ error: "Signalement introuvable" }, { status: 404 });
	}
	return NextResponse.json({ ok: true, report: updated });
}

/**
 * DELETE /api/admin/reports?id=... — Suppression logique d'un signalement.
 * Ne supprime JAMAIS physiquement : passe visible à false et consigne dans wikiRevisions.
 */
export async function DELETE(req: NextRequest) {
	const { allowed, me } = await adminUserOrToken(req);
	if (!allowed) {
		return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
	}

	const id = req.nextUrl.searchParams.get("id");
	if (!id) {
		return NextResponse.json({ error: "Identifiant manquant" }, { status: 400 });
	}

	const ok = await db.transaction(async (tx) => {
		const [before] = await tx
			.select()
			.from(siteReports)
			.where(eq(siteReports.id, id))
			.limit(1);
		if (!before) return false;

		const [after] = await tx
			.update(siteReports)
			.set({
				visible: false,
				updatedAt: new Date(),
			})
			.where(eq(siteReports.id, id))
			.returning();

		await tx.insert(wikiRevisions).values({
			tableName: "site_reports",
			rowId: id,
			action: "visibility",
			label: (before.message ?? id).slice(0, 200),
			before,
			after: after ?? { ...before, visible: false },
			editorId: me?.user?.id ?? "token-admin",
			editorName: me?.user?.username ?? "Admin",
		});

		return true;
	});

	if (!ok) {
		return NextResponse.json({ error: "Signalement introuvable" }, { status: 404 });
	}
	return NextResponse.json({ ok: true });
}
