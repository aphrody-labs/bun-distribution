/**
 * Résolution des artefacts runtime (`src/config.ts`).
 *
 * Ces tests s'appuient sur les VRAIS artefacts présents sur la machine
 * (`apps/azalee/data/`). Chaque test restaure la configuration explicite et les
 * variables d'environnement touchées : le miroir SQLite est un singleton
 * process-local, une fuite de configuration casserait les fichiers suivants.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { configureAzalee, getAzaleeConfig, resetAzaleeConfig, resolveDataDir, resolveMirrorPath } from "../src/config";

/** Sauvegarde/restauration des variables d'environnement lues par le module. */
const ENV_KEYS = ["AZALEE_DATA_DIR", "SQLITE_DB_PATH", "NIERS_MIRROR"] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  resetAzaleeConfig();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetAzaleeConfig();
});

const dataDir = resolveDataDir();
const hasData = dataDir !== null;
const mirrorPath = resolveMirrorPath();
const hasMirror = mirrorPath !== null && existsSync(mirrorPath);

describe("resolveDataDir — découverte du dossier d'artefacts", () => {
  test.skipIf(!hasData)("trouve un dossier réel porteur d'au moins un marqueur", () => {
    expect(dataDir).toBeString();
    expect(path.isAbsolute(dataDir as string)).toBe(true);
    expect(existsSync(dataDir as string)).toBe(true);
    // Au moins un des marqueurs Azalée doit exister — sinon c'est un `data/`
    // homonyme (dumps Postgres à la racine du monorepo) qu'on doit rejeter.
    const markers = ["backups/mirror.sqlite", "schema-snapshot"];
    expect(markers.some(m => existsSync(path.join(dataDir as string, m)))).toBe(true);
  });

  test("un dossier sans marqueur Azalée n'est JAMAIS retenu", () => {
    // `/tmp` existe toujours mais ne contient aucun marqueur → la résolution
    // doit l'ignorer et retomber sur les candidats conventionnels.
    configureAzalee({ dataDir: tmpdir() });
    expect(resolveDataDir()).not.toBe(path.resolve(tmpdir()));
  });
});

describe("configureAzalee / getAzaleeConfig / resetAzaleeConfig", () => {
  test("la configuration explicite est absolutisée et fusionnée", () => {
    configureAzalee({ dataDir: "." });
    expect(getAzaleeConfig().dataDir).toBe(path.resolve("."));
    expect(getAzaleeConfig().mirrorPath).toBeUndefined();

    // Une seconde passe ne doit PAS effacer la première (fusion, pas remplacement).
    expect(getAzaleeConfig().dataDir).toBe(path.resolve("."));
  });

  test("resetAzaleeConfig remet les deux clés à zéro", () => {
    configureAzalee({ dataDir: "/a", mirrorPath: "/b" });
    expect(Object.keys(getAzaleeConfig())).toHaveLength(2);
    resetAzaleeConfig();
    expect(getAzaleeConfig().dataDir).toBeUndefined();
    expect(getAzaleeConfig().mirrorPath).toBeUndefined();
  });

  test.skipIf(!hasData)("AZALEE_DATA_DIR est prioritaire sur les chemins conventionnels", () => {
    // On repointe l'env sur le VRAI dossier : la valeur doit être retenue telle
    // quelle (et non un autre candidat), preuve que l'env passe avant le cwd.
    process.env.AZALEE_DATA_DIR = dataDir as string;
    expect(resolveDataDir()).toBe(dataDir as string);
    // Un env pointant sur un dossier sans marqueur est ignoré (pas de source
    // silencieuse) — on retombe sur la découverte conventionnelle.
    process.env.AZALEE_DATA_DIR = tmpdir();
    expect(resolveDataDir()).toBe(dataDir as string);
  });
});

describe("resolveMirrorPath — miroir SQLite des tables inagle_*", () => {
  test("ignore les sauvegardes locales périmées quand le miroir canonique manque", () => {
    const root = mkdtempSync(path.join(tmpdir(), "azalee-old-mirror-"));
    if (path.dirname(root) !== path.resolve(tmpdir())) {
      throw new Error("Refus de supprimer un dossier temporaire hors du répertoire prévu");
    }
    try {
      const backups = path.join(root, "backups");
      mkdirSync(backups);
      writeFileSync(path.join(backups, "mirror.sqlite"), "stale");
      writeFileSync(path.join(backups, "supabase-2099-01-01.sqlite"), "stale");
      configureAzalee({ dataDir: root });
      delete process.env.SQLITE_DB_PATH;
      process.env.NIERS_MIRROR = path.join(root, "missing-canonical.sqlite");

      expect(resolveDataDir()).toBe(root);
      expect(resolveMirrorPath()).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.skipIf(!hasMirror)("résout un fichier SQLite réel", () => {
    const mirror = resolveMirrorPath();
    expect(mirror).toBeString();
    expect(existsSync(mirror as string)).toBe(true);
    expect(mirror as string).toMatch(/\.sqlite$/);
  });

  test("mirrorPath explicite l'emporte sur tout le reste", () => {
    process.env.SQLITE_DB_PATH = "/tmp/depuis-env.sqlite";
    configureAzalee({ mirrorPath: "/tmp/explicite.sqlite" });
    expect(resolveMirrorPath()).toBe(path.resolve("/tmp/explicite.sqlite"));
  });

  test("SQLITE_DB_PATH l'emporte sur la découverte conventionnelle", () => {
    process.env.SQLITE_DB_PATH = "relatif/mirror.sqlite";
    // Absolutisé par rapport au cwd (jamais renvoyé relatif).
    expect(resolveMirrorPath()).toBe(path.resolve("relatif/mirror.sqlite"));
  });
});
