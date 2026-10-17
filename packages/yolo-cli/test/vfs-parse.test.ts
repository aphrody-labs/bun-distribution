import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTsSource, renderParseMarkdown } from "../../yolo-core/src/vfs/parse.ts";

const directories: string[] = [];

async function fixture(source: string | Uint8Array, filename = "fixture.ts"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "yolo-module-parse-"));
  directories.push(directory);
  const path = join(directory, filename);
  await Bun.write(path, source);
  return path;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("canonical VFS module parsing", () => {
  test("does not interpret comments, strings, templates or regular expressions as modules", async () => {
    const path = await fixture(
      [
        "// export const commented = 1; from 'line-comment'",
        "/* import { fake } from 'block-comment'; export { fake as ghost }; */",
        "const text = \"export class Ghost {} from 'string-module'\";",
        "const template = `export type Ghost = string; from 'template-module'`;",
        "const pattern = /export\\s+const\\s+fake|from 'regex-module'/;",
        "export const actual = text + template + pattern;",
      ].join("\n"),
    );
    const parsed = await parseTsSource(path);
    expect(parsed.exports).toEqual(["actual"]);
    expect(parsed.imports).toEqual([]);
  });

  test("keeps static imports and reexports in source order, including side effects and types", async () => {
    const path = await fixture(
      [
        'import "side-effect";',
        'export { value as PublicValue, type Thing as PublicThing } from "public";',
        'import Default, { item } from "normal";',
        'import type { Type } from "types";',
        'export * from "all";',
        'export * as namespace from "namespace";',
        'export type * from "all-types";',
        'import "side-effect";',
      ].join("\n"),
    );
    const parsed = await parseTsSource(path);
    expect(parsed.imports).toEqual([
      "side-effect",
      "public",
      "normal",
      "types",
      "all",
      "namespace",
      "all-types",
      "side-effect",
    ]);
    expect(parsed.exports).toEqual(["PublicValue", "PublicThing", "*", "namespace"]);
  });

  test("reports public names for defaults, destructured variables and TypeScript declarations", async () => {
    const path = await fixture(
      [
        "export interface Config { value: string }",
        "export type Alias = Config;",
        "export enum Mode { A, B }",
        "export declare function declared(value: Config): Alias;",
        "export abstract class Abstract {}",
        "export const { original: renamed, ...rest } = input, [first, , ...remaining] = values;",
        "const local = 1;",
        'export { local as "with-space" };',
        "export default function privateName() {}",
      ].join("\n"),
    );
    const parsed = await parseTsSource(path);
    expect(parsed.exports).toEqual([
      "Config",
      "Alias",
      "Mode",
      "declared",
      "Abstract",
      "renamed",
      "rest",
      "first",
      "remaining",
      "with-space",
      "default",
    ]);
    expect(parsed.exports).not.toContain("privateName");
  });

  test("does not count an exported imported binding twice or reorder it before earlier exports", async () => {
    const path = await fixture(
      [
        'import { original as local } from "shared";',
        "export const first = 1;",
        "export { local as publicName };",
        'export { other as last } from "shared";',
        'import "shared";',
      ].join("\n"),
    );
    const parsed = await parseTsSource(path);
    expect(parsed.exports).toEqual(["first", "publicName", "last"]);
    expect(parsed.imports).toEqual(["shared", "shared", "shared"]);
  });

  test("supports JSX and declaration files using their filename syntax", async () => {
    const jsx = await parseTsSource(await fixture('import React from "react"; export default <div />;', "fixture.jsx"));
    expect(jsx.exports).toEqual(["default"]);
    expect(jsx.imports).toEqual(["react"]);
    const declaration = await parseTsSource(
      await fixture(
        "export declare interface Public { value: number }\nexport declare const value: Public;",
        "fixture.d.ts",
      ),
    );
    expect(declaration.exports).toEqual(["Public", "value"]);
  });

  test("deduplicates merged type exports and preserves raw byte metrics with a BOM", async () => {
    const source = "\uFEFFexport interface Café { a: string }\nexport interface Café { b: number }\n";
    const raw = new TextEncoder().encode(source);
    const path = await fixture(raw);
    const parsed = await parseTsSource(path);
    expect(parsed.path).toBe(path);
    expect(parsed.exports).toEqual(["Café"]);
    expect(parsed.bytes).toBe(raw.byteLength);
    expect(parsed.lines).toBe(3);
    expect(parsed.checksum).toBe(Bun.hash.wyhash(raw).toString(16));
    expect(parsed.parseTimeMs).toBeGreaterThanOrEqual(0);
    const markdown = renderParseMarkdown(parsed);
    expect(markdown).toContain("Café");
    expect(markdown).toContain(parsed.checksum);
  });

  test("rejects malformed syntax rather than returning a partial module inventory", async () => {
    const path = await fixture("export const = ;");
    await expect(parseTsSource(path)).rejects.toBeInstanceOf(SyntaxError);
    await expect(parseTsSource(path)).rejects.toThrow(`Cannot parse ${path}:`);
  });

  test("handles an empty module and rejects invalid UTF-8", async () => {
    const empty = await parseTsSource(await fixture(""));
    expect(empty.bytes).toBe(0);
    expect(empty.lines).toBe(0);
    expect(empty.exports).toEqual([]);
    expect(empty.imports).toEqual([]);
    const invalid = await fixture(new Uint8Array([0xff, 0xfe]));
    await expect(parseTsSource(invalid)).rejects.toBeInstanceOf(TypeError);
  });
});
