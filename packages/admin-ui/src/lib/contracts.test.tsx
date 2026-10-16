// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PlainField } from "../components/editor/PlainField";
import { TABLE_LABELS, colLabel } from "./db-labels";
import { toMillis, toSeconds, yearOf } from "./epoch";
import { extractYoutubeId, youtubeEmbedUrl, youtubeThumbUrl } from "./youtube";

test("historical wiki timestamps accept seconds and pre-2001 milliseconds", () => {
  const milliseconds = Date.UTC(1996, 6, 15);
  expect(toMillis(milliseconds / 1000)).toBe(milliseconds);
  expect(toMillis(milliseconds)).toBe(milliseconds);
  expect(toSeconds(milliseconds + 999)).toBe(milliseconds / 1000);
  expect(toSeconds(milliseconds / 1000)).toBe(milliseconds / 1000);
  expect(yearOf(milliseconds)).toBe(1996);
  expect(yearOf(null)).toBeNull();
  expect(yearOf(undefined)).toBeNull();
  expect(yearOf(Number.NaN)).toBeNull();
});

test("YouTube contract validates IDs and accepts historical public URL forms", () => {
  const id = "dQw4w9WgXcQ";
  for (const input of [
    id,
    `https://youtu.be/${id}`,
    `youtube.com/watch?v=${id}`,
    `https://m.youtube.com/shorts/${id}`,
    `https://youtube-nocookie.com/embed/${id}`,
    `https://youtube.com/live/${id}`,
  ]) {
    expect(extractYoutubeId(input)).toBe(id);
    expect(youtubeEmbedUrl(input)).toBe(`https://www.youtube-nocookie.com/embed/${id}`);
    expect(youtubeThumbUrl(input)).toBe(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  }
  for (const input of ["", "invalid", `https://example.org/watch?v=${id}`, "https://youtube.com/embed/short"]) {
    expect(extractYoutubeId(input)).toBeNull();
    expect(youtubeEmbedUrl(input)).toBeNull();
    expect(youtubeThumbUrl(input)).toBeNull();
  }
});

test("wiki labels retain editorial labels and unknown-column fallback", () => {
  expect(TABLE_LABELS.db_characters).toBe("Personnages");
  expect(colLabel("user_id")).toBe("Joueur");
  expect(colLabel("unknown_columnName")).toBe("unknown column Name");
});

test("PlainField preserves accessible controlled and initial text markup", () => {
  const html = renderToStaticMarkup(
    <PlainField
      id="editor"
      label="Article"
      hint="Texte brut"
      value="Canon"
      defaultValue="Ignored"
      maxLength={10}
      required
    />,
  );
  expect(html).toContain('for="editor"');
  expect(html).toContain('aria-describedby="editor-desc"');
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain("Canon</textarea>");
  expect(html).not.toContain("Ignored");
  expect(renderToStaticMarkup(<PlainField defaultValue="Draft" disabled readOnly />)).toContain("Draft</textarea>");
});
