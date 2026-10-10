#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Read-only DNS parity audit: declared records vs each authoritative nameserver set. No credentials, no provider writes. */
import { promises as dns } from "node:dns";

type Record = {
  name: string;
  type: string;
  ttl: number;
  content?: string;
  priority?: number;
  data?: { priority: number; weight: number; port: number; target: string };
};
type Declared = {
  registrar: { nameServers: string[] };
  dns: { zone: string; nameServers: string[]; records: Record[] };
};

const path = process.argv[2] ?? "tools/config/cloudflare/aphrody.com.json";
const declared: Declared = JSON.parse(await Bun.file(path).text());
const strip = (v: string) => v.replace(/\.$/, "");
const sorted = (xs: unknown[]) => JSON.stringify(xs.map((x) => JSON.stringify(x)).toSorted());

// Canonical value per (name,type) group, matching the shape produced by `answer()`.
const groups = new Map<string, Record[]>();
for (const r of declared.dns.records) {
  const key = `${r.name}\u0000${r.type}`;
  groups.set(key, [...(groups.get(key) ?? []), r]);
}
const expectedOf = (rs: Record[]): string => {
  const type = rs[0]!.type;
  if (type === "MX") return sorted(rs.map((r) => [r.priority, strip(r.content!)]));
  if (type === "SRV")
    return sorted(
      rs.map((r) => [r.data!.priority, r.data!.weight, r.data!.port, strip(r.data!.target)]),
    );
  if (type === "TXT") return sorted(rs.map((r) => r.content!));
  return sorted(rs.map((r) => strip(r.content!)));
};
const answer = (type: string, a: any[]): string => {
  if (type === "MX") return sorted(a.map((x) => [x.priority, strip(x.exchange)]));
  if (type === "SRV") return sorted(a.map((x) => [x.priority, x.weight, x.port, strip(x.name)]));
  if (type === "TXT") return sorted(a.map((x) => x.join("")));
  return sorted(a.map((x) => strip(String(x))));
};

const serversOf = async (hosts: string[]) =>
  (await Promise.all(hosts.map((h) => dns.resolve4(h)))).flat();
const query = async (server: string, name: string, type: string): Promise<string> => {
  const r = new dns.Resolver();
  r.setServers([server]);
  try {
    return answer(type, await r.resolve(name, type as any));
  } catch (e: any) {
    return `ERR:${e.code}`;
  }
};

const sets = { registrar: declared.registrar.nameServers, cloudflare: declared.dns.nameServers };
const live = (await dns.resolveNs(declared.dns.zone).catch(() => [] as string[]))
  .toSorted()
  .join(",");
const is = (s: string[]) => s.toSorted().join(",") === live;
console.log(
  `delegation (system resolver): ${is(sets.cloudflare) ? "cloudflare" : is(sets.registrar) ? "registrar" : `unknown(${live || "none"})`}`,
);

const checks = await Promise.all(
  Object.entries(sets).map(async ([label, hosts]) => {
    const servers = await serversOf(hosts);
    const diffsOf = await Promise.all(
      [...groups].map(async ([key, rs]) => {
        const [name = "", type = ""] = key.split("\u0000");
        const want = expectedOf(rs);
        const got = await Promise.all(servers.map((s) => query(s, name, type)));
        const bad = got.filter((g) => g !== want);
        return bad.length
          ? `DIFF ${label} ${type} ${name} want=${want} got=${bad.join(" | ")}`
          : null;
      }),
    );
    console.log(`${label}: ${groups.size} record sets checked on ${servers.length} servers`);
    return diffsOf.filter((d): d is string => d !== null);
  }),
);
const diffLines = checks.flat();
for (const line of diffLines) console.log(line);
console.log(diffLines.length === 0 ? "0 diffs" : `${diffLines.length} diffs`);
process.exit(diffLines.length === 0 ? 0 : 1);
