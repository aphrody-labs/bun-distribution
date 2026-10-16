import { describe, expect, test } from "bun:test";
import { analyze } from "../scripts/check-css-equivalence";
import { judge, PRIMITIVE, total } from "../scripts/check-dashboard-css";
import { resolveCssHost } from "../scripts/css-host";

// This host integration gate requires the real dashboard checkout explicitly.
const dashboard = resolveCssHost("--dashboard-root", "SHENRON_DASHBOARD_ROOT", ["styles.css"]);
const dashboardCss = await Bun.file(dashboard.stylesheet).text();

const BASE = `
@layer theme { :root { --color-dbz-bg: #050a15; --radius-lg: .5rem; } }
@layer base { * { border-color: var(--color-dbz-border); } }
@layer components {
	.card { border-width: 2px; border-radius: 0; box-shadow: 4px 4px #0b3088cc; }
	.btn-ghost { color: var(--color-brand-400); }
}
@layer utilities { .p-6 { padding: 1.5rem; } }
`;

const verdict = (next: string) => judge(analyze(BASE), analyze(next));

describe("dashboard styles.css", () => {
  test("imports the shared layer after Tailwind and scans the package sources", () => {
    const tw = dashboardCss.indexOf('@import "tailwindcss";');
    const ui = dashboardCss.indexOf('@import "@shenron/ui/styles.css";');
    expect(tw).toBeGreaterThanOrEqual(0);
    expect(ui).toBeGreaterThan(tw);
    expect(dashboardCss).toContain('@source "../../../../../m3/packages/shenron-ui/src";');
  });

  test("keeps the blue palette and square primitives", () => {
    for (const token of [
      "--color-dbz-blue: #0b3088;",
      "--color-dbz-blue-light: #1c55c0;",
      "--color-dbz-bg: #050a15;",
      "--color-dbz-card: #0a1128;",
      "--color-dbz-border: #142850;",
    ])
      expect(dashboardCss).toContain(token);
    expect(dashboardCss.match(/border-radius: 0;/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});

describe("check-dashboard-css verdict", () => {
  test("identical stylesheets pass", () => {
    expect(total(verdict(BASE).failures)).toBe(0);
  });

  test("a removed conditional pair already overridden by an unchanged winner is inert", () => {
    const shadowed = `${BASE}\n@layer components { @supports (color: color-mix(in lab, red, red)) { .card:hover { border-color: color-mix(in srgb, red 60%, blue); } } .card:hover { border-color: blue; } }`;
    const kept = `${BASE}\n@layer components { .card:hover { border-color: blue; } }`;
    expect(judge(analyze(shadowed), analyze(kept)).failures.removed.length).toBe(0);
    const changed = `${BASE}\n@layer components { .card:hover { border-color: gold; } }`;
    expect(total(judge(analyze(shadowed), analyze(changed)).failures)).toBeGreaterThan(0);
    const unshadowed = `${BASE}\n@layer components { @supports (color: color-mix(in lab, red, red)) { .card:hover { border-color: red; } } }`;
    expect(judge(analyze(unshadowed), analyze(BASE)).failures.removed.length).toBe(1);
  });

  test("a changed primitive value fails", () => {
    const { failures } = verdict(BASE.replace("border-radius: 0", "border-radius: .75rem"));
    expect(failures.changed.length).toBe(1);
  });

  test("an effective addition on a primitive fails, an inert one passes", () => {
    const lifted = verdict(
      BASE.replace(".btn-ghost {", ".btn-ghost:hover { transform: translate(-1px, -1px); } .btn-ghost {"),
    );
    expect(lifted.failures.added.length).toBe(1);
    const neutral = verdict(
      BASE.replace(
        ".btn-ghost {",
        ".card { position: static; } .btn-ghost:hover { color: var(--color-brand-400); } .btn-ghost {",
      ),
    );
    expect(total(neutral.failures)).toBe(0);
    expect(neutral.tolerated.added).toBe(2);
  });

  test("an @supports addition is inert only when a later plain rule restores the value", () => {
    const supports =
      "@supports (color: color-mix(in lab, red, red)) { .card { border-color: color-mix(in oklab, #000 80%, transparent); } }";
    const overridden = verdict(
      BASE.replace(
        "@layer components {",
        `@layer components {\n${supports}\n.card { border-color: var(--color-dbz-border); }`,
      ),
    );
    expect(total(overridden.failures)).toBe(0);
    const leaked = verdict(BASE.replace("@layer components {", `@layer components {\n${supports}`));
    expect(leaked.failures.added.length).toBe(1);
  });

  test("a site palette on :root fails unless it restates the dashboard value", () => {
    const site = verdict(`${BASE}\n:root { --color-dbz-bg: var(--dbz-bg, #0a0a0a); }`);
    expect(site.failures.added.length).toBe(1);
    const pinned = verdict(`${BASE}\n:root { --color-dbz-bg: #050a15; }`);
    expect(total(pinned.failures)).toBe(0);
    const fresh = verdict(`${BASE}\n:root { --color-dbz-orange: #e78220; }`);
    expect(total(fresh.failures)).toBe(0);
  });

  test("non-primitive additions (package utilities) are tolerated", () => {
    const { failures, tolerated } = verdict(
      `${BASE}\n@layer utilities { .shadow-comic { box-shadow: 3px 3px #000; } }`,
    );
    expect(total(failures)).toBe(0);
    expect(tolerated.added).toBe(1);
  });

  test("PRIMITIVE matches the dashboard primitives and their states only", () => {
    for (const s of [
      ".card",
      ".card:hover",
      ".btn",
      ".btn-ghost:active",
      ".input:focus",
      "select.input",
      ".badge-warning",
    ])
      expect(PRIMITIVE.test(s)).toBe(true);
    for (const s of [".cardinal", ".btn2", ".input-group", ".shadow-comic", ":root"])
      expect(PRIMITIVE.test(s)).toBe(false);
  });
});
