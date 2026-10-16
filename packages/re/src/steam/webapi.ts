// SPDX-License-Identifier: Apache-2.0
/**
 * Steam Web API indexer: interfaces/methods/params (GetSupportedAPIList), the static endpoint
 * catalogue, the public app list (IStoreService) and store `appdetails`. The key is read from
 * `STEAM_WEB_API_KEY` only and is never stored.
 */
import type { Database } from "bun:sqlite";

const API = "https://api.steampowered.com";
const now = () => new Date().toISOString();

export const STATIC_ENDPOINTS: {
  id: string;
  kind: string;
  url: string;
  auth: string;
  description: string;
  params?: string;
}[] = [
  {
    id: "webapi.supported",
    kind: "webapi",
    url: `${API}/ISteamWebAPIUtil/GetSupportedAPIList/v1/`,
    auth: "none|key",
    description: "Lists every interface/method (full list needs a key)",
  },
  {
    id: "store.appdetails",
    kind: "store",
    url: "https://store.steampowered.com/api/appdetails?appids={appid}&cc={cc}&l={lang}",
    auth: "none",
    description: "Store metadata (~200 req / 5 min)",
    params: "appids,cc,l,filters",
  },
  {
    id: "store.appreviews",
    kind: "store",
    url: "https://store.steampowered.com/appreviews/{appid}?json=1",
    auth: "none",
    description: "Review summary",
  },
  {
    id: "store.applist",
    kind: "webapi",
    url: `${API}/IStoreService/GetAppList/v1/`,
    auth: "key",
    description: "Paged app list",
    params: "last_appid,max_results<=50000,include_games",
  },
  {
    id: "store.browse",
    kind: "webapi",
    url: `${API}/IStoreBrowseService/GetItems/v1/`,
    auth: "none|key",
    description: "Store items by id (input_json)",
  },
  {
    id: "stats.schema",
    kind: "webapi",
    url: `${API}/ISteamUserStats/GetSchemaForGame/v2/`,
    auth: "key",
    description: "Achievements and stats schema",
    params: "appid,l",
  },
  {
    id: "player.owned",
    kind: "webapi",
    url: `${API}/IPlayerService/GetOwnedGames/v1/`,
    auth: "key",
    description: "Owned games of a public profile",
    params: "steamid,include_appinfo",
  },
  {
    id: "pubfile.query",
    kind: "webapi",
    url: `${API}/IPublishedFileService/QueryFiles/v1/`,
    auth: "key",
    description: "Workshop query",
  },
  {
    id: "pubfile.details",
    kind: "webapi",
    url: `${API}/IPublishedFileService/GetDetails/v1/`,
    auth: "key",
    description: "Workshop item details",
  },
  {
    id: "openid.login",
    kind: "openid",
    url: "https://steamcommunity.com/openid/login",
    auth: "openid2",
    description: "Steam OpenID 2.0 relying-party endpoint",
  },
  {
    id: "cdn.manifest",
    kind: "cdn",
    url: "https://{cdn}/depot/{depot}/manifest/{gid}/5/{request_code}",
    auth: "cdn-token",
    description: "Depot manifest",
  },
  {
    id: "cdn.chunk",
    kind: "cdn",
    url: "https://{cdn}/depot/{depot}/chunk/{chunk_sha}",
    auth: "cdn-token",
    description: "Depot chunk (AES + LZMA/zstd)",
  },
];

export const webApiKey = (): string | undefined => process.env.STEAM_WEB_API_KEY || undefined;

const redact = (url: string) => url.replace(/key=[^&]+/, "key=***");

async function getJson(url: string): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (res.status === 429 || res.status >= 500) {
      await Bun.sleep(1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} ${redact(url)}`);
    return res.json();
  }
  throw new Error(`rate limited: ${redact(url)}`);
}

export interface ApiSyncResult {
  interfaces: number;
  methods: number;
  params: number;
  endpoints: number;
  withKey: boolean;
}

/** Fills api_interface / api_method / api_param / api_endpoint. */
export async function syncApiCatalog(db: Database): Promise<ApiSyncResult> {
  const key = webApiKey();
  const data = await getJson(
    `${API}/ISteamWebAPIUtil/GetSupportedAPIList/v1/${key ? `?key=${encodeURIComponent(key)}` : ""}`,
  );
  const interfaces: any[] = data?.apilist?.interfaces ?? [];
  const source = key ? "GetSupportedAPIList(key)" : "GetSupportedAPIList(anon)";
  const iface = db.prepare("INSERT OR REPLACE INTO api_interface(name,method_count,fetched_at,source) VALUES(?,?,?,?)");
  const meth = db.prepare(
    "INSERT OR REPLACE INTO api_method(interface,name,version,httpmethod,url,needs_key,param_count,description) VALUES(?,?,?,?,?,?,?,?)",
  );
  const param = db.prepare(
    "INSERT OR REPLACE INTO api_param(interface,method,version,name,type,optional,description) VALUES(?,?,?,?,?,?,?)",
  );
  const ep = db.prepare("INSERT OR REPLACE INTO api_endpoint(id,kind,url,auth,description,params) VALUES(?,?,?,?,?,?)");
  let methods = 0;
  let params = 0;
  db.transaction(() => {
    for (const i of interfaces) {
      iface.run(i.name, i.methods?.length ?? 0, now(), source);
      for (const m of i.methods ?? []) {
        methods++;
        const url = `${API}/${i.name}/${m.name}/v${m.version}/`;
        meth.run(
          i.name,
          m.name,
          m.version,
          m.httpmethod ?? "GET",
          url,
          m.needs_key ? 1 : 0,
          m.parameters?.length ?? 0,
          m.description ?? null,
        );
        for (const p of m.parameters ?? []) {
          params++;
          param.run(i.name, m.name, m.version, p.name, p.type ?? null, p.optional ? 1 : 0, p.description ?? null);
        }
        ep.run(
          `webapi.${i.name}.${m.name}.v${m.version}`,
          "webapi",
          url,
          m.needs_key ? "key" : "none",
          m.description ?? null,
          (m.parameters ?? []).map((p: any) => p.name).join(","),
        );
      }
    }
    for (const e of STATIC_ENDPOINTS) ep.run(e.id, e.kind, e.url, e.auth, e.description, e.params ?? null);
  })();
  return {
    interfaces: interfaces.length,
    methods,
    params,
    endpoints: methods + STATIC_ENDPOINTS.length,
    withKey: !!key,
  };
}

/** Pages IStoreService/GetAppList into `applist` (key required). */
export async function syncAppList(db: Database, maxPages = 20): Promise<number> {
  const key = webApiKey();
  if (!key) throw new Error("STEAM_WEB_API_KEY is required for IStoreService/GetAppList");
  const ins = db.prepare("INSERT OR REPLACE INTO applist(appid,name,fetched_at) VALUES(?,?,?)");
  let last = 0;
  let total = 0;
  for (let page = 0; page < maxPages; page++) {
    const r = await getJson(
      `${API}/IStoreService/GetAppList/v1/?key=${encodeURIComponent(key)}&last_appid=${last}&max_results=50000&include_games=true&include_dlc=true`,
    );
    const apps: { appid: number; name: string }[] = r?.response?.apps ?? [];
    db.transaction(() => {
      for (const a of apps) ins.run(a.appid, a.name, now());
    })();
    total += apps.length;
    if (!r?.response?.have_more_results) break;
    last = r.response.last_appid;
  }
  return total;
}

/** Fetches store `appdetails` for ids (one request each, spaced to stay under the rate limit). */
export async function syncStoreApps(db: Database, appids: number[], cc = "fr", lang = "french"): Promise<number> {
  const ins = db.prepare(
    `INSERT OR REPLACE INTO store_app(appid,fetched_at,success,type,name,is_free,developers,publishers,release_date,coming_soon,metacritic,recommendations,price_initial,price_final,currency,dlc_count,categories,genres,platforms,website,json)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  let ok = 0;
  for (const id of appids) {
    const r = await getJson(`https://store.steampowered.com/api/appdetails?appids=${id}&cc=${cc}&l=${lang}`);
    const e = r?.[String(id)];
    const d = e?.data;
    if (e?.success && d) {
      ok++;
      ins.run(
        id,
        now(),
        1,
        d.type ?? null,
        d.name ?? null,
        d.is_free ? 1 : 0,
        JSON.stringify(d.developers ?? []),
        JSON.stringify(d.publishers ?? []),
        d.release_date?.date ?? null,
        d.release_date?.coming_soon ? 1 : 0,
        d.metacritic?.score ?? null,
        d.recommendations?.total ?? null,
        d.price_overview?.initial ?? null,
        d.price_overview?.final ?? null,
        d.price_overview?.currency ?? null,
        d.dlc?.length ?? 0,
        JSON.stringify((d.categories ?? []).map((c: any) => c.description)),
        JSON.stringify((d.genres ?? []).map((c: any) => c.description)),
        JSON.stringify(d.platforms ?? {}),
        d.website ?? null,
        JSON.stringify(d),
      );
    } else {
      ins.run(
        id,
        now(),
        0,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      );
    }
    await Bun.sleep(1500);
  }
  return ok;
}
