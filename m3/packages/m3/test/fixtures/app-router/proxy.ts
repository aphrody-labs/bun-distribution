import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/old") return NextResponse.redirect(new URL("/", request.url));
  const response = NextResponse.next();
  response.headers.set("x-fixture", "1");
  return response;
}

export const config = { matcher: ["/((?!api|_m3).*)"] };
