// SPDX-License-Identifier: Apache-2.0
import { resolveSiteUrl, type PublicUrlEnv } from "./public-urls";

/** One authenticated web administration, including the historical bot entrypoints. */
export const ADMIN_ROUTES: Readonly<Record<string, string>> = {
  "/": "/admin/dashboard",
  "/login": "/admin-access",
  "/profile": "/admin/account",
  "/webhooks": "/admin/webhooks",
  "/bot": "/admin/bot",
  "/cron": "/admin/cron",
  "/services": "/admin/services",
  "/database": "/admin/database",
  "/database/:table": "/admin/database/:table",
  "/database/:table/:id": "/admin/database/:table?q=:id",
  "/stats": "/admin/stats",
  "/audit": "/admin/audit",
  "/moderation": "/admin/moderation",
  "/hierarchy": "/admin/hierarchy",
  "/tickets": "/admin/tickets",
  "/shop": "/admin/shop",
  "/triggers": "/admin/triggers",
  "/commands": "/admin/commands",
  "/audit-internal": "/admin/audit-internal",
  "/levels": "/admin/levels",
  "/economy": "/admin/economy",
  "/giveaways": "/admin/giveaways",
  "/messages": "/admin/messages",
  "/canvas": "/admin/canvas",
  "/logs": "/admin/logs",
  "/settings": "/admin/settings",
};

export function adminUrl(env: PublicUrlEnv = {}, path = "/admin/dashboard"): string {
  const origin = new URL(resolveSiteUrl(env));
  if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password)
    throw new Error("Administration requires an HTTP(S) origin without credentials");
  if (!/^\/admin(?:[/-]|$)/.test(path) || path.includes("\\"))
    throw new Error("Invalid administration path");
  const target = new URL(path, origin);
  if (!/^\/admin(?:[/-]|$)/.test(target.pathname)) throw new Error("Invalid administration path");
  return target.toString();
}

/** No query parameters, credentials or fragment cross the old dashboard boundary. */
export function dashboardRedirect(request: Request, env: PublicUrlEnv = {}): Response {
  const pathname = new URL(request.url).pathname;
  let path = ADMIN_ROUTES[pathname];
  const database = /^\/database\/([^/]+)(?:\/([^/]+))?$/.exec(pathname);
  if (!path && database)
    path = `/admin/database/${database[1]}${database[2] ? `?q=${database[2]}` : ""}`;
  if (!path) return new Response("Not found", { status: 404 });
  return new Response(null, {
    status: 303,
    headers: {
      Location: adminUrl(env, path),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
