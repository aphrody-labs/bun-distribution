// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  checkMirror,
  checkPins,
  checkRemote,
  expand,
  type Identity,
  type UpstreamSources,
  type Vendor,
} from "./vu-pins.ts";

const ROOT = resolve(import.meta.dir, "../../../../docs/aphrody");
const identity = (await Bun.file(
  `${ROOT}/docs/plans/vu/scaffold/vu.json`,
).json()) as Identity;
const vendor = (await Bun.file(
  `${ROOT}/docs/plans/vu/scaffold/vendor.json`,
).json()) as Vendor;
const upstream = (await Bun.file(
  `${ROOT}/tools/config/upstream-sources.json`,
).json()) as UpstreamSources;

const clone = <T>(value: T): T => structuredClone(value);
const failing = (): unknown => {
  throw new Error("HTTP 404");
};

describe("vu-pins", () => {
  test("the runtime name is vu, written once", () => {
    expect(identity.name).toBe("vu");
    expect(
      expand(identity.derived["forkPinBranch"]!, {
        name: identity.name,
        version: "0.12.23",
      }),
    ).toBe("vu-pin-0.12.23");
    expect(
      expand(identity.derived["environmentPrefix"]!, { name: identity.name }),
    ).toBe("VU_");
    expect(
      expand(identity.derived["receiptSchema"]!, { name: identity.name }),
    ).toBe("aphrody.vu-forge/1");
  });

  test("the committed pins and the provenance manifest agree", () => {
    expect(checkPins(identity, vendor, upstream)).toEqual([]);
    expect(vendor.sources.map((source) => source.name)).toEqual([
      "uv",
      "ruff",
      "pyo3",
    ]);
    for (const source of vendor.sources)
      expect(source.forkBranch.startsWith("vu-pin-")).toBe(true);
  });

  test("a moved pin, a wrong branch name and a missing entry are reported", () => {
    const moved = clone(vendor);
    moved.sources[0]!.ref = "0".repeat(40);
    expect(
      checkPins(identity, moved, upstream).some((p) =>
        p.includes("crates.io vcs sha"),
      ),
    ).toBe(true);
    expect(
      checkPins(identity, moved, upstream).some((p) =>
        p.includes("forkCommit"),
      ),
    ).toBe(true);

    const renamed = clone(vendor);
    renamed.sources[1]!.forkBranch = "ir-pin-0.16.10";
    expect(checkPins(identity, renamed, upstream)).toContain(
      "vendor.json ruff: forkBranch ir-pin-0.16.10 must be vu-pin-0.16.10",
    );

    const missing = clone(upstream);
    missing.reference = missing.reference!.filter(
      (entry) => entry.id !== "vu-pyo3",
    );
    expect(checkPins(identity, vendor, missing)).toContain(
      "tools/config/upstream-sources.json: missing reference vu-pyo3",
    );
  });

  test("renaming the runtime only touches the identity and the derived names", () => {
    const renamed = clone(identity);
    renamed.name = "xy";
    const problems = checkPins(renamed, vendor, upstream);
    expect(problems.some((p) => p.includes("must be xy-pin-0.12.23"))).toBe(
      true,
    );
    expect(problems).toContain(
      "tools/config/upstream-sources.json: missing reference xy-uv",
    );
    expect(
      checkPins({ ...identity, name: "Not A Name" }, vendor, upstream)[0],
    ).toContain("invalid runtime name");
  });

  test("an orphan reference of the vu family is refused", () => {
    const orphan = clone(upstream);
    orphan.reference!.push({ id: "vu-ty", tier: "build" });
    expect(checkPins(identity, vendor, orphan)).toContain(
      "tools/config/upstream-sources.json: vu-ty has no pin in vendor.json",
    );
  });

  test("remote verification compares the fork branch and the upstream tag with the pin", () => {
    const good = (route: string): unknown => {
      const source = vendor.sources.find(
        (s) =>
          route.includes(`/${s.forkBranch}`) ||
          route.endsWith(`/commits/${s.upstreamTag}`),
      )!;
      return route.includes("/branches/")
        ? { commit: { sha: source.ref } }
        : { sha: source.ref };
    };
    expect(checkRemote(vendor, good)).toEqual([]);
    const bad = (route: string): unknown =>
      route.includes("/branches/")
        ? { commit: { sha: "f".repeat(40) } }
        : good(route);
    expect(checkRemote(vendor, bad).length).toBe(vendor.sources.length);
    expect(checkRemote(vendor, failing)[0]).toContain("HTTP 404");
  });

  test("the private repository must carry byte-identical pins", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vu-mirror-"));
    try {
      expect(await checkMirror(dir)).toEqual([
        "vu repository: vendor.json is missing",
        "vu repository: vu.json is missing",
      ]);
      writeFileSync(
        join(dir, "vendor.json"),
        await Bun.file(`${ROOT}/docs/plans/vu/scaffold/vendor.json`).text(),
      );
      writeFileSync(
        join(dir, "vu.json"),
        await Bun.file(`${ROOT}/docs/plans/vu/scaffold/vu.json`).text(),
      );
      expect(await checkMirror(dir)).toEqual([]);
      writeFileSync(join(dir, "vu.json"), "{}\n");
      expect(await checkMirror(dir)).toEqual([
        "vu repository: vu.json differs from the mirror in docs/plans/vu/scaffold",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
