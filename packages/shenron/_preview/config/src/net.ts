// SPDX-License-Identifier: Apache-2.0
/**
 * Network guards shared by every `@shenron/*` package: the single loopback /
 * HTTPS URL doctrine (formerly copied in `compute.ts`, `shenron-embeddings.ts`,
 * `web.ts` and `ia-cockpit.ts`) and the client IP doctrine of
 * `apps/site/src/app/api/_client-ip.ts`.
 *
 * Runtime class: `pure` (only `URL` and `Headers`).
 */
import type { EnvIssue } from "./env";

/**
 * Exactly the loopback host forms accepted today by the Aphrody clients:
 * the IPv4 loopback literal, the bracketed IPv6 form produced by `URL`, the
 * bare IPv6 form produced by socket addresses, and `localhost`. The rest of
 * `127.0.0.0/8` is deliberately NOT accepted.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "[::1]", "::1", "localhost"]);

/** IPv4-mapped IPv6 form of the loopback literal reported by dual-stack sockets. */
const MAPPED_IPV4_LOOPBACK = "::ffff:127.0.0.1";

/** `true` for the loopback host forms listed in {@link LOOPBACK_HOSTS}, nothing else. */
export function isLoopbackHost(hostname: string): boolean {
	return LOOPBACK_HOSTS.has(hostname);
}

type UrlResult = { ok: true; url: URL } | { ok: false; issue: EnvIssue };

function parseUrl(raw: string | undefined, label: string): UrlResult {
	const value = typeof raw === "string" ? raw.trim() : "";
	if (value === "" || value === "undefined" || value === "null") {
		return { ok: false, issue: { name: label, problem: "missing" } };
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return {
			ok: false,
			issue: { name: label, problem: "invalid", hint: "not a valid absolute URL" },
		};
	}
	if (url.username || url.password) {
		return {
			ok: false,
			issue: { name: label, problem: "invalid", hint: "credentials are not allowed in the URL" },
		};
	}
	return { ok: true, url };
}

/**
 * Parses a private service URL that must be plain HTTP on a loopback host,
 * without credentials. Query string and fragment are stripped.
 */
export function parseLoopbackHttpUrl(raw: string | undefined, label: string): UrlResult {
	const parsed = parseUrl(raw, label);
	if (!parsed.ok) return parsed;
	const { url } = parsed;
	if (url.protocol !== "http:") {
		return {
			ok: false,
			issue: { name: label, problem: "invalid", hint: "must use http:// on a loopback host" },
		};
	}
	if (!isLoopbackHost(url.hostname)) {
		return {
			ok: false,
			issue: { name: label, problem: "invalid", hint: "must target a loopback host" },
		};
	}
	url.search = "";
	url.hash = "";
	return { ok: true, url };
}

/**
 * Parses a URL that must use HTTPS, or plain HTTP on a loopback host, without
 * credentials. Query string and fragment are stripped.
 */
export function parseHttpsOrLoopbackUrl(raw: string | undefined, label: string): UrlResult {
	const parsed = parseUrl(raw, label);
	if (!parsed.ok) return parsed;
	const { url } = parsed;
	const loopbackHttp = url.protocol === "http:" && isLoopbackHost(url.hostname);
	if (url.protocol !== "https:" && !loopbackHttp) {
		return {
			ok: false,
			issue: {
				name: label,
				problem: "invalid",
				hint: "must use https://, or http:// on a loopback host",
			},
		};
	}
	url.search = "";
	url.hash = "";
	return { ok: true, url };
}

/**
 * Client IP as nginx sees it: `x-real-ip` (set by nginx to the socket address,
 * not spoofable), else the LAST `X-Forwarded-For` hop (the one appended by the
 * front proxy; the leftmost hop is client-controlled), else `"unknown"`.
 * Same output as `apps/site/src/app/api/_client-ip.ts`.
 */
export function clientIpFromHeaders(headers: Headers): string {
	const realIp = headers.get("x-real-ip")?.trim();
	if (realIp) return realIp;
	const xff = headers.get("x-forwarded-for");
	if (xff) {
		const parts = xff
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean);
		const last = parts[parts.length - 1];
		if (last) return last;
	}
	return "unknown";
}

/**
 * `true` for a direct loopback caller: the socket address is loopback (the
 * forms of {@link isLoopbackHost}, plus the IPv4-mapped `::ffff:127.0.0.1`
 * reported by dual-stack listeners) AND the request carries neither
 * `x-real-ip` nor `x-forwarded-for` (a proxied request is never "direct").
 */
export function isDirectLoopback(
	headers: Headers,
	remoteAddress: string | null | undefined
): boolean {
	if (!remoteAddress) return false;
	if (!isLoopbackHost(remoteAddress) && remoteAddress !== MAPPED_IPV4_LOOPBACK) return false;
	return !headers.has("x-real-ip") && !headers.has("x-forwarded-for");
}
