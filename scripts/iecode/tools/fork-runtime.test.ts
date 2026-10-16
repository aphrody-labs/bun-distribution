import { expect, test } from "bun:test";
import { exportForkCatalog, exportNativeAlias, selectForkCatalogSource } from "./fork-runtime";

test("native alias export rejects unavailable engine before touching output", async () => {
  await expect(
    exportNativeAlias({ status: "unavailable", error: "not installed" }, "relative-output", import.meta.dir),
  ).rejects.toThrow("qualified IECODE native library");
});

test("capability export rejects relative checkout selection", async () => {
  await expect(exportForkCatalog("../bun")).rejects.toThrow("absolute checkout path");
});

test("single producer selection keeps the legacy source alias and rejects ambiguous input", () => {
  expect(selectForkCatalogSource({ "bun-source": "selected-bun", "producer-docs": "staging" })).toEqual({
    bunSource: "selected-bun",
    catalog: undefined,
    producerDocs: "staging",
  });
  expect(selectForkCatalogSource({ "bun-root": "selected-bun" }).bunSource).toBe("selected-bun");
  expect(() => selectForkCatalogSource({ "bun-source": "one", "bun-root": "two" })).toThrow("exactly one");
  expect(() => selectForkCatalogSource({ "bun-source": "one", catalog: "two" })).toThrow("exactly one");
  expect(() => selectForkCatalogSource({ catalog: "catalog", "producer-docs": "staging" })).toThrow(
    "explicit Bun source",
  );
});
