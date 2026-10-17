import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PATHS = ["/dashboard", "/admin", "/profil/settings"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PATHS.some(p => pathname.startsWith(p));
  if (!isProtected) {
    return NextResponse.next();
  }

  // 2. Optimistic Auth Check
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// Le proxy ne garde que les espaces protégés : sur Vercel, chaque requête qui
// le traverse est une invocation facturée AVANT le cache CDN. Un matcher large
// (toutes les pages) doublait les invocations du site et empêchait une page ISR
// d'être servie sans exécuter de code. La garde reste optimiste : les pages
// protégées revérifient la session côté serveur.
export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/profil/settings/:path*"],
};
