import { describe, expect, test } from "bun:test";
import * as Inagle from "../src/index";
import * as InagleCli from "../src/cli/index";
import * as InagleApi from "../src/api/index";
import * as InagleTypes from "../src/types/index";
import * as InagleFfi from "../src/ffi/index";
import * as InagleCore from "../src/core/index";
import * as InagleDb from "../src/db/index";
import * as InagleUi from "../src/ui/index";

describe("Consolidated Sub-Package Namespaces (cli, api, types, ffi, core, db, ui)", () => {
  test("exports all 7 unified namespaces on root Inagle", () => {
    expect(Inagle.cli).toBeDefined();
    expect(Inagle.api).toBeDefined();
    expect(Inagle.types).toBeDefined();
    expect(Inagle.ffi).toBeDefined();
    expect(Inagle.core).toBeDefined();
    expect(Inagle.db).toBeDefined();
    expect(Inagle.ui).toBeDefined();
    expect(Inagle.dotnet).toBeDefined();
  });

  test("validates CLI namespace exports", () => {
    expect(typeof InagleCli.registerStatsCommand).toBe("function");
    expect(typeof InagleCli.registerSearchCommand).toBe("function");
  });

  test("validates API namespace exports", () => {
    expect(typeof InagleApi.createInagleService).toBe("function");
    expect(typeof InagleApi.createGlobalSearch).toBe("function");
  });

  test("validates Types namespace exports", () => {
    expect(InagleTypes.SkillElement).toBeDefined();
    expect(typeof InagleTypes.statBlockTotal).toBe("function");
  });

  test("validates FFI namespace exports and NIE contracts", () => {
    expect(typeof InagleFfi.computeLevel5Crc32).toBe("function");
    expect(typeof InagleFfi.decompressCrilayla).toBe("function");
    expect(typeof InagleFfi.decryptCpkBlock).toBe("function");
    expect(typeof InagleFfi.dlopen).toBe("function");
    expect(typeof InagleFfi.FFIType).toBe("object");
  });

  test("validates Core namespace exports", () => {
    expect(typeof InagleCore.InagleError).toBe("function");
    expect(typeof InagleCore.measureTime).toBe("function");
    expect(typeof InagleCore.parseCharaBaseNode).toBe("function");
  });

  test("validates DB namespace exports (Drizzle + Native Bun SQLite/SQL)", () => {
    expect(typeof InagleDb.createDrizzleSqlite).toBe("function");
    expect(typeof InagleDb.createDrizzlePg).toBe("function");
    expect(typeof InagleDb.Database).toBe("function");
    expect(typeof InagleDb.SQL).toBe("function");
  });

  test("validates UI namespace exports", () => {
    expect(InagleUi.colors).toBeDefined();
    expect(InagleUi.AssetManifest).toBeDefined();
  });
});
