import { NextResponse } from "next/server";

import { getServerUser } from "@/lib/auth-helpers";
import { refreshPatreonMembership } from "@/lib/patreon/sync";

/**
 * Force un re-sync de l'état Patreon de l'user courant.
 * Utilise le refresh token stocké si l'access est expiré.
 *
 * Idempotent — peut être spammé sans risque (rate-limit Better Auth global
 * via le plugin rateLimit côté auth.ts).
 */
export async function POST() {
  const user = await getServerUser();
  if (!user) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const result = await refreshPatreonMembership(user.id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason },
      { status: result.reason === "no_token" ? 404 : 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    patron_status: result.identity?.memberships[0]?.attrs.patron_status ?? null,
  });
}
