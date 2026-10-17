// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { transformComponent } from "../src/transform";

describe("migration syntax and runtime bindings", () => {
  test("inline action conversion preserves the complete function signature and body", () => {
    const source = `export default function Page() {
      async function save(formData: FormData) {
        "use server";
        return formData.get("name");
      }
      return <form action={save}/>;
    }`;
    const result = transformComponent(source, { target: "vite" });
    expect(result.code).toContain("async function save(formData: FormData) {");
    expect(result.code).toContain('return formData.get("name")');
    expect(result.warnings.join("\n")).toContain("native host adapter");
    expect(() => new Bun.Transpiler({ loader: "tsx" }).transformSync(result.code)).not.toThrow();
  });
  test("root containers merge dynamic classes once and remove valued hydration flags", () => {
    const source =
      'export default function RootLayout({ children }: { children: React.ReactNode }) { return <html className={font.className} suppressHydrationWarning={true}><body className="antialiased">{children}</body></html>; }';
    const result = transformComponent(source, { syncMetadataTitle: false });
    expect(result.code).toContain('className={["m3-app-root", font.className].filter(Boolean).join(" ")}');
    expect(result.code).toContain('className={["m3-app-body", "antialiased"].filter(Boolean).join(" ")}');
    expect(result.code.match(/font.className/g)).toHaveLength(1);
    expect(result.code).not.toContain("suppressHydrationWarning");
    expect(() => new Bun.Transpiler({ loader: "tsx" }).transformSync(result.code)).not.toThrow();
  });
  test("metadata injection supplies the runtime hook import and preserves existing imports", () => {
    const source = 'export const metadata = { title: "App" }; export default function Page() { return <h1>App</h1>; }';
    const result = transformComponent(source);
    expect(result.code).toContain("import { useMetadata } from '@aphrody/m3-next-migrate/shims/metadata'");
    expect(result.code).toContain("useMetadata(metadata)");
    expect(() => new Bun.Transpiler({ loader: "tsx" }).transformSync(result.code)).not.toThrow();
    const existing = transformComponent(
      "import { useMetadata } from '@aphrody/m3-next-migrate/shims/metadata';\n" + source,
    );
    expect(existing.code.match(/import \{ useMetadata \}/g)).toHaveLength(1);
  });
});
