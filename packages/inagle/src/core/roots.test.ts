import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const rootKeys = ["APHRODY_IECODE_ROOT", "IECODE_ROOT", "NIE_ROOT", "NIERS_ROOT"] as const;

async function bundledRoots(modulePath: string) {
  const source = readFileSync(new URL("./roots.ts", import.meta.url), "utf8");
  const transpiler = new Bun.Transpiler({
    loader: "ts",
    define: {
      "import.meta.dir": "undefined",
      "import.meta.url": JSON.stringify(pathToFileURL(modulePath).href),
    },
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(transpiler.transformSync(source)).toString("base64")}`
  );
}

test("bundled checkout discovery decodes file URLs and Windows drive paths", async () => {
  const original = rootKeys.map((key) => process.env[key]);
  try {
    for (const key of rootKeys) delete process.env[key];
    const checkout = path.resolve(process.cwd(), "owner root % encoded");
    const roots = await bundledRoots(path.join(checkout, "packages/inagle/src/core/roots.ts"));
    expect(roots.iecodeRoot()).toBe(checkout);
    expect(roots.iecodePath("target", "release")).toBe(path.join(checkout, "target", "release"));
  } finally {
    for (const [index, key] of rootKeys.entries()) {
      if (original[index] === undefined) delete process.env[key];
      else process.env[key] = original[index];
    }
  }
});

test("bundled native search respects the explicit selected checkout", async () => {
  const original = process.env.APHRODY_IECODE_ROOT;
  try {
    const checkout = path.resolve(process.cwd(), "selected checkout");
    process.env.APHRODY_IECODE_ROOT = checkout;
    const roots = await bundledRoots(path.resolve(process.cwd(), "bundle/core/roots.ts"));
    expect(roots.iecodeRoot()).toBe(checkout);
    expect(roots.iecodePath("target", "debug")).toBe(path.join(checkout, "target", "debug"));
  } finally {
    if (original === undefined) delete process.env.APHRODY_IECODE_ROOT;
    else process.env.APHRODY_IECODE_ROOT = original;
  }
});
