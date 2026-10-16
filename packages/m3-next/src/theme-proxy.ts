// SPDX-License-Identifier: Apache-2.0
// proxy.ts for Next 16 (the file convention that replaces middleware.ts). The M3 part: make sure every request
// carries a valid theme cookie, so Server Components that read it (M3Html) and the client provider agree from the first
// byte. Import this entry only from `proxy.ts`: it needs `next/server` and nothing heavier (no colour engine).
//
//   // proxy.ts
//   import { createM3Proxy } from "@aphrody/m3-next/proxy";
//   export const proxy = createM3Proxy();
//   // `matcher` must be a literal (Next parses it at compile time, so it cannot be imported). Pages only:
//   export const config = { matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"] };
import { NextResponse, type NextRequest } from "next/server";
import {
  M3_THEME_COOKIE,
  M3_THEME_COOKIE_MAX_AGE,
  parseThemeMode,
  validateThemeCookieName,
  type M3ThemeMode,
} from "./constants";

export interface M3ProxyOptions {
  /** Cookie that stores the preference (default `m3-theme`). */
  cookieName?: string;
  /** Mode written when the cookie is absent or invalid (default `system`). */
  defaultMode?: M3ThemeMode;
}

/**
 * The proxy function: a request with a valid theme cookie passes through untouched; a request without one (or with an
 * invalid value) is forwarded with the default mode in its `cookie` header, so the server render of the same request sees
 * it, and the response sets the cookie for the next one.
 */
export function createM3Proxy(
  options: M3ProxyOptions = {},
): (request: NextRequest) => NextResponse {
  const { cookieName = M3_THEME_COOKIE, defaultMode = "system" } = options;
  validateThemeCookieName(cookieName);
  return (request) => {
    const current = request.cookies.get(cookieName)?.value;
    const mode = parseThemeMode(current, defaultMode);
    if (current === mode) return NextResponse.next();

    const headers = new Headers(request.headers);
    const others = (headers.get("cookie") ?? "")
      .split(/;\s*/)
      .filter((cookie) => cookie !== "" && !cookie.startsWith(`${cookieName}=`));
    headers.set("cookie", [...others, `${cookieName}=${mode}`].join("; "));

    const response = NextResponse.next({ request: { headers } });
    response.cookies.set({
      name: cookieName,
      value: mode,
      path: "/",
      maxAge: M3_THEME_COOKIE_MAX_AGE,
      sameSite: "lax",
    });
    return response;
  };
}
