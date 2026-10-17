// SPDX-License-Identifier: Apache-2.0
/** `re steam`: native Bun Steam indexer (scan, stats, sql, api-sync, store, openid, classify, rea, remote-download). */
import { parseArgs } from "node:util";
import { openSteamDb } from "./db.js";
import { opClassify, opRea, opScan, opSql, opStats } from "./ops.js";
import { openIdLoginUrl, openIdVerify, recordAuthSession } from "./openid.js";
import { syncApiCatalog, syncAppList, syncStoreApps } from "./webapi.js";
import { remoteDownload } from "./remote.js";

const HELP = `re steam <command> [options]
  scan                       index the local Steam install into SQLite
  stats                      row counts per table
  sql "<SELECT ...>"         read-only query
  api-sync [--applist]       index Web API interfaces/methods/params/endpoints (+ app list with STEAM_WEB_API_KEY)
  store <appid...>           index store appdetails
  openid login <return_to>   print the Steam OpenID URL
  openid verify <query>      verify a callback query, record the SteamID64
  classify <file>            detect the file type
  rea <appid> [--out dir]    run the RE pipeline on the installed app executable
  remote-download <appid> --host vps --dest <dir> [--streams N] [--bwlimit 50M]
options: --db <path> --root <steam dir> --hash-max <bytes> --no-hash --json`;

/** Entry point for `re steam ...`. Returns the process exit code. */
export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      db: { type: "string" },
      root: { type: "string" },
      "hash-max": { type: "string" },
      "no-hash": { type: "boolean" },
      json: { type: "boolean" },
      applist: { type: "boolean" },
      out: { type: "string" },
      host: { type: "string" },
      dest: { type: "string" },
      streams: { type: "string" },
      bwlimit: { type: "string" },
      steamcmd: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  const common = {
    db: values.db,
    root: values.root,
    hashMax: values["no-hash"]
      ? 0
      : values["hash-max"]
        ? Number(values["hash-max"])
        : undefined,
  };
  const print = (v: unknown) =>
    console.log(
      values.json || typeof v !== "string"
        ? JSON.stringify(
            v,
            (_, x) => (typeof x === "bigint" ? x.toString() : x),
            2,
          )
        : v,
    );
  const [cmd, ...rest] = positionals;

  try {
    switch (cmd) {
      case "scan":
        print(await opScan(common, (m) => console.error(m)));
        break;
      case "stats":
        print(opStats(common));
        break;
      case "sql":
        print(opSql(common, rest.join(" ")));
        break;
      case "api-sync": {
        const db = openSteamDb(common.db);
        const r = await syncApiCatalog(db);
        const applist = values.applist ? await syncAppList(db) : undefined;
        db.close();
        print({ ...r, applist });
        break;
      }
      case "store": {
        const db = openSteamDb(common.db);
        const ids = rest.map(Number).filter(Number.isInteger);
        print({ requested: ids.length, ok: await syncStoreApps(db, ids) });
        db.close();
        break;
      }
      case "openid": {
        const [sub, arg] = rest;
        if (sub === "login" && arg) print(openIdLoginUrl(arg));
        else if (sub === "verify" && arg) {
          const id = await openIdVerify(arg);
          const db = openSteamDb(common.db);
          recordAuthSession(db, "openid", "https://localhost/", id);
          db.close();
          print({ steamid64: id });
        } else throw new Error("openid login <return_to> | verify <query>");
        break;
      }
      case "classify":
        print(await opClassify(rest[0]!));
        break;
      case "rea":
        print(await opRea(common, Number(rest[0]), values.out));
        break;
      case "remote-download":
        print(
          await remoteDownload({
            appid: Number(rest[0]),
            host: values.host ?? "vps",
            dest: values.dest!,
            streams: values.streams ? Number(values.streams) : undefined,
            bwlimit: values.bwlimit,
            steamcmd: values.steamcmd,
          }),
        );
        break;
      default:
        console.log(HELP);
        return cmd ? 2 : 0;
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  return 0;
}
