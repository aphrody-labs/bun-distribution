import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { absoluteUrl } from "@/lib/site-url";

const PROTECTED_PATHS = ["/dashboard", "/settings"];
const API_PROTECTED_PATHS = ["/api/dashboard"];

export async function proxy(request: NextRequest) {
  // Le mode maintenance est servi par nginx (location @maintenance sur
  // 502/503/504), pas par l'application : rien à vérifier ici.

  const { pathname } = request.nextUrl;

  const isProtectedPage = PROTECTED_PATHS.some(p => pathname.startsWith(p));
  const isProtectedApi = API_PROTECTED_PATHS.some(p => pathname.startsWith(p));

  if (!isProtectedPage && !isProtectedApi) {
    return NextResponse.next();
  }

  // Quick guard: check cookie presence (full validation happens server-side in layouts/pages)
  const sessionCookie =
    request.cookies.get("better-auth.session_token") || request.cookies.get("__Secure-better-auth.session_token");

  if (!sessionCookie) {
    if (isProtectedApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const loginUrl = absoluteUrl("/login");
    loginUrl.searchParams.set("returnTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/settings/:path*", "/api/dashboard/:path*"],
};
