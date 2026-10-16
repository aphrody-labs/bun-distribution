import { describe, expect, test } from "bun:test";
import { fileMeta, listDirPaged, searchFiles, totalFiles } from "../src/cpk/index";
import { cpkAssetKind, normalizeDir } from "../src/cpk/shared";

const hasPostgres = Boolean(
  process.env.DATABASE_URL ||
  process.env.ROSE_GRIFFON_DATABASE_URL ||
  process.env.RG_DATABASE_URL ||
  process.env.ACHILLEA_DATABASE_URL,
);

describe.skipIf(!hasPostgres)("cpk PostgreSQL", () => {
  test("liste, recherche et métadonnées utilisent la projection SQL", async () => {
    expect(await totalFiles()).toBeGreaterThan(0);
    const root = await listDirPaged("", 10, 0);
    expect(root.dir).toBe("data");
    expect(root.dirs.length).toBeGreaterThan(0);
    const rows = await searchFiles("c01000010", 1);
    if (rows[0]) {
      const meta = await fileMeta(rows[0].path);
      expect(meta?.path).toBe(rows[0].path);
      expect(meta?.kind).toBe(cpkAssetKind(rows[0].ext));
    }
  });
});

test("normalise les chemins CPK sans accès aux données", () => {
  expect(normalizeDir("/data/dx11/")).toBe("data/dx11");
});
