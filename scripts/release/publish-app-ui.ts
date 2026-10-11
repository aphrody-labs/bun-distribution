#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- publication steps and guards must be sequential */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync, mkdtempSync } from "node:fs";
import { join, resolve, relative, sep, posix, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";

const repository = resolve(import.meta.dir, "../..");
const serverSource = "packages/infra/workspace/src/downloads/server.ts";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export interface ReleaseConfig {
  host: { target: string; root: string; service?: string };
  site: {
    appUi: {
      directory: string;
      declaration: string;
      nativeRpc: boolean;
      googleSearch?: { owner: string; module: string; environmentFile: string };
    };
  };
}
export function releasePlan(config: ReleaseConfig, revision: string) {
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error("An exact 40-character source revision is required");
  if (
    !["vps", "dbfr"].includes(config.host.target) ||
    !/^\/home\/[a-z0-9_-]+\/apps\/downloads$/.test(config.host.root) ||
    config.site.appUi.directory !== "app-ui" ||
    config.site.appUi.declaration !== "app-ui/deployment.json" ||
    config.site.appUi.nativeRpc !== false
  )
    throw new Error("Unsupported deployment catalog; preserve host and native RPC isolation");
  const id = "app-ui-" + revision;
  const base = posix.join(config.host.root, "app-ui");
  const service = config.host.service ?? "aphrody-downloads";
  if (service !== "aphrody-downloads") throw new Error("Unsupported systemd service owner");
  const search = config.site.appUi.googleSearch;
  if (
    search &&
    (search.owner !== "/home/ubuntu/.local/bin/aphrody" ||
      search.module !== "current/google-search.ts" ||
      search.environmentFile !== "current/google-search.env")
  )
    throw new Error("Unsupported Google search deployment catalog");
  return {
    revision,
    id,
    host: config.host.target,
    base,
    release: posix.join(base, "releases", id),
    server: posix.join(config.host.root, "app/server.ts"),
    declaration: posix.join(base, "deployment.json"),
    restart:
      "sudo systemctl restart " +
      quote(service + ".service") +
      "; systemctl is-active --quiet " +
      quote(service + ".service"),
    ...(search
      ? {
          search: {
            owner: search.owner,
            module: posix.join(base, search.module),
            environmentFile: posix.join(base, search.environmentFile),
          },
        }
      : {}),
    nativeRpc: false,
  };
}
export function canonicalBunInputs(checkout: string, revision: string) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Exact Bun source revision required");
  const checkoutRoot = realpathSync(checkout);
  const ownedFile = (path: string) => {
    const file = join(checkoutRoot, path);
    const inside = relative(checkoutRoot, realpathSync(file));
    if (inside.startsWith(".." + sep) || isAbsolute(inside) || !lstatSync(file).isFile())
      throw new Error("Canonical Bun source file escapes the checkout");
    return file;
  };
  const receiptFile = ownedFile("packages/bun-aphrody-web/transfer-receipt.json");
  const receipt = JSON.parse(readFileSync(receiptFile, "utf8")) as {
    schemaVersion: number;
    sourceCommit: string;
    files: { source: string; destination: string; sha256: string }[];
  };
  const entry = receipt.files.find((file) => file.source === "crates/web/site/data/docs.json");
  if (
    receipt.schemaVersion !== 1 ||
    !entry ||
    entry.destination !== "packages/bun-aphrody-web/crates/site/data/docs.json" ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    !/^[a-f0-9]{40}$/.test(receipt.sourceCommit)
  )
    throw new Error("Canonical Bun documentation transfer receipt required");
  const docs = ownedFile(entry.destination);
  if (sha(readFileSync(docs)) !== entry.sha256)
    throw new Error("Bun documentation transfer checksum mismatch");
  const search = ownedFile("packages/bun-google/src/search.ts");
  return {
    revision,
    transferSourceCommit: receipt.sourceCommit,
    transferSha256: sha(readFileSync(receiptFile)),
    docs: { path: entry.destination, sha256: entry.sha256 },
    search: { path: "packages/bun-google/src/search.ts", sha256: sha(readFileSync(search)) },
    docsFile: docs,
    searchFile: search,
  };
}

export function searchEnvironment(module: string, owner: string): string {
  if (
    !/^\/home\/[a-z0-9_-]+\/apps\/downloads\/app-ui\/current\/google-search\.ts$/.test(module) ||
    owner !== "/home/ubuntu/.local/bin/aphrody"
  )
    throw new Error("Invalid search environment owner");
  return `GOOGLE_SEARCH_SDK_MODULE=${module}\nGOOGLE_SEARCH_OWNER=${owner}\n`;
}
export function buildCommand(artifact: string, publicAssets = false): string[] {
  return [
    "bun",
    "m3/packages/app-ui/build.ts",
    "--out",
    artifact,
    ...(publicAssets ? ["--public-assets"] : []),
  ];
}
export function prerequisiteCommands(): string[][] {
  // Build exactly the JS owners imported by app-ui; fonts are checksum-pinned by their owner lock.
  return [
    ["bun", "run", "--cwd", "crates/tauri/aphrody-tauri-api", "build"],
    ["bun", "run", "--cwd", "crates/tauri/aphrody-tauri-plugin-dialog", "build"],
    ["bun", "m3/scripts/fonts-sync.ts", "--quiet"],
    ["bun", "m3/scripts/fonts-sync.ts", "--check", "--quiet"],
    ["bun", "run", "--cwd", "m3/packages/identity", "sprite"],
  ];
}
export function declarationCommand(path: string): string {
  // Source \\n becomes exactly one shell backslash, so printf emits a real newline.
  return `printf '%s\\n' '{"schemaVersion":1,"root":"current"}' > ${quote(path)}`;
}
export function smokeCommand(directory: string): string {
  const curl = "curl -fsS --max-time 2 -H 'Host: aphrody.com' ";
  return (
    "curl -fsS --max-time 2 --retry 5 --retry-delay 1 --retry-connrefused --retry-max-time 15 " +
    "http://127.0.0.1:8797/health > /dev/null; " +
    curl +
    "http://127.0.0.1:8797/ -o " +
    quote(directory + "/home-smoke.html") +
    "; " +
    curl +
    "http://127.0.0.1:8797/os -o " +
    quote(directory + "/os-smoke.html") +
    "; " +
    'grep -Fq \'name="aphrody-rpc" content="unavailable"\' ' +
    quote(directory + "/home-smoke.html") +
    "; " +
    'grep -Fq \'name="aphrody-rpc" content="unavailable"\' ' +
    quote(directory + "/os-smoke.html")
  );
}
export function verifyArtifactProvenance(prior: unknown, current: unknown) {
  if (JSON.stringify(prior) !== JSON.stringify(current))
    throw new Error("Artifact source/checksum provenance does not match");
}
export function artifactManifest(
  directory: string,
  revision: string,
  publicAssets = false,
  sources?: ReturnType<typeof canonicalBunInputs>,
) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Invalid source revision");
  const root = realpathSync(directory);
  const files: Array<{ path: string; bytes: number; sha256: string }> = [];
  function walk(current: string) {
    for (const name of readdirSync(current).toSorted()) {
      const path = join(current, name);
      const info = lstatSync(path);
      const rel = relative(root, path);
      if (info.isSymbolicLink() || rel.startsWith(".." + sep) || /[\r\n\\]/.test(name))
        throw new Error("Artifact contains an unsafe path or symlink");
      if (info.isDirectory()) walk(path);
      else if (info.isFile() && rel !== "release-manifest.json" && rel !== "SHA256SUMS") {
        const bytes = readFileSync(path);
        files.push({ path: rel.replaceAll(sep, "/"), bytes: bytes.length, sha256: sha(bytes) });
      } else if (!info.isFile()) throw new Error("Artifact contains a non-regular file");
    }
  }
  walk(root);
  if (
    sources &&
    !files.some((file) => file.path === "google-search.ts" && file.sha256 === sources.search.sha256)
  )
    throw new Error("Artifact Google search source checksum mismatch");
  for (const required of [
    "index.html",
    "public-home.html",
    "app.js",
    "app.css",
    "public-docs.json",
  ])
    if (!files.some((file) => file.path === required))
      throw new Error("Incomplete artifact: " + required);
  if (!files.some((file) => file.path.startsWith("fonts/"))) throw new Error("Missing fonts");
  if (publicAssets && !files.some((file) => file.path === "public-assets.json"))
    throw new Error("Missing public assets declaration");
  return {
    schemaVersion: 1,
    revision,
    publicAssets,
    files,
    ...(sources
      ? {
          sources: {
            bun: sources.revision,
            transferSourceCommit: sources.transferSourceCommit,
            transferSha256: sources.transferSha256,
            docs: sources.docs,
            search: sources.search,
          },
        }
      : {}),
  };
}
export function runtimeCommand(command: string[], executable = process.execPath): string[] {
  return command[0] === "bun" ? [executable, ...command.slice(1)] : command;
}
async function run(command: string[], cwd = repository, env: Record<string, string> = {}) {
  const process = Bun.spawn(runtimeCommand(command), {
    cwd,
    env: { ...Bun.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (code !== 0) throw new Error(command[0] + " failed: " + stderr.slice(-3000));
  return stdout.trim();
}
async function main() {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean" },
      build: { type: "boolean" },
      artifact: { type: "string" },
      revision: { type: "string" },
      out: { type: "string" },
      "expected-server-sha": { type: "string" },
      "scp-fallback": { type: "boolean" },
      "public-assets": { type: "boolean" },
    },
  });
  const revision = values.revision ?? (await run(["git", "rev-parse", "HEAD"]));
  const config: ReleaseConfig = await Bun.file(
    join(repository, "tools/config/downloads.json"),
  ).json();
  const plan = releasePlan(config, revision);
  const publicAssets = values["public-assets"] ?? false;
  console.log(JSON.stringify({ ...plan, publicAssets }, null, 2));
  if (!values.build && !values.apply) return;
  if (revision !== (await run(["git", "rev-parse", "HEAD"])))
    throw new Error("Selected revision must be current HEAD");
  const dirty = await run([
    "git",
    "status",
    "--porcelain",
    "--",
    "m3",
    serverSource,
    "crates/ui/identity",
    "crates/tauri",
    "tools/config/downloads.json",
    "tools/config/public-assets.json",
    "scripts/release/publish-app-ui.ts",
    "scripts/release/publish-app-ui.test.ts",
    "bun.lock",
    "package.json",
  ]);
  if (dirty)
    throw new Error("Commit the complete owned UI/source batch before building or publishing");
  const bunCheckout = resolve(Bun.env.APHRODY_BUN_CHECKOUT || join(repository, "../bun"));
  const bunRevision = await run(["git", "rev-parse", "HEAD"], bunCheckout);
  if (
    await run(
      [
        "git",
        "status",
        "--porcelain",
        "--",
        "packages/bun-google/src/search.ts",
        "packages/bun-aphrody-web/crates/site/data/docs.json",
        "packages/bun-aphrody-web/transfer-receipt.json",
      ],
      bunCheckout,
    )
  )
    throw new Error("Commit canonical Bun search and documentation sources before publication");
  const sources = canonicalBunInputs(bunCheckout, bunRevision);
  const workspace = mkdtempSync(join(tmpdir(), "aphrody-app-ui-release-"));
  const artifact = resolve(values.artifact ?? values.out ?? join(workspace, "artifact"));
  if (artifact === repository || artifact.startsWith(repository + sep))
    throw new Error("Use an isolated artifact directory outside the checkout");
  if (values.build) {
    for (const command of prerequisiteCommands()) await run(command);
    await run(buildCommand(artifact, publicAssets), repository, {
      APP_UI_DOCS_CATALOG: sources.docsFile,
      APHRODY_BUN_CHECKOUT: bunCheckout,
      APP_UI_BUN_REVISION: bunRevision,
    });
    await Bun.write(join(artifact, "google-search.ts"), Bun.file(sources.searchFile));
    if (plan.search)
      await Bun.write(
        join(artifact, "google-search.env"),
        searchEnvironment(plan.search.module, plan.search.owner),
      );
  }
  if (
    plan.search &&
    readFileSync(join(artifact, "google-search.env"), "utf8") !==
      searchEnvironment(plan.search.module, plan.search.owner)
  )
    throw new Error("Artifact Google search environment does not match the declared owner");
  const manifest = artifactManifest(artifact, revision, publicAssets, sources);
  if (!values.build) {
    const prior = await Bun.file(join(artifact, "release-manifest.json")).json();
    verifyArtifactProvenance(prior, manifest);
  }
  await Bun.write(join(artifact, "release-manifest.json"), JSON.stringify(manifest));
  await Bun.write(
    join(artifact, "SHA256SUMS"),
    manifest.files.map((file) => file.sha256 + "  " + file.path).join("\n") + "\n",
  );
  const archive = join(workspace, "app-ui.tar.gz");
  await run(["tar", "-czf", archive, "-C", artifact, "."]);
  const archiveHash = sha(new Uint8Array(await Bun.file(archive).arrayBuffer()));
  console.log(
    JSON.stringify({ artifact, archive, sha256: archiveHash, files: manifest.files.length }),
  );
  if (!values.apply) return;
  const expected = values["expected-server-sha"];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected))
    throw new Error("Apply requires --expected-server-sha from the reviewed host plan");
  const ssh = (command: string) =>
    run(["aphrody", "infra", "ssh", "exec", "--host", plan.host, "--cmd", command]);
  const guard = `test "$(sha256sum ${quote(plan.server)} | cut -d ' ' -f 1)" = ${quote(expected)}`;
  if (plan.search)
    await ssh(
      `test -x ${quote(plan.search.owner)}; systemctl cat aphrody-downloads.service | grep -Fq ${quote("EnvironmentFile=-" + plan.search.environmentFile)}`,
    );
  await ssh("set -eu; " + guard + "; mkdir -p " + quote(plan.base + "/releases"));
  const upload = async (source: string, target: string, large = false) => {
    try {
      await run([
        "aphrody",
        "infra",
        "ssh",
        "sftp",
        "--host",
        plan.host,
        "--path",
        target,
        "--put",
        source,
      ]);
    } catch (error) {
      if (!large || !values["scp-fallback"]) throw error;
      // Native SFTP has a bounded large-transfer timeout. OpenSSH is an explicit coverage fallback.
      const resolved = await run(["ssh", "-G", plan.host]);
      if (!/^hostname (?![a-z]+$)\S+/m.test(resolved))
        throw new Error("OpenSSH host alias is not configured", { cause: error });
      const executable = Bun.which("ssh");
      if (!executable)
        throw new Error("Native OpenSSH executable is unavailable", { cause: error });
      await run(["scp", "-S", executable, "-o", "BatchMode=yes", source, plan.host + ":" + target]);
    }
  };
  const pending = plan.base + "/" + plan.id + ".tar.gz.pending";
  await upload(archive, pending, true);
  const sourceHash = sha(readFileSync(join(repository, serverSource)));
  await upload(join(repository, serverSource), plan.server + "." + plan.id + ".pending");
  const backup = plan.base + "/backups/" + plan.id;
  const rollback =
    `echo ${quote(expected + "  " + backup + "/server.ts")} | sha256sum -c - && ` +
    `cp -p ${quote(backup + "/server.ts")} ${quote(plan.server + ".rollback")} && mv ${quote(plan.server + ".rollback")} ${quote(plan.server)}; ` +
    `if test -s ${quote(backup + "/previous-current")}; then ln -s "$(cat ${quote(backup + "/previous-current")})" ${quote(plan.base + "/current.rollback")} && mv -Tf ${quote(plan.base + "/current.rollback")} ${quote(plan.base + "/current")}; else unlink ${quote(plan.base + "/current")} 2>/dev/null || :; fi; ` +
    `if test -f ${quote(backup + "/deployment.json")}; then (cd ${quote(backup)} && sha256sum -c deployment.sha256) && cp -p ${quote(backup + "/deployment.json")} ${quote(plan.declaration + ".rollback")} && mv ${quote(plan.declaration + ".rollback")} ${quote(plan.declaration)}; else rm -f ${quote(plan.declaration)}; fi; ${plan.restart}`;
  await ssh(
    `set -eu; ${guard}; test ! -e ${quote(plan.release)}; ` +
      `echo ${quote(archiveHash + "  " + pending)} | sha256sum -c -; mkdir -p ${quote(plan.release)} ${quote(backup)}; ` +
      `tar -xzf ${quote(pending)} -C ${quote(plan.release)}; cd ${quote(plan.release)}; sha256sum -c SHA256SUMS; ` +
      `echo ${quote(sourceHash + "  " + plan.server + "." + plan.id + ".pending")} | sha256sum -c -; ` +
      `cp -p ${quote(plan.server)} ${quote(backup + "/server.ts")}; echo ${quote(expected + "  " + backup + "/server.ts")} | sha256sum -c -; ` +
      `if test -e ${quote(plan.declaration)}; then cp -p ${quote(plan.declaration)} ${quote(backup + "/deployment.json")}; old_declaration_sha=$(sha256sum ${quote(plan.declaration)} | cut -d ' ' -f 1); printf '%s  deployment.json\\n' "$old_declaration_sha" > ${quote(backup + "/deployment.sha256")}; (cd ${quote(backup)} && sha256sum -c deployment.sha256); fi; ` +
      `readlink ${quote(plan.base + "/current")} > ${quote(backup + "/previous-current")} || :; ` +
      `rollback() { ${rollback}; }; trap 'status=$?; if test "$status" -ne 0; then rollback; fi; exit "$status"' EXIT; ` +
      `mv ${quote(plan.server + "." + plan.id + ".pending")} ${quote(plan.server)}; ` +
      `ln -s ${quote("releases/" + plan.id)} ${quote(plan.base + "/current.pending")}; ` +
      `mv -Tf ${quote(plan.base + "/current.pending")} ${quote(plan.base + "/current")}; ` +
      declarationCommand(plan.declaration + ".pending") +
      "; " +
      `mv ${quote(plan.declaration + ".pending")} ${quote(plan.declaration)}; ${plan.restart}; ` +
      smokeCommand(backup) +
      "; trap - EXIT",
  );
  console.log(JSON.stringify({ activated: plan.release, backup, sourceHash, rollback }));
}
if (import.meta.main) await main();
