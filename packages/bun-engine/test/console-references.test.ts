import { describe, expect, test } from "bun:test";
import { loadConsoleReferences, validateConsoleReferences, type ConsoleReferences } from "../src/console/references";

describe("console research references", () => {
  test("indexes the complete 3DS and sister-project map", async () => {
    const catalog = await loadConsoleReferences();
    expect(await validateConsoleReferences(catalog)).toEqual([]);
    expect(catalog.references).toHaveLength(19);
    expect(catalog.references.filter(({ category }) => category === "3ds-reference")).toHaveLength(3);
    expect(catalog.references.filter(({ localPath }) => localPath)).toHaveLength(5);
  });

  test("rejects duplicate ids, insecure URLs and escaped paths", async () => {
    const catalog = structuredClone(await loadConsoleReferences()) as ConsoleReferences;
    catalog.references[1]!.id = catalog.references[0]!.id;
    catalog.references[1]!.url = "http://example.test";
    catalog.references[1]!.localPath = "../outside";
    expect(await validateConsoleReferences(catalog)).toEqual(
      expect.arrayContaining([
        "references[1].id must be unique",
        "references[1].url must use HTTPS",
        "references[1].localPath escapes crates",
      ]),
    );
  });
});
