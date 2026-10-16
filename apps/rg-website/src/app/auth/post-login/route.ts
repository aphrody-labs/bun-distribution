import { NextResponse } from "next/server";

import { getServerUser } from "@/lib/auth-helpers";
import { safeReturnUrl } from "@rosegriffon/auth/redirect";

export const dynamic = "force-dynamic";

/** Résout la destination de la session Better Auth après connexion. */
export async function GET(request: Request) {
  const requested = safeReturnUrl(
    new URL(request.url).searchParams.get("returnTo"),
    "/profil",
  );
  const returnTo =
    new URL(requested, request.url).pathname === "/auth/post-login"
      ? "/profil"
      : requested;
  const user = await getServerUser();
  const destination = user
    ? returnTo
    : `/login?redirect=${encodeURIComponent(returnTo)}`;
  return NextResponse.redirect(new URL(destination, request.url), {
    status: 303,
    headers: { "Cache-Control": "private, no-store" },
  });
}
