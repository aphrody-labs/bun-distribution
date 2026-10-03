#!/usr/bin/env bun
/**
 * build-site-external.ts — `bun run site:artifact` : construit le site Shenron
 * hors VPS de production (Next `--turbopack`, `NEXT_DIST_DIR=.next-build`) puis
 * scelle l'artefact via `package-site-artifact.ts` (tar.gz + manifeste + SHA-256).
 * L'étape release du pipeline `aphrody-infra` consomme cet artefact ; la bascule,
 * les unités et les sondes restent côté infra (aucun SSH ni déploiement ici).
 */
import { existsSync } from "node:fs";
import { mkdir, realpath, rm } from "node:fs/promises";
import { connect } from "node:net";
import { join, relative } from "node:path";
import { createRequire } from "node:module";
import { buildDependencies } from "../../../../../packages/infra/workspace/src/bun-dependency-builds.ts";

const repo = join(import.meta.dir, "..", "..", "..", "..", "..");
const siteDir = join(repo, "apps", "shenron", "site");
const buildDir = join(siteDir, ".next-build");
// Bun's isolated linker owns Next at the site dependency boundary, not a hoisted root.
let nextBin: string;
try {
  nextBin = createRequire(join(siteDir, "package.json")).resolve("next/dist/bin/next");
} catch {
  console.error("✗ Site-owned Next dependency is missing; run the frozen workspace install.");
  process.exit(1);
}

if (!existsSync(nextBin)) {
  console.error(`✗ Binaire Next introuvable : ${nextBin}`);
  process.exit(1);
}

// Base de lecture du build : `SITE_BUILD_DATABASE_URL` (pipeline de release
// aphrody-infra / CI), sinon `REMOTE_DATABASE_URL` de `.env.remote-db`
// (tunnel SSH d'un poste de build). Jamais journalisée.
let databaseUrl = process.env.SITE_BUILD_DATABASE_URL?.trim() ?? "";
if (!databaseUrl) {
  const remoteEnvPath = join(repo, ".env.remote-db");
  if (!existsSync(remoteEnvPath)) {
    console.error(`✗ SITE_BUILD_DATABASE_URL absente et fichier ${remoteEnvPath} introuvable.`);
    process.exit(1);
  }
  const remoteEnv = await Bun.file(remoteEnvPath).text();
  for (const line of remoteEnv.split("\n")) {
    if (line.startsWith("REMOTE_DATABASE_URL=")) {
      databaseUrl = line.slice("REMOTE_DATABASE_URL=".length).trim();
      break;
    }
  }
}

if (!databaseUrl) {
  console.error("✗ Ni SITE_BUILD_DATABASE_URL ni REMOTE_DATABASE_URL (.env.remote-db) définie");
  process.exit(1);
}

const dbUrlObj = new URL(databaseUrl);
const dbPort = Number(dbUrlObj.port || 5432);
const dbHost = dbUrlObj.hostname || "127.0.0.1";

// Vérifier que le port de la DB est ouvert (tunnel SSH)
await new Promise<void>((resolve, reject) => {
  const sock = connect(dbPort, dbHost, () => {
    sock.end();
    resolve();
  });
  sock.setTimeout(3000, () => {
    sock.destroy();
    reject(new Error(`Timeout de connexion vers ${dbHost}:${dbPort}`));
  });
  sock.on("error", (err) => reject(err));
}).catch((err) => {
  console.error(`✗ Impossible de joindre la base sur ${dbHost}:${dbPort} : ${err.message}`);
  process.exit(1);
});

console.log(`✓ Base de build joignable sur ${dbHost}:${dbPort}`);

const shaProc = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: repo });
if (shaProc.exitCode !== 0) {
  console.error("✗ Impossible d'obtenir le SHA git");
  process.exit(1);
}
const sha = shaProc.stdout.toString().trim();
console.log(`▶ Démarrage du build Next.js Turbopack pour commit ${sha}...`);

// A frozen install links workspace owners but does not produce their dist exports.
// Use the same serialized dependency graph as the Workspace qualification gates.
const dependenciesExitCode = await buildDependencies(repo, ["@shenron/site"]);
if (dependenciesExitCode !== 0) process.exit(dependenciesExitCode);

// Nettoyage à froid
await rm(buildDir, { recursive: true, force: true });

const prebuild = Bun.spawnSync([process.execPath, "run", "prebuild"], {
  cwd: siteDir,
  stdout: "inherit",
  stderr: "inherit",
});
if (prebuild.exitCode !== 0) process.exit(prebuild.exitCode);

const startedAt = Date.now();
const buildEnv = { ...process.env };
delete buildEnv.http_proxy;
delete buildEnv.HTTP_PROXY;
delete buildEnv.https_proxy;
delete buildEnv.HTTPS_PROXY;
delete buildEnv.all_proxy;
delete buildEnv.ALL_PROXY;

// Match the existing immutable RG compiler boundary: Node 22 compiles Next;
// Bun owns installs, package preparation, packaging and the final site runtime.
const factory = await Bun.file(join(repo, "config/build-factory.json")).json();
const nodeImage = factory.next?.image ?? "node:22-bookworm-slim";
const memoryMiB = factory.next?.maxOldSpaceSizeMiB ?? 8192;
const containerMemoryMiB = factory.next?.memoryMiB ?? 16384;
const cpus = factory.next?.cpus ?? 6;
if (typeof nodeImage !== "string" || !/^[a-z0-9][a-zA-Z0-9._/:@-]*$/.test(nodeImage))
  throw new Error("Invalid factory Next compiler image");
if (!Number.isSafeInteger(memoryMiB) || memoryMiB < 512 || memoryMiB > 65536)
  throw new Error("Invalid factory Next compiler memory limit");
if (
  !Number.isSafeInteger(containerMemoryMiB) ||
  containerMemoryMiB < 1024 ||
  containerMemoryMiB > 32768 ||
  memoryMiB >= containerMemoryMiB
)
  throw new Error("Invalid factory Next container memory limit");
if (!Number.isSafeInteger(cpus) || cpus < 1 || cpus > 6)
  throw new Error("Invalid factory Next compiler CPU limit");
if (factory.next?.pull && factory.next.pull !== "never")
  throw new Error("Next compiler requires an already cached immutable image");
const inspect = Bun.spawnSync(["docker", "image", "inspect", "--format", "{{.Id}}", nodeImage], {
  cwd: repo,
  stdout: "pipe",
  stderr: "pipe",
});
if (inspect.exitCode !== 0) throw new Error("Cached Node 22 compiler image is unavailable");
const imageId = inspect.stdout.toString().trim();
if (!/^sha256:[a-f0-9]{64}$/.test(imageId))
  throw new Error("Invalid cached Node compiler image ID");
const resolvedNext = await realpath(nextBin);
const compilerPath = relative(repo, resolvedNext);
if (compilerPath === ".." || compilerPath.startsWith("../"))
  throw new Error("Site-owned Next compiler must remain inside the repository bind mount");
const home = join(repo, ".cache", "next-build", "home");
const temporary = join(repo, ".cache", "next-build", "tmp");
await mkdir(home, { recursive: true, mode: 0o700 });
await mkdir(temporary, { recursive: true, mode: 0o700 });
const compilerEnvironment = {
  ...buildEnv,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_DEPLOYMENT_ID: sha,
  NEXT_DIST_DIR: ".next-build",
  DATABASE_URL: databaseUrl,
  TURBOPACK: "1",
  TURBO_ENGINE_GC: "1",
  TURBO_ENGINE_EVICT_MIN_BYTES: "33554432",
  NODE_OPTIONS: `--max-old-space-size=${memoryMiB}`,
  HOME: home,
  TMPDIR: temporary,
  BUILD_CPUS: process.env.BUILD_CPUS ?? "4",
  BUILD_STATIC_CONCURRENCY: process.env.BUILD_STATIC_CONCURRENCY ?? "6",
};
const dockerEnvironment = Object.keys(compilerEnvironment).flatMap((name) =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && name !== "PATH" ? ["--env", name] : [],
);
const uid = process.getuid?.();
const gid = process.getgid?.();
if (uid === undefined || gid === undefined)
  throw new Error("Next factory compiler requires a Linux owner");
console.log(`▶ Cached Next compiler: ${nodeImage} ${imageId}`);
const buildProc = Bun.spawn(
  [
    "docker",
    "run",
    "--rm",
    "--pull=never",
    "--network",
    "host",
    "--cpus",
    String(cpus),
    "--memory",
    `${containerMemoryMiB}m`,
    "--user",
    `${uid}:${gid}`,
    "--volume",
    `${repo}:${repo}`,
    "--workdir",
    siteDir,
    ...dockerEnvironment,
    imageId,
    "node",
    resolvedNext,
    "build",
    "--turbopack",
  ],
  {
    cwd: siteDir,
    // --env receives names only. Secret values stay in the child's memory, never argv/files.
    env: compilerEnvironment,
    stdout: "inherit",
    stderr: "inherit",
  },
);

const exitCode = await buildProc.exited;
if (exitCode !== 0) {
  console.error(`✗ Build Next.js échoué avec le code ${exitCode}`);
  process.exit(exitCode);
}

const elapsed = Math.round((Date.now() - startedAt) / 1000);
console.log(`✓ Build Next.js terminé en ${elapsed}s`);
await Bun.write(
  join(buildDir, "compiler-provenance.json"),
  `${JSON.stringify(
    {
      schema: "aphrody-next-compiler/v1",
      sourceRevision: sha,
      image: nodeImage,
      imageId,
      runtime: "node22",
      bundler: "turbopack",
      limits: { cpus, memoryMiB: containerMemoryMiB, maxOldSpaceSizeMiB: memoryMiB },
    },
    null,
    2,
  )}\n`,
);

// Vérifier la présence des artefacts obligatoires
for (const req of ["BUILD_ID", "prerender-manifest.json", "routes-manifest.json"]) {
  if (!existsSync(join(buildDir, req))) {
    console.error(`✗ Fichier obligatoire manquant dans .next-build : ${req}`);
    process.exit(1);
  }
}

// Emballage de l'artefact
console.log("▶ Emballage de l'artefact via package-site-artifact.ts...");
const pkgProc = Bun.spawnSync(
  [
    process.execPath,
    join(import.meta.dir, "package-site-artifact.ts"),
    "artifacts/site-build.tar.gz",
  ],
  { cwd: repo, stdout: "inherit", stderr: "inherit" },
);

if (pkgProc.exitCode !== 0) {
  console.error("✗ Emballage de l'artefact échoué");
  process.exit(pkgProc.exitCode);
}

// Vérification de la somme de contrôle
const checkProc = Bun.spawnSync(["sha256sum", "--check", "artifacts/site-build.tar.gz.sha256"], {
  cwd: repo,
  stdout: "inherit",
  stderr: "inherit",
});

if (checkProc.exitCode !== 0) {
  console.error("✗ Somme de contrôle SHA256 invalide");
  process.exit(1);
}

console.log("✓ Artefact prêt et vérifié : artifacts/site-build.tar.gz");
