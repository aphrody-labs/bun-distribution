import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function bundledRoots(modulePath: string) {
  const source = readFileSync(new URL("./roots.ts", import.meta.url), "utf8");
  const transpiler = new Bun.Transpiler({
    loader: "ts",
    define: {
      "import.meta.dir": "undefined",
      "import.meta.url": JSON.stringify(pathToFileURL(modulePath).href),
    },
  });
  return import(`data:text/javascript;base64,${Buffer.from(transpiler.transformSync(source)).toString("base64")}`);
}

test("bundled source paths resolve to the owning checkout", async () => {
  const checkout = path.resolve(process.cwd(), "owner root % encoded");
  const roots = await bundledRoots(path.join(checkout, "packages/inagle/src/core/roots.ts"));
  expect(roots.iecodeRoot()).toBe(checkout);
  expect(roots.iecodePath("target", "release")).toBe(path.join(checkout, "target", "release"));
});
