import { describe, expect, it } from "bun:test";
import { CONFIG_SCHEMA_VERSION, isVersionedConfigDocument } from "./config-contract.js";

describe("cfg.bin JSON contract", () => {
  it("accepts the versioned exchange envelope", () => {
    expect(
      isVersionedConfigDocument({
        buildid: 2799860,
        entries: [],
        generator: "iecode",
        schema_version: CONFIG_SCHEMA_VERSION,
      }),
    ).toBe(true);
  });

  it("rejects an unknown schema version", () => {
    expect(isVersionedConfigDocument({ entries: [], schema_version: 2 })).toBe(false);
  });

  it("keeps legacy raw entries compatible", () => {
    expect(isVersionedConfigDocument({ entries: [] })).toBe(false);
  });
});
