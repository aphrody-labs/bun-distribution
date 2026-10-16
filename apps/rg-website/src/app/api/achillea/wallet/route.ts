import { NextResponse } from "next/server";

import { getServerSession } from "@/lib/auth-helpers";
import { getPgPool } from "@/lib/db/pg";

/**
 * Portefeuille servi directement depuis la base fusionnée.
 *
 * Ces lectures ne dépendent d'aucun état Discord : le compte RG, son
 * identifiant Discord et le grand livre Achilléa sont dans le même Postgres.
 * Cette route reste donc disponible si l'API/bot Achilléa est indisponible.
 */
interface LigneTransaction {
	id: string;
	type: "Credit" | "Debit" | "Transfer" | "Payout" | "Fine";
	amount: string;
	reason: string | null;
	created_at: Date;
	to_user_id: string | null;
	from_user_id: string | null;
}

export async function GET() {
	const session = await getServerSession();
	if (!session?.user) {
		return NextResponse.json({ error: "non_authentifie" }, { status: 401 });
	}

	try {
		const pool = getPgPool();
		const compte = await pool.query<{ discord_id: string }>(
			`SELECT account_id AS discord_id
			   FROM public.account
			  WHERE user_id = $1 AND provider_id = 'discord'
			  LIMIT 1`,
			[session.user.id]
		);
		const discordId = compte.rows[0]?.discord_id;
		if (!discordId) {
			return NextResponse.json({ error: "discord_non_lie" }, { status: 409 });
		}

		const [portefeuille, mouvements] = await Promise.all([
			pool.query<{ balance: string; currency: string }>(
				`SELECT balance, currency FROM achillea.wallet WHERE user_id = $1 LIMIT 1`,
				[discordId]
			),
			pool.query<LigneTransaction>(
				`SELECT id::text, type, amount, reason, created_at, to_user_id, from_user_id
				   FROM achillea."transaction"
				  WHERE to_user_id = $1 OR from_user_id = $1
				  ORDER BY created_at DESC
				  LIMIT 50`,
				[discordId]
			),
		]);

		return NextResponse.json({
			balance: {
				balance: Number(portefeuille.rows[0]?.balance ?? 0),
				currency: portefeuille.rows[0]?.currency ?? "ACH",
			},
			transactions: mouvements.rows.map((mouvement) => ({
				id: mouvement.id,
				type: mouvement.type,
				amount: Number(mouvement.amount),
				reason: mouvement.reason,
				direction: mouvement.to_user_id === discordId ? "in" : "out",
				createdAt: mouvement.created_at.toISOString(),
			})),
		});
	} catch (error) {
		console.error("[api/achillea/wallet] lecture directe impossible", error);
		return NextResponse.json({ error: "base_de_donnees_indisponible" }, { status: 503 });
	}
}
