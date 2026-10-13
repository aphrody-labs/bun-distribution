// SPDX-License-Identifier: Apache-2.0
import { Database } from "bun:sqlite";
import { chownSync, linkSync, lstatSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { parseVerified } from "./shenron-offsite-backup";

const STORES = ["memory.sqlite", "conversations.sqlite"] as const;
const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
function absent(path: string) {
  try {
    lstatSync(path);
    return false;
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
    return true;
  }
}

/** All checks precede writes; hard-link publication cannot replace a racing writer. */
export async function restoreMissingStores(
  snapshot: string,
  data: string,
  owner: { uid: number; gid: number },
  apply = false,
) {
  if (![owner.uid, owner.gid].every((value) => Number.isSafeInteger(value) && value >= 0))
    throw Error("Explicit qualified runtime UID/GID required");
  if (lstatSync(snapshot).isSymbolicLink() || lstatSync(data).isSymbolicLink())
    throw Error("Canonical directories must not be symlinks");
  const source = realpathSync(snapshot),
    destination = realpathSync(data);
  const { files } = parseVerified(await Bun.file(join(source, "VERIFIED.json")).text());
  const prepared = await Promise.all(
    STORES.map(async (name) => {
      const key = `server/data/${name}.gz`,
        path = join(source, key),
        target = join(destination, name);
      if (!absent(target)) throw Error(`Existing store preserved: ${name}`);
      if (
        !files[key] ||
        lstatSync(path).isSymbolicLink() ||
        !realpathSync(path).startsWith(source + sep)
      )
        throw Error(`Snapshot does not declare canonical store: ${name}`);
      const compressed = await Bun.file(path).bytes();
      if (compressed.length > 16 * 1024 * 1024 || sha256(compressed) !== files[key])
        throw Error(`Snapshot checksum or size differs: ${name}`);
      const bytes = Bun.gunzipSync(compressed);
      if (bytes.length > 64 * 1024 * 1024)
        throw Error("Restore scope exceeds small runtime store limit");
      const check = Database.deserialize(bytes, { readonly: true });
      let tables: { name: string; rows: number }[] = [];
      try {
        const result = check.query("PRAGMA quick_check").get() as { quick_check: string };
        if (result.quick_check !== "ok") throw Error(`SQLite integrity differs: ${name}`);
        tables = (
          check
            .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            .all() as { name: string }[]
        ).map(({ name: tableName }) => ({
          name: tableName,
          rows: (
            check.query(`SELECT COUNT(*) AS n FROM "${tableName.replaceAll('"', '""')}"`).get() as {
              n: number;
            }
          ).n,
        }));
      } finally {
        check.close();
      }
      return {
        name,
        target,
        bytes,
        tables,
        compressedSha256: files[key],
        sha256: sha256(bytes),
      };
    }),
  );
  for (const store of prepared) {
    if (!apply) continue;
    const temporary = join(destination, `.restore-${store.name}-${crypto.randomUUID()}`);
    try {
      writeFileSync(temporary, store.bytes, { flag: "wx", mode: 0o600 });
      chownSync(temporary, owner.uid, owner.gid);
      linkSync(temporary, store.target);
    } finally {
      if (!absent(temporary)) unlinkSync(temporary);
    }
  }
  return {
    apply,
    source,
    destination,
    owner,
    stores: prepared.map((store) => ({
      name: store.name,
      target: store.target,
      tables: store.tables,
      compressedSha256: store.compressedSha256,
      sha256: store.sha256,
      size: store.bytes.length,
    })),
  };
}

if (import.meta.main) {
  const [snapshot, data, uid, gid, flag] = process.argv.slice(2);
  if (!snapshot || !data || uid === undefined || gid === undefined || (flag && flag !== "--apply"))
    throw Error("Expected SNAPSHOT CANONICAL_DATA UID GID [--apply]");
  console.log(
    JSON.stringify(
      await restoreMissingStores(
        snapshot,
        data,
        { uid: Number(uid), gid: Number(gid) },
        flag === "--apply",
      ),
    ),
  );
}
