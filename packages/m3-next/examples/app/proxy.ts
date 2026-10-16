// SPDX-License-Identifier: Apache-2.0
// Next 16's proxy.ts (it replaces middleware.ts): every page request carries a valid theme cookie, so the
// Server Component on /theme and the client provider agree from the first byte.
import { createM3Proxy } from "@aphrody/m3-next/proxy";

export const proxy = createM3Proxy();
// `matcher` is parsed at compile time: it must be a literal. Pages only: not /api, Next's static and image routes, or files.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
