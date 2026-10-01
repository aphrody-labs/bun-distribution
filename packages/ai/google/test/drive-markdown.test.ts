// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  nativeMarkdown,
  normalizeMarkdown,
  projectionAction,
  projectionMarkdown,
  type NativeDocument,
} from "../src/drive-markdown.ts";
const paragraph = (text: string) => ({ paragraph: { elements: [{ textRun: { content: text } }] } });
describe("read-only native Google Docs Markdown projection", () => {
  test("retains avatar smart chips and Github text links in flattened MCP snapshots", () => {
    const doc: NativeDocument = {
      tabs: [
        {
          title: "Identity",
          body: {
            content: [
              {
                paragraph: {
                  elements: [
                    {
                      richLink: {
                        richLinkProperties: {
                          title: "shenron.png",
                          uri: "https://drive.google.com/file/d/avatar/view",
                        },
                      },
                    },
                    {
                      textRun: {
                        content: " aphrody-labs",
                        textStyle: { link: { url: "https://github.com/aphrody-labs" } },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    };
    const md = nativeMarkdown(doc);
    expect(md).toContain("[shenron.png](https://drive.google.com/file/d/avatar/view)");
    expect(md).toContain("[aphrody-labs](https://github.com/aphrody-labs)");
  });
  test("walks all nested API tabs and renders headings and text styling", () => {
    const doc: NativeDocument = {
      tabs: [
        {
          tabProperties: { title: "Parent" },
          documentTab: {
            body: {
              content: [
                {
                  paragraph: {
                    paragraphStyle: { namedStyleType: "HEADING_1" },
                    elements: [{ textRun: { content: "Shenron\n", textStyle: { bold: true } } }],
                  },
                },
              ],
            },
          },
          childTabs: [
            {
              tabProperties: { title: "Child" },
              documentTab: { body: { content: [paragraph("Yoyo et Omar\n")] } },
            },
          ],
        },
      ],
    };
    const md = nativeMarkdown(doc);
    expect(md).toContain("## Parent");
    expect(md).toContain("# **Shenron**");
    expect(md).toContain("## Child");
    expect(md).toContain("Yoyo et Omar");
  });
  test("keeps nested bullet lists and numbered list start positions", () => {
    const doc: NativeDocument = {
      lists: {
        list: {
          listProperties: {
            nestingLevels: [{ glyphType: "DECIMAL", startNumber: 3 }, { glyphType: "BULLET" }],
          },
        },
      },
      body: {
        content: [
          { paragraph: { ...paragraph("first").paragraph, bullet: { listId: "list" } } },
          {
            paragraph: {
              ...paragraph("nested").paragraph,
              bullet: { listId: "list", nestingLevel: 1 },
            },
          },
          { paragraph: { ...paragraph("second").paragraph, bullet: { listId: "list" } } },
        ],
      },
    };
    const md = nativeMarkdown(doc);
    expect(md).toContain("3. first");
    expect(md).toContain("  - nested");
    expect(md).toContain("4. second");
  });
  test("preserves table cells and escapes pipe characters", () => {
    const md = nativeMarkdown({
      body: {
        content: [
          {
            table: {
              tableRows: [
                {
                  tableCells: [{ content: [paragraph("Name")] }, { content: [paragraph("Role")] }],
                },
                {
                  tableCells: [
                    { content: [paragraph("Shenron")] },
                    { content: [paragraph("Dragon | dbfr")] },
                  ],
                },
              ],
            },
          },
        ],
      },
    });
    expect(md).toContain("| Name | Role |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("Dragon \\| dbfr");
  });
  test("retains reviewed persona frontmatter and is idempotent UTF8 LF without BOM", () => {
    const local = '\uFEFF---\r\nidentity: "Shenron"\r\nbrevity: "terse"\r\n---\r\nold\r\n';
    const md = projectionMarkdown({ body: { content: [paragraph("Dragon\r\n")] } }, local);
    expect(md).toStartWith('---\nidentity: "Shenron"\nbrevity: "terse"\n---\n');
    expect(md).not.toContain("\r");
    expect(normalizeMarkdown(md)).toBe(md);
    expect(projectionMarkdown({ body: { content: [paragraph("Dragon\n")] } }, md)).toBe(md);
  });
  test("stages remote changes even when local is untouched and never trusts untracked local context", () => {
    expect(projectionAction({ remoteHash: "old", localHash: "local" }, "new", "local")).toBe(
      "stage",
    );
    expect(projectionAction({ remoteHash: "old", localHash: "local" }, "new", "modified")).toBe(
      "stage",
    );
    expect(projectionAction(undefined, "remote", "local")).toBe("stage");
    expect(projectionAction({ remoteHash: "same", localHash: "local" }, "same", "local")).toBe(
      "unchanged",
    );
    expect(projectionAction({ remoteHash: "same", localHash: "local" }, "same", "modified")).toBe(
      "local-ahead",
    );
  });
  test("rejects unsupported native content instead of silently deleting it", () => {
    expect(() =>
      nativeMarkdown({ body: { content: [{ paragraph: { elements: [{}] } }] } }),
    ).toThrow("Unsupported native element");
  });
});
