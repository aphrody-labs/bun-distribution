#!/usr/bin/env bun
/**
 * Helper OVH API (zone DNS) — signe et appelle l'API OVH depuis ~/.ovh.conf.
 * Usage :
 *   bun scripts/ops/ovh-dns.ts get  /domain/zone/dragonballfr.com/record?fieldType=A
 *   bun scripts/ops/ovh-dns.ts put  /domain/zone/dragonballfr.com/record/123 '{"target":"51.255.162.6"}'
 *   bun scripts/ops/ovh-dns.ts post /domain/zone/dragonballfr.com/refresh
 *   bun scripts/ops/ovh-dns.ts records dragonballfr.com A   # raccourci liste détaillée
 *   bun scripts/ops/ovh-dns.ts setA dragonballfr.com <ip>   # met TOUS les A de la racine + www
 *   bun scripts/ops/ovh-dns.ts delete rosegriffon.fr <id>   # supprime un enregistrement + refresh
 * Lit les identifiants OVH dans ~/.ovh.conf (format lib `ovh` : application_key/secret/consumer_key).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const ENDPOINTS: Record<string, string> = {
	"ovh-eu": "https://eu.api.ovh.com/1.0",
	"ovh-ca": "https://ca.api.ovh.com/1.0",
	"ovh-us": "https://api.us.ovhcloud.com/1.0",
};

function loadConf() {
	const raw = readFileSync(process.env.OVH_CONF || `${homedir()}/.ovh.conf`, "utf8");
	const get = (k: string) => raw.match(new RegExp(`^\\s*${k}\\s*=\\s*(.+)\\s*$`, "m"))?.[1]?.trim();
	const endpointName = get("endpoint") || "ovh-eu";
	return {
		base: ENDPOINTS[endpointName] ?? ENDPOINTS["ovh-eu"],
		ak: get("application_key")!,
		as: get("application_secret")!,
		ck: get("consumer_key")!,
	};
}

const conf = loadConf();

async function ovhTime(): Promise<number> {
	const r = await fetch(`${conf.base}/auth/time`);
	return Number(await r.text());
}

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
	const url = `${conf.base}${path}`;
	const bodyStr = body === undefined ? "" : JSON.stringify(body);
	const ts = await ovhTime();
	const toSign = `${conf.as}+${conf.ck}+${method}+${url}+${bodyStr}+${ts}`;
	const sig = "$1$" + createHash("sha1").update(toSign).digest("hex");
	const headers: Record<string, string> = {
		"X-Ovh-Application": conf.ak,
		"X-Ovh-Consumer": conf.ck,
		"X-Ovh-Timestamp": String(ts),
		"X-Ovh-Signature": sig,
	};
	if (bodyStr) headers["Content-Type"] = "application/json";
	const r = await fetch(url, { method, headers, body: bodyStr || undefined });
	const text = await r.text();
	if (!r.ok) throw new Error(`OVH ${method} ${path} -> ${r.status}: ${text}`);
	return text ? JSON.parse(text) : null;
}

async function listRecords(zone: string, fieldType?: string) {
	const q = fieldType ? `?fieldType=${fieldType}` : "";
	const ids = (await call("GET", `/domain/zone/${zone}/record${q}`)) as number[];
	const out: { id: number; subDomain: string; fieldType: string; target: string; ttl: number }[] =
		[];
	for (const id of ids) {
		const rec = (await call("GET", `/domain/zone/${zone}/record/${id}`)) as {
			id: number;
			subDomain: string;
			fieldType: string;
			target: string;
			ttl: number;
		};
		out.push(rec);
	}
	return out;
}

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === "get") {
	console.log(JSON.stringify(await call("GET", rest[0]), null, 2));
} else if (cmd === "put") {
	console.log(JSON.stringify(await call("PUT", rest[0], JSON.parse(rest[1])), null, 2));
} else if (cmd === "post") {
	console.log(
		JSON.stringify(await call("POST", rest[0], rest[1] ? JSON.parse(rest[1]) : undefined), null, 2)
	);
} else if (cmd === "delete") {
	// Supprime un enregistrement par id puis rafraîchit la zone.
	const [zone, id] = rest;
	if (!zone || !/^\d+$/.test(id ?? "")) throw new Error("usage: delete <zone> <recordId>");
	console.log(JSON.stringify(await call("GET", `/domain/zone/${zone}/record/${id}`)));
	await call("DELETE", `/domain/zone/${zone}/record/${id}`);
	await call("POST", `/domain/zone/${zone}/refresh`);
	console.log(`supprimé ${zone}#${id}`);
} else if (cmd === "records") {
	const recs = await listRecords(rest[0], rest[1]);
	for (const r of recs)
		console.log(
			`#${r.id}  ${(r.subDomain || "@").padEnd(8)} ${r.fieldType.padEnd(6)} ttl=${String(r.ttl).padEnd(6)} -> ${r.target}`
		);
} else if (cmd === "setA") {
	// Bascule TOUS les A (racine "@" + "www") d'une zone vers une nouvelle IP, puis refresh.
	const zone = rest[0];
	const ip = rest[1];
	if (!ip) throw new Error("usage: setA <zone> <ip>");
	const recs = await listRecords(zone, "A");
	for (const r of recs) {
		if (r.subDomain === "" || r.subDomain === "www") {
			await call("PUT", `/domain/zone/${zone}/record/${r.id}`, { target: ip });
			console.log(`updated #${r.id} ${r.subDomain || "@"} A -> ${ip}`);
		}
	}
	await call("POST", `/domain/zone/${zone}/refresh`);
	console.log("zone refreshed");
} else {
	console.error("commands: get|put|post|delete|records|setA");
	process.exit(2);
}
