// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { migrateApp, migrateNext } from "../src/tools-migrate.ts";
import { cleanup, tmp } from "./helpers.ts";

afterAll(cleanup);

const MUI =
  'import Button from "@mui/material/Button";\nexport const A = () => <Button variant="contained">Go</Button>;\n';
const ICONS = 'import HomeIcon from "@mui/icons-material/Home";\nexport const B = () => <HomeIcon />;\n';

function app(): string {
  const dir = tmp("m3-bun-migrate-");
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
  writeFileSync(join(dir, "src", "a.tsx"), MUI);
  writeFileSync(join(dir, "src", "b.tsx"), ICONS);
  writeFileSync(join(dir, "src", "plain.tsx"), "export const C = () => <p>c</p>;\n");
  writeFileSync(join(dir, "node_modules", "x", "a.tsx"), MUI);
  return dir;
}

describe("migrateApp", () => {
  test("a dry run reports the MUI files the codemods would change and writes nothing", async () => {
    const dir = app();
    const report = await migrateApp({ dir, dryRun: true });
    expect(report).toEqual({ changed: [{ path: "src/a.tsx", diagnostics: [] }], scanned: 3, dryRun: true });
    expect(readFileSync(join(dir, "src", "a.tsx"), "utf8")).toBe(MUI);
  });

  test("writes the @aphrody/m3-react version in place, never inside node_modules", async () => {
    const dir = app();
    const report = await migrateApp({ dir });
    expect(report.changed.map(file => file.path)).toEqual(["src/a.tsx"]);
    expect(readFileSync(join(dir, "src", "a.tsx"), "utf8")).toBe(
      'import { MdFilledButton } from "@aphrody/m3-react";\nexport const A = () => <MdFilledButton>Go</MdFilledButton>;\n',
    );
    expect(readFileSync(join(dir, "node_modules", "x", "a.tsx"), "utf8")).toBe(MUI);
    expect((await migrateApp({ dir })).changed).toEqual([]);
  });

  test("icons turns MUI icons into md-icon ligatures", async () => {
    const dir = app();
    const report = await migrateApp({ dir, kind: "icons", glob: "src/b.tsx" });
    expect(report.scanned).toBe(1);
    expect(report.changed.map(file => file.path)).toEqual(["src/b.tsx"]);
    const source = readFileSync(join(dir, "src", "b.tsx"), "utf8");
    expect(source).toContain('import "@aphrody/material-web/icon/icon.js";');
    expect(source).toContain("<md-icon>home</md-icon>");
  });
});

function nextApp(): string {
  const dir = tmp("m3-bun-next-");
  mkdirSync(join(dir, "next", "app"), { recursive: true });
  writeFileSync(
    join(dir, "next", "package.json"),
    JSON.stringify({ name: "mini-next", dependencies: { next: "15.0.0" } }),
  );
  writeFileSync(
    join(dir, "next", "app", "page.tsx"),
    "export default function Page() { return <main>Hello</main>; }\n",
  );
  writeFileSync(
    join(dir, "next", "app", "layout.tsx"),
    "export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n",
  );
  return dir;
}


describe("migrateNext", () => {
  test("a dry run scans the routes and layouts without creating the target", async () => {
    const dir = nextApp();
    const report = await migrateNext({ source: join(dir, "next"), target: join(dir, "out") });
    expect(report.hierarchy.routes.map(route => [route.routePath, route.pageFile, route.layouts])).toEqual([
      ["/", "app/page.tsx", ["app/layout.tsx"]],
    ]);
    expect(report.stats.pages).toEqual(["app/page.tsx"]);
    expect(report.transformDetails.map(detail => detail.file)).toEqual(["app/layout.tsx"]);
    expect(existsSync(join(dir, "out"))).toBe(false);
  });

  test("write goes through the workspace guard of the migrator: only a declared apps/* member is written", async () => {
    const dir = nextApp();
    await expect(
      migrateNext({ source: join(dir, "next"), target: join(dir, "out"), name: "mini", write: true }),
    ).rejects.toThrow(/private owner workspace required/);
    expect(existsSync(join(dir, "out"))).toBe(false);
  });
});
