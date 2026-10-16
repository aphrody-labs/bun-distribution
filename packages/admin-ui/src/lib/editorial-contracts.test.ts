// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import {
  DEFAULT_SITE_THEME,
  THEME_COLORS,
  THEME_COLOR_VARS,
  isDefaultTheme,
  resolveSiteTheme,
  themeCssVars,
} from "./site-theme";
import {
  formatTarget,
  parseTarget,
  parseWikiTargetId,
  wikiTargetId,
  isCommentSort,
  socialErrorMessage,
} from "./social-shared";
import { reportCategoryLabel, reportStatusLabel } from "./report-types";
import { normalizeSectionAccent, sectionAccent, sectionAccentStyle } from "./wiki-section-accents";
import { isContributableColumn, CONTRIBUTION_MAX, CONTRIBUTION_STATUS_LABELS } from "./contributions-shared";

// Pure contracts retained from apps/shenron/site/tests/site-theme.test.ts at 8172f535ce.
// Authenticated host CSS integration is a separate gate, not reproduced by a fixture.
test("theme metadata covers every editable token and preserves historical accents", () => {
  const editableKeys: string[] = THEME_COLORS.map(c => c.key);
  expect(editableKeys.toSorted()).toEqual(Object.keys(THEME_COLOR_VARS).toSorted());
  expect(DEFAULT_SITE_THEME.colors.ember).toBe("#ff6b1a");
  expect(DEFAULT_SITE_THEME.colors.ki).toBe("#4ba8ff");
  expect(DEFAULT_SITE_THEME.colors.amber).toBe("#ffd23f");
});

test("older saved theme documents preserve newly introduced defaults", () => {
  const theme = resolveSiteTheme({ version: 1, radius: 0.5, colors: { orange: "#00ff00" } });
  expect(theme.colors.orange).toBe("#00ff00");
  expect(theme.colors.ember).toBe(DEFAULT_SITE_THEME.colors.ember);
  expect(isDefaultTheme(theme)).toBe(false);
});

test("theme rejects unsafe color input without discarding valid colors", () => {
  const theme = resolveSiteTheme({ colors: { ki: "javascript:alert(1)", amber: "#123456" }, radius: 99 });
  expect(theme.colors.ki).toBe(DEFAULT_SITE_THEME.colors.ki);
  expect(theme.colors.amber).toBe("#123456");
  expect(theme.radius).toBe(2);
});

test("default theme emits nothing and changed theme emits all variables", () => {
  expect(themeCssVars(DEFAULT_SITE_THEME)).toBe("");
  const css = themeCssVars(resolveSiteTheme({ colors: { ember: "#123456" } }));
  for (const variable of Object.values(THEME_COLOR_VARS)) expect(css).toContain(`${variable}:`);
  expect(css).toContain("--dbz-ember:#123456");
});

test("social targets retain stable database IDs and reject malformed input", () => {
  const id = wikiTargetId("db_characters", 42);
  expect(parseWikiTargetId(id)).toEqual({ table: "db_characters", rowId: "42" });
  expect(parseTarget(formatTarget({ kind: "wiki", id }))).toEqual({ kind: "wiki", id });
  for (const raw of [null, "", "unknown:42", "wiki:", `post:${"x".repeat(161)}`]) expect(parseTarget(raw)).toBeNull();
  expect(parseWikiTargetId("db_characters#")).toBeNull();
  expect(isCommentSort("recent")).toBe(true);
  expect(isCommentSort("unsupported")).toBe(false);
  expect(socialErrorMessage("forbidden")).toBe("Action réservée.");
});

test("report labels preserve known values and unknown-key fallback", () => {
  expect(reportCategoryLabel("bug")).toBe("Bug / dysfonctionnement");
  expect(reportStatusLabel("open")).toBe("Ouvert");
  expect(reportCategoryLabel("future")).toBe("future");
  expect(reportStatusLabel("future")).toBe("future");
});

test("section accents preserve matching priority and safe unknown fallback", () => {
  expect(sectionAccent("Puissance et transformations")).toBe("red");
  expect(sectionAccent("Super Saiyan")).toBe("purple");
  expect(normalizeSectionAccent("unsupported")).toBe("orange");
  expect(sectionAccentStyle(null)).toEqual(sectionAccentStyle("orange"));
});

test("contribution contract preserves allowed fields and bounded editorial text", () => {
  expect(isContributableColumn("article")).toBe(true);
  expect(isContributableColumn("userId")).toBe(false);
  expect(CONTRIBUTION_MAX).toBe(40000);
  expect(Object.keys(CONTRIBUTION_STATUS_LABELS).length).toBeGreaterThan(0);
});
