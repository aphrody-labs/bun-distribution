import { getCurrentUser } from "@/lib/session";
import { NextResponse } from "next/server";

// Endpoint léger pour l'état d'auth côté client (nav). Volontairement isolé du
// rendu des pages : il lit la session (cookies) ici, ce qui permet au layout +
// aux pages publiques de rester statiques/ISR (cacheables CDN) au lieu d'être
// rendus dynamiquement à chaque requête juste pour afficher l'avatar de la nav.
export const dynamic = "force-dynamic";

export async function GET() {
	const me = await getCurrentUser();
	return NextResponse.json(
		{
			authenticated: Boolean(me),
			username: me?.user?.username ?? null,
			avatar: me?.user?.avatar ?? null,
			isAdmin: me?.user?.roleAdmin === true,
		},
		{ headers: { "Cache-Control": "private, no-store" } }
	);
}
