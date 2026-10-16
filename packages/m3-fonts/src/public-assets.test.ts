// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import {
  FONTS,
  publicFontUrl,
  renderPublicStylesheet,
  renderStylesheet,
} from "./index";
const base = "https://assets.aphrody.app";
test("public font sheets preserve manifest face metadata and map flat R2 names", () => {
  for (const sheet of ["core", "jp", "symbols"] as const) {
    const css = renderPublicStylesheet(base, sheet);
    for (const face of FONTS.filter((font) => font.sheet === sheet).flatMap(
      (font) => font.faces,
    )) {
      expect(css).toContain(publicFontUrl(face.file, base));
      expect(css).toContain(`font-weight: ${face.weight[0]} ${face.weight[1]}`);
    }
    expect(renderStylesheet("../", sheet)).not.toContain("r2.dev");
  }
  expect(() => publicFontUrl("secret.txt", base)).toThrow();
  expect(() =>
    publicFontUrl("font.woff2", "https://user:secret@example.com"),
  ).toThrow();
});
