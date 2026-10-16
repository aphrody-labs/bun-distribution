// SPDX-License-Identifier: Apache-2.0
/** Infra-owned configuration projection. Product credentials remain local to DBFR. */
import { chmod, chown, mkdir } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
const root = "/home/ubuntu/.aphrody/private/shenron/manga-publication";
const digest = (body: Uint8Array | string) =>
  new Bun.CryptoHasher("sha256").update(body).digest("hex");
async function save(path: string, body: string) {
  await Bun.write(path, body);
  await chmod(path, 0o600);
}
async function dockerEnvironment(container: string) {
  const p = Bun.spawn(["docker", "inspect", container], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const objects = JSON.parse(await new Response(p.stdout).text());
  if ((await p.exited) !== 0) throw Error("Existing container unavailable");
  return Object.fromEntries(
    objects[0].Config.Env.map((line: string) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
  ) as Record<string, string>;
}
export async function prepareRuntime(apply = false) {
  if (hostname() !== "vps-6732365f" || process.getuid?.() !== 0)
    throw Error("DBFR root capability required");
  const publisher = await Bun.file(
    "/home/ubuntu/.aphrody/private/shenron/manga-catalogue-20261014/owner-options-shared.json",
  ).json();
  const preparation = await Bun.file(
    "/home/ubuntu/.aphrody/private/shenron/cdn-auto-preparation-20261014/source-publication-config.json",
  ).json();
  const bot = await dockerEnvironment("aphrody-bot-1"),
    site = await dockerEnvironment("aphrody-site-1");
  if (
    new URL(bot.DATABASE_URL!).hostname !== "127.0.0.1" ||
    !site.SHENRON_ADMIN_TOKEN
  )
    throw Error("Current local production credentials missing");
  const admin = await fetch(
    "https://dragonballfr.com/api/wiki-admin/db_manga_volumes/701",
    {
      headers: { authorization: "Bearer " + site.SHENRON_ADMIN_TOKEN },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!admin.ok) throw Error("Existing editorial credential readback failed");
  const catalogue = await (
    await fetch("https://dragonballfr.com/api/manga", {
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    })
  ).json();
  const allowedSeries = [
    ...new Set<string>(
      catalogue.catalog.map((row: { series: string }) => row.series),
    ),
  ];
  const domains = [
    "www.glenat.com",
    "www.books.or.jp",
    "www.piccolodamayonnaiz.com",
    "www.shueisha.co.jp",
    "books.shueisha.co.jp",
    "dragon-ball-official.com",
    "www.cdjapan.co.jp",
    "books.rakuten.co.jp",
    "bookwalker.jp",
    "ebookjapan.yahoo.co.jp",
    "api.openbd.jp",
    "ndlsearch.ndl.go.jp",
    "archive.org",
    "shonenjumpplus.com",
    "cdn-ak-img.shonenjumpplus.com",
    "www.dreamnews.jp",
  ];
  const policy = {
    version: 1,
    profile: "dbfr",
    sources: domains.map((domain) => ({
      domain,
      kind: ["www.piccolodamayonnaiz.com"].includes(domain)
        ? "community"
        : ["archive.org"].includes(domain)
          ? "archive"
          : [
                "www.glenat.com",
                "www.shueisha.co.jp",
                "books.shueisha.co.jp",
                "dragon-ball-official.com",
                "shonenjumpplus.com",
                "cdn-ak-img.shonenjumpplus.com",
              ].includes(domain)
            ? "publisher"
            : "bibliography",
      reviewed: true,
      evidence: "https://dragonballfr.com/wiki/manga",
      rights: {
        ragPermitted: false,
        trainingPermitted: false,
        publicImagesPermitted: true,
      },
    })),
  };
  const source = {
    version: 1,
    input: join(root, "template-input.jsonl"),
    policy: join(root, "policy.json"),
    job: join(root, "source-template"),
    store: {
      manifest: publisher.manifest,
      profile: publisher.profile,
      sdkModule: publisher.sdkModule,
    },
    concurrency: 2,
    maxCycleFiles: 100,
    maxCycleBytes: 67108864,
  };
  const sourceBody = JSON.stringify(source),
    policyBody = JSON.stringify(policy);
  const inbox =
      "/home/ubuntu/.aphrody/profiles/dbfr/jobs/manga-source-handoff-incoming",
    importRoot = join(root, "pool");
  const backupModule = join(root, "runtime/editorial-backup.mjs");
  const configuration = {
    version: 1,
    job: join(root, "worker"),
    outbox: join(root, "outbox"),
    candidateInbox: join(importRoot, "derived/candidate-inbox"),
    sourcePoolJob: importRoot,
    handoff: {
      inbox,
      root: importRoot,
      configSha256: digest(sourceBody),
      policySha256: digest(policyBody),
    },
    replica: { kind: "local", hostname: hostname() },
    publication: {
      ...publisher,
      publicRoot: join(root, "unused-public"),
      job: join(root, "unused-cdn"),
    },
    nativeOriginPreparation: preparation.nativeOriginPreparation,
    editorialBackup: {
      modulePath: backupModule,
      moduleSha256: (await Bun.file(backupModule).exists())
        ? digest(await Bun.file(backupModule).bytes())
        : null,
      input: { inventoryRoot: "/home/ubuntu/.aphrody/private/shenron" },
    },
    allowedSeries,
    maxItemsPerCycle: 2,
    maxOutboxFiles: 5000,
    intervalMs: 60000,
  };
  if (!apply)
    return {
      apply: false,
      root,
      inbox,
      allowedSeries: allowedSeries.length,
      configSha256: digest(sourceBody),
      policySha256: digest(policyBody),
      backupModulePresent: configuration.editorialBackup.moduleSha256 !== null,
    };
  if (!configuration.editorialBackup.moduleSha256)
    throw Error("Qualified backup module must be installed first");
  await Promise.all(
    [root, join(root, "worker"), join(root, "outbox"), importRoot].map((path) =>
      mkdir(path, { recursive: true, mode: 0o700 }),
    ),
  );
  await mkdir(inbox, { recursive: true, mode: 0o700 });
  await chown(inbox, 1000, 1000);
  await chmod(inbox, 0o700);
  await save(join(root, "source-template.json"), sourceBody);
  await save(join(root, "policy.json"), policyBody);
  await save(join(root, "config.json"), JSON.stringify(configuration));
  await save(
    join(root, "worker.env"),
    Object.entries({
      DATABASE_URL: bot.DATABASE_URL!,
      SHENRON_API_ADMIN_TOKEN: site.SHENRON_ADMIN_TOKEN,
      DATABASE_PATH: "/home/ubuntu/apps/shenron/shared/bot/data/bot.db",
    })
      .map(([key, value]) => key + "=" + JSON.stringify(value))
      .join("\n") + "\n",
  );
  return {
    apply: true,
    root,
    inbox,
    allowedSeries: allowedSeries.length,
    configSha256: digest(sourceBody),
    policySha256: digest(policyBody),
  };
}
if (import.meta.main)
  console.log(
    JSON.stringify(await prepareRuntime(Bun.argv.includes("--apply"))),
  );
