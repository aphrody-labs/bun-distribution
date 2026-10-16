import { NextResponse } from "next/server";

import { getServerUser } from "@/lib/auth-helpers";
import { getPatronDiscount } from "@/lib/patreon/discount";

/**
 * Expose l'état "patron actif → -20%" pour le user courant.
 *
 * Consommé par :
 *  - le panier / checkout Stripe (server action) pour décider d'injecter le coupon
 *  - le front (badge `Patron · -20%`, prix barré) sur les pages boutique
 *
 * Ne nécessite PAS de scope Patreon : la vérité vit dans `patreon_memberships`,
 * mise à jour par le callback OAuth + les webhooks `members:*`.
 */
export async function GET() {
	const user = await getServerUser();
	if (!user) {
		return NextResponse.json(
			{ active: false, percent: 0, reason: "not_authenticated" },
			{ status: 200 }
		);
	}
	try {
		const discount = await getPatronDiscount(user.id);
		return NextResponse.json(discount, {
			headers: { "cache-control": "private, max-age=60" },
		});
	} catch (error) {
		console.error("[patreon/discount] Erreur calcul remise:", error);
		return NextResponse.json(
			{ active: false, percent: 0, reason: "error" },
			{ status: 200 }
		);
	}
}
