// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { migrationRequirements, assertMigrationRequirements } from "../src/requirements";

describe("native migration activation contracts", () => {
  test.each([
    ["app/actions.ts", '"use server"; export async function save(){}', "server-action adapter"],
    [
      "app/page.tsx",
      'import { cookies } from "next/headers"; export default function Page(){return null;}',
      "request context adapter",
    ],
    [
      "app/page.tsx",
      'import { Inter } from "next/font/google"; export const font = Inter({});',
      "font asset adapter",
    ],
    ["pages/index.tsx", "export default function Page(){return null;}", "Pages Router adapter"],
    [
      "app/api/item/route.ts",
      'export function GET(){ return new Response("ok"); }',
      "request host adapter",
    ],
    ["app/error.tsx", "export default function Error(){return null;}", "route boundary adapter"],
    [
      "app/page.tsx",
      'import { useRouter } from "next/router"; export default useRouter;',
      "Pages Router adapter",
    ],
    [
      "app/page.tsx",
      'import { useSelectedLayoutSegment } from "next/navigation"; export function Page(){return useSelectedLayoutSegment();}',
      "layout segment adapter",
    ],
    [
      "app/page.tsx",
      'import { readFile } from "node:fs/promises"; export const Page=readFile;',
      "backend module adapter",
    ],
    [
      "app/page.tsx",
      'import { revalidatePath } from "next/cache"; export const Page=revalidatePath;',
      "Next module adapter",
    ],
  ])("%s reports %s before activation", (file, source, expected) => {
    const requirements = migrationRequirements(file, source);
    expect(requirements.some((requirement) => requirement.capability === expected)).toBe(true);
    expect(() => assertMigrationRequirements(requirements)).toThrow(expected);
  });
  test("comments and illustrative strings do not create missing runtime requirements", () => {
    expect(
      migrationRequirements(
        "app/page.tsx",
        [
          '// "use server"; useSelectedLayoutSegment();',
          'const example = `\\n"use server";\\nuseSelectedLayoutSegment();`;',
          "export default function Page(){return <h1>{example}</h1>;}",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});
