// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fixtureCases, format, runCase } from "../scripts/fixtures";
import { transformSource } from "../src/index";
import { scanTsx } from "../lib/tsx-scan";

const transpiler = new Bun.Transpiler({ loader: "tsx" });

for (const c of fixtureCases()) {
  test(`fixture ${c.name} (${c.transform}) matches its expected output`, () => {
    const out = runCase(c);
    // Valid TSX, and a second pass changes nothing.
    expect(() => transpiler.transformSync(out)).not.toThrow();
    expect(runCase(c, out)).toBe(out);
    expect(format(out)).toBe(format(readFileSync(c.expectedPath, "utf8")));
  });
}

test("JSX is only recognised in expression position, not in strings, comments or type arguments", () => {
  const src = [
    'import { Button } from "@mui/material";',
    'const s = "<Button>";',
    "const t = `<Button>${s}</Button>`;",
    "// <Button>",
    "const n = g<number>(1) < 2;",
    "const id = <T,>(x: T) => x;",
    'export const A = () => <p>Don\'t <Button variant="text">go</Button> now</p>;',
  ].join("\n");
  const names = scanTsx(src).nodes.map((n) => n.rawName);
  expect(names).toEqual(["p", "Button"]);
  const out = transformSource(src).source;
  expect(out).toContain("<p>Don't <MdTextButton>go</MdTextButton> now</p>");
  expect(out).toContain('const s = "<Button>";');
});

test("invalid TSX is rejected instead of being rewritten", () => {
  expect(() =>
    transformSource('import { Button } from "@mui/material"; const x = <Button>;'),
  ).toThrow("TSX invalide");
});
