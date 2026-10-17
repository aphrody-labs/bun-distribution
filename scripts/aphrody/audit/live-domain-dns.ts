#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Read-only DNS parity audit: declared records vs each authoritative nameserver set. No credentials, no provider writes. */
import { promises as dns } from "node:dns";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Record = {
  name: string;
  type: string;
  ttl: number;
  content?: string;
  priority?: number;
  data?: { priority: number; weight: number; port: number; target: string };
  proxied?: boolean;
};
type Declared = {
  registrar?: { nameServers: string[] };
  dns: {
    zone: string;
    zoneId: string;
    nameServers: string[];
    records: Record[];
  };
  applications?: { id: string; hostname: string; alias: string }[];
  productDomains?: { id: string; hostname: string; owner: string }[];
  worker?: {
    owner: string;
    name: string;
    routes: string[];
    customDomains: string[];
  };
};

const path = process.argv[2] ?? "tools/config/cloudflare/aphrody.com.json";
const manifestPath = resolve(path);
const declared: Declared = JSON.parse(await Bun.file(manifestPath).text());
if (declared.applications) {
  const aphrodyRoot = resolve(dirname(manifestPath), "../../..");
  const bunOsRoot = resolve(aphrodyRoot, "../bun-os");
  const capabilitiesPath = join(bunOsRoot, "packages/bun-workspace/src/capabilities.ts");
  const configPath = join(bunOsRoot, "aphrody.config.json");
  const distributionAppsPath = join(bunOsRoot, "infra/apps.json");
  if (!(await Bun.file(capabilitiesPath).exists())) throw new Error("Bun OS capability owner is unavailable");
  const capabilities = await import(pathToFileURL(capabilitiesPath).href);
  const config = JSON.parse(await Bun.file(configPath).text());
  const expectedApplications = capabilities.appCapabilities(config).map((app: { id: string; libraryId: string }) => {
    const hostname = capabilities.appHostname(app.id, config);
    const alias = capabilities.appHostnamesForLibrary(app.libraryId, config).find((host: string) => host !== hostname);
    if (!alias) throw new Error(`Application alias missing for ${app.id}`);
    return { id: app.id, hostname, alias };
  });
  if (JSON.stringify(declared.applications) !== JSON.stringify(expectedApplications))
    throw new Error("Application hostnames differ from the Bun OS capability owner");

  const distributionApps = JSON.parse(await Bun.file(distributionAppsPath).text()).apps as {
    id: string;
    hostname?: string;
  }[];
  const expectedProductDomains = distributionApps
    .filter(app => app.hostname)
    .map(app => ({ id: app.id, hostname: app.hostname, owner: "bun-os" }));
  const actualProductDomains = (declared.productDomains ?? []).filter(domain => domain.owner === "bun-os");
  if (JSON.stringify(actualProductDomains) !== JSON.stringify(expectedProductDomains))
    throw new Error("Product hostnames differ from the Bun OS distribution owner");

  const expectedRoutes = expectedApplications.map((app: { hostname: string }) => `${app.hostname}/*`);
  if (JSON.stringify(declared.worker?.routes?.toSorted()) !== JSON.stringify(expectedRoutes.toSorted()))
    throw new Error("Worker routes differ from the application hostnames");
  const expectedCustomDomains = [
    declared.dns.zone,
    `www.${declared.dns.zone}`,
    ...expectedApplications.map((app: { alias: string }) => app.alias),
    ...expectedProductDomains.map(app => app.hostname),
  ];
  if (JSON.stringify(declared.worker?.customDomains?.toSorted()) !== JSON.stringify(expectedCustomDomains.toSorted()))
    throw new Error("Worker custom domains differ from product and application hostnames");

  const workerConfigPath = resolve(aphrodyRoot, "../bun/packages/web/cloudflare/wrangler.jsonc");
  if (!(await Bun.file(workerConfigPath).exists())) throw new Error("Bun Worker configuration is unavailable");
  const workerConfig = Bun.JSONC.parse(await Bun.file(workerConfigPath).text()) as {
    name: string;
    routes: { pattern: string; custom_domain?: boolean; zone_id?: string }[];
  };
  if (workerConfig.name !== declared.worker?.name) throw new Error("Bun Worker name differs from the domain owner");
  const configuredRoutes = workerConfig.routes.filter((route: { custom_domain?: boolean }) => !route.custom_domain);
  const configuredCustomDomains = workerConfig.routes
    .filter((route: { custom_domain?: boolean }) => route.custom_domain)
    .map((route: { pattern: string }) => route.pattern);
  const expectedConfiguredRoutes = expectedRoutes.map((pattern: string) => `${pattern}:${declared.dns.zoneId}`);
  const actualConfiguredRoutes = configuredRoutes.map(
    (route: { pattern: string; zone_id?: string }) => `${route.pattern}:${route.zone_id}`,
  );
  if (JSON.stringify(actualConfiguredRoutes.toSorted()) !== JSON.stringify(expectedConfiguredRoutes.toSorted()))
    throw new Error("Bun Worker routes differ from the Aphrody Infra domain contract");
  const expectedCustomDomainSet = new Set(expectedCustomDomains);
  const configuredCustomDomainSet = new Set(configuredCustomDomains);
  const missingCustomDomains = expectedCustomDomains.filter(hostname => !configuredCustomDomainSet.has(hostname));
  const unexpectedCustomDomains = configuredCustomDomains.filter(hostname => !expectedCustomDomainSet.has(hostname));
  if (missingCustomDomains.length || unexpectedCustomDomains.length)
    throw new Error(
      [
        "Bun Worker custom domains differ from the Aphrody Infra domain contract.",
        missingCustomDomains.length ? `Missing: ${missingCustomDomains.toSorted().join(", ")}` : undefined,
        unexpectedCustomDomains.length ? `Unexpected: ${unexpectedCustomDomains.toSorted().join(", ")}` : undefined,
      ]
        .filter(Boolean)
        .join(" "),
    );
  console.log(
    `source owners: ${expectedApplications.length} Bun OS capabilities, ${expectedProductDomains.length} Bun OS product domains, ${workerConfig.routes.length} Bun Worker routes`,
  );
}
const strip = (v: string) => v.replace(/\.$/, "");
const sorted = (xs: unknown[]) => JSON.stringify(xs.map(x => JSON.stringify(x)).toSorted());

// Canonical value per (name,type) group, matching the shape produced by `answer()`.
const groups = new Map<string, Record[]>();
for (const r of declared.dns.records) {
  const key = `${r.name}\u0000${r.type}`;
  groups.set(key, [...(groups.get(key) ?? []), r]);
}
const expectedOf = (rs: Record[]): string => {
  const type = rs[0]!.type;
  if (type === "MX") return sorted(rs.map(r => [r.priority, strip(r.content!)]));
  if (type === "SRV")
    return sorted(rs.map(r => [r.data!.priority, r.data!.weight, r.data!.port, strip(r.data!.target)]));
  if (type === "TXT") return sorted(rs.map(r => r.content!));
  return sorted(rs.map(r => strip(r.content!)));
};
const answer = (type: string, a: any[]): string => {
  if (type === "MX") return sorted(a.map(x => [x.priority, strip(x.exchange)]));
  if (type === "SRV") return sorted(a.map(x => [x.priority, x.weight, x.port, strip(x.name)]));
  if (type === "TXT") return sorted(a.map(x => x.join("")));
  return sorted(a.map(x => strip(String(x))));
};

const serversOf = async (hosts: string[]) => (await Promise.all(hosts.map(h => dns.resolve4(h)))).flat();
const query = async (server: string, name: string, type: string): Promise<string> => {
  const r = new dns.Resolver();
  r.setServers([server]);
  try {
    return answer(type, await r.resolve(name, type as any));
  } catch (e: any) {
    return `ERR:${e.code}`;
  }
};

const sets = {
  ...(declared.registrar ? { registrar: declared.registrar.nameServers } : {}),
  cloudflare: declared.dns.nameServers,
};
const live = (await dns.resolveNs(declared.dns.zone).catch(() => [] as string[])).toSorted().join(",");
const is = (s: string[]) => s.toSorted().join(",") === live;
const delegation = is(sets.cloudflare)
  ? "cloudflare"
  : declared.registrar && is(sets.registrar ?? [])
    ? "registrar"
    : `unknown(${live || "none"})`;
console.log(`delegation (system resolver): ${delegation}`);

const checks = await Promise.all(
  Object.entries(sets)
    .filter(
      ([, hosts]) => hosts.toSorted().join(",") !== declared.dns.nameServers.toSorted().join(",") || !sets.registrar,
    )
    .map(async ([label, hosts]) => {
      const servers = await serversOf(hosts);
      const diffsOf = await Promise.all(
        [...groups].map(async ([key, rs]) => {
          const [name = "", type = ""] = key.split("\u0000");
          const proxied = rs.every(record => record.proxied);
          const want = proxied ? "proxied DNS answer" : expectedOf(rs);
          const got = await Promise.all(
            servers.map(s => (proxied ? query(s, name, type === "CNAME" ? "A" : type) : query(s, name, type))),
          );
          const bad = got.filter(g => (proxied ? g.startsWith("ERR:") : g !== want));
          return bad.length ? `DIFF ${label} ${type} ${name} want=${want} got=${bad.join(" | ")}` : null;
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
