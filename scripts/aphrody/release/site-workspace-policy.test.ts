// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("the public site workspace closes its Neon dependency and retains the exact first-party age policy", () => {
  const root = join(import.meta.dir, "../../../docs/aphrody");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  expect(manifest.workspaces.packages).toContain(
    "../bun/packages/bun-plugin-neon",
  );
  expect(manifest.workspaces.packages).toContain("../bun/packages/bun-types");
  const config = Bun.TOML.parse(
    readFileSync(join(root, "bunfig.toml"), "utf8"),
  );
  if (
    !("install" in config) ||
    config.install === null ||
    typeof config.install !== "object"
  )
    throw new Error("Installation policy is required");
  const policy = config.install;
  expect(
    "minimumReleaseAge" in policy ? policy.minimumReleaseAge : undefined,
  ).toBe(259200);
  const exceptions =
    "minimumReleaseAgeExcludes" in policy
      ? policy.minimumReleaseAgeExcludes
      : undefined;
  expect(exceptions).toContain("@aphrody/typesafe-sdk");
  expect(exceptions).not.toContain("@aphrody/*");
  const web = JSON.parse(
    readFileSync(join(root, "../bun/packages/web/package.json"), "utf8"),
  );
  expect(web.dependencies["@aphrody/typesafe-sdk"]).toBe("0.6.2");
  const lock = readFileSync(join(root, "bun.lock"), "utf8");
  expect(lock).toContain('"@aphrody/typesafe-sdk@0.6.2"');
  expect(lock).toContain(
    "sha512-Pnj7gUKWCcTjztzmMBVLX7FNGJVlJKfrwuE3pLDnjGABlZHW7/wb6SakGllIAz65Qjx7+oYd+MYxWbxEpGyVRw==",
  );
});
