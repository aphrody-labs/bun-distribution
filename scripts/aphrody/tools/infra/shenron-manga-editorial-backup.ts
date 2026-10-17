// SPDX-License-Identifier: Apache-2.0
/** Narrow DBFR capability: read-only full editorial backup through the existing PostgreSQL container. */
import { chmod, lstat, mkdir, realpath, rename } from "node:fs/promises";
import { hostname } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
const digest = (body: Uint8Array | string) => new Bun.CryptoHasher("sha256").update(body).digest("hex");
async function fileDigest(path: string) {
  const hash = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
  return hash.digest("hex");
}
export function backupScope(job: string, inventoryRoot: string) {
  const child = relative(resolve(inventoryRoot), resolve(job));
  if (
    !isAbsolute(job) ||
    inventoryRoot !== "/home/ubuntu/.aphrody/private/shenron" ||
    !child ||
    child.startsWith("..") ||
    isAbsolute(child)
  )
    throw Error("Private DBFR editorial backup scope required");
}
export function qualifyBackupInventory(list: string) {
  if (
    !["db_manga_volumes", "db_manga_chapters", "wiki_revisions"].every(name =>
      list.split("\n").some(line => line.includes("TABLE DATA ") && line.includes(name)),
    )
  )
    throw Error("Full editorial backup inventory is incomplete");
}
export async function prepareMangaEditorialBackup(input: { job: string; inventoryRoot: string }) {
  backupScope(input.job, input.inventoryRoot);
  if (hostname() !== "vps-6732365f" || process.getuid?.() !== 0) throw Error("DBFR root capability required");
  await mkdir(input.job, { recursive: true, mode: 0o700 });
  const info = await lstat(input.job);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.mode & 0o077 ||
    (await realpath(input.job)) !== resolve(input.job)
  )
    throw Error("Private backup directory identity differs");
  const path = join(input.job, "catalog-before.dump"),
    receiptPath = join(input.job, "backup.json");
  if (await Bun.file(receiptPath).exists()) {
    const receipt = await Bun.file(receiptPath).json();
    if (!receipt.inventoryVerified || (await fileDigest(path)) !== receipt.sha256)
      throw Error("Existing backup changed");
    return { ...receipt, replay: true };
  }
  const dump = Bun.spawn(
    ["docker", "exec", "-u", "postgres", "shenron-postgres", "pg_dump", "-Fc", "-d", "shenron_site"],
    { stdout: "pipe", stderr: "pipe", timeout: 300000 },
  );
  const pending = path + ".pending";
  const errors = new Response(dump.stderr).text();
  await Bun.write(pending, dump.stdout);
  await chmod(pending, 0o600);
  await errors;
  if ((await dump.exited) !== 0) throw Error("Canonical PostgreSQL backup failed");
  const inventory = Bun.spawn(["docker", "exec", "-i", "-u", "postgres", "shenron-postgres", "pg_restore", "--list"], {
    stdin: Bun.file(pending),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 300000,
  });
  const [list] = await Promise.all([new Response(inventory.stdout).text(), new Response(inventory.stderr).text()]);
  if ((await inventory.exited) !== 0) throw Error("Canonical backup inventory failed");
  qualifyBackupInventory(list);
  await rename(pending, path);
  const receipt = {
    schema: "shenron-manga-editorial-backup/v1",
    sha256: await fileDigest(path),
    inventorySha256: digest(list),
    inventoryVerified: true,
    observedAt: new Date().toISOString(),
  };
  await Bun.write(join(input.job, "backup-inventory.txt"), list);
  await chmod(join(input.job, "backup-inventory.txt"), 0o600);
  await Bun.write(receiptPath + ".pending", JSON.stringify(receipt));
  await chmod(receiptPath + ".pending", 0o600);
  await rename(receiptPath + ".pending", receiptPath);
  return receipt;
}
