#!/usr/bin/env bun
/**
 * build-site-external.ts — `bun run site:artifact` : construit le site Shenron
 * hors VPS de production (Next `--turbopack`, `NEXT_DIST_DIR=.next-build`) puis
 * scelle l'artefact via `package-site-artifact.ts` (tar.gz + manifeste + SHA-256).
 * L'étape release du pipeline `aphrody-infra` consomme cet artefact ; la bascule,
 * les unités et les sondes restent côté infra (aucun SSH ni déploiement ici).
 */
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";

const repo = join(import.meta.dir, "..", "..", "..", "..", "..");
const siteDir = join(repo, "apps", "shenron", "site");
const buildDir = join(siteDir, ".next-build");
const nextBin = join(repo, "node_modules", "next", "dist", "bin", "next");

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

const buildProc = Bun.spawn([process.execPath, nextBin, "build", "--turbopack"], {
  cwd: siteDir,
  env: {
    ...buildEnv,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_DEPLOYMENT_ID: sha,
    NEXT_DIST_DIR: ".next-build",
    DATABASE_URL: databaseUrl,
    TURBOPACK: "1",
    TURBO_ENGINE_GC: "1",
    TURBO_ENGINE_EVICT_MIN_BYTES: "33554432",
    BUN_JSC_forceRAMSize: "8589934592",
    BUN_GARBAGE_COLLECTOR_LEVEL: "1",
    BUILD_CPUS: process.env.BUILD_CPUS ?? "4",
    BUILD_STATIC_CONCURRENCY: process.env.BUILD_STATIC_CONCURRENCY ?? "6",
  },
  stdout: "inherit",
  stderr: "inherit",
});

const exitCode = await buildProc.exited;
if (exitCode !== 0) {
  console.error(`✗ Build Next.js échoué avec le code ${exitCode}`);
  process.exit(exitCode);
}

const elapsed = Math.round((Date.now() - startedAt) / 1000);
console.log(`✓ Build Next.js terminé en ${elapsed}s`);

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
