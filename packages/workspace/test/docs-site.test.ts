// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exportDocumentationSite,
  type SiteDocument,
} from "../src/docs-site.ts";

async function fixture(
  run: (root: string, documents: SiteDocument[]) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "documentation-site-"));
  try {
    await mkdir(join(root, "docs/guides"), { recursive: true });
    const sources = [
      {
        path: "docs/guides/a.md",
        title: "Guide A",
        text: '# Guide A\n[Guide B](b.md)\n[Code](../../src/private.ts)\n<script>alert(1)</script>\n<img src="https://example.com/pixel">\n[Bad](javascript:alert)\n```html\n<script>example</script>\n```',
      },
      {
        path: "docs/guides/b.md",
        title: "Guide B",
        text: "# Guide B\n[Guide A](a.md)",
      },
    ];
    // oxlint-disable-next-line no-await-in-loop -- fixture documents are written in order before the export under test
    for (const source of sources)
      await writeFile(join(root, source.path), source.text);
    await run(
      root,
      sources.map(({ path, title, text }) => ({
        path,
        title,
        sha256: createHash("sha256").update(text).digest("hex"),
      })),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("private documentation site", () => {
  test("exports provenance, local navigation and inert Markdown/HTML", async () => {
    await fixture(async (root, documents) => {
      const output = join(root, ".cache/documentation-site");
      expect(await exportDocumentationSite(root, documents, output)).toEqual({
        pages: 2,
        output,
      });
      const html = await readFile(
        join(output, "docs/guides/a.md.html"),
        "utf8",
      );
      expect(html).toContain('href="b.md.html"');
      expect(html).toContain('href="a.md"');
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).not.toContain("<script>");
      expect(html).not.toContain('href="javascript:');
      expect(html).not.toContain('href="../../src/private.ts"');
      expect(html).not.toContain("<img");
      expect(html).toContain("Content-Security-Policy");
      expect(html).toContain("noindex,nofollow,noarchive");
      expect(await readFile(join(output, documents[0]!.path), "utf8")).toEqual(
        await readFile(join(root, documents[0]!.path), "utf8"),
      );
      expect(
        JSON.parse(await readFile(join(output, "export-manifest.json"), "utf8"))
          .visibility,
      ).toBe("private");
      expect(await readFile(join(output, "llms.txt"), "utf8")).toContain(
        "docs/guides/a.md",
      );
      expect(await readFile(join(output, "llms-full.txt"), "utf8")).toContain(
        documents[0]!.sha256,
      );
      expect(await exportDocumentationSite(root, documents, output)).toEqual({
        pages: 2,
        output,
      });
    });
  });
  test("rejects unsafe output, traversal and SHA mismatch before writes", async () => {
    await fixture(async (root, documents) => {
      for (const destination of [
        root,
        join(root, "docs/export"),
        join(root, "apps/site/public"),
      ]) {
        // oxlint-disable-next-line no-await-in-loop -- export destinations are checked one by one; each export is asserted before the next
        await expect(
          exportDocumentationSite(root, documents, destination),
        ).rejects.toThrow("Output");
      }
      await expect(
        exportDocumentationSite(
          root,
          [{ ...documents[0]!, sha256: "0".repeat(64) }],
          join(root, ".cache/documentation-site"),
        ),
      ).rejects.toThrow("SHA mismatch");
      await expect(
        exportDocumentationSite(
          root,
          [{ ...documents[0]!, path: "docs/../secret.md" }],
          join(root, ".cache/documentation-site"),
        ),
      ).rejects.toThrow("Invalid documentation path");
    });
  });
  test("refuses source/output symlinks and foreign files", async () => {
    await fixture(async (root, documents) => {
      const output = join(root, ".cache/documentation-site");
      await mkdir(output, { recursive: true });
      await writeFile(join(output, "keep.txt"), "owned by another tool");
      await expect(
        exportDocumentationSite(root, documents, output),
      ).rejects.toThrow();
      expect(await readFile(join(output, "keep.txt"), "utf8")).toBe(
        "owned by another tool",
      );
      await symlink(
        join(root, "docs/guides/a.md"),
        join(root, "docs/guides/link.md"),
      );
      await expect(
        exportDocumentationSite(
          root,
          [{ ...documents[0]!, path: "docs/guides/link.md" }],
          output,
        ),
      ).rejects.toThrow("Symlink refused");
      await symlink(output, join(root, "linked-output"));
      await expect(
        exportDocumentationSite(root, documents, join(root, "linked-output")),
      ).rejects.toThrow("Symlink refused");
    });
  });
  test("accepts an explicitly selected empty directory outside the repository", async () => {
    const output = await mkdtemp(join(tmpdir(), "private-docs-out-"));
    try {
      await fixture(async (root, documents) => {
        expect(
          (await exportDocumentationSite(root, documents, output)).pages,
        ).toBe(2);
      });
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  });
});
