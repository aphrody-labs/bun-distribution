import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as I from "../src/icones";
import { NOMS_ICONES, svgIcone } from "../src/icones";

// Expected markup captured from the site components (apps/shenron/site/src/components/icones)
// before the move into @shenron/ui (wave 3, W3-UI-01).
const BEFORE = {
  chevron:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" aria-hidden="true" class="h-4 w-4"><path d="M 15.5 4.5 L 8 12 L 15.5 19.5"></path></svg>',
  croix:
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="red" stroke-width="4.5" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" aria-label="Fermer"><path d="M 4.5 4.5 L 19.5 19.5"></path><path d="M 19.5 4.5 L 4.5 19.5"></path></svg>',
  dragon:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" aria-hidden="true"><path d="M 12 2.5 A 9.5 9.5 0 1 1 11.99 2.5 Z"></path><path d="M 12 5.6 L 12.45 6.75 L 13.7 6.8 L 12.7 7.55 L 13.05 8.75 L 12 8.05 L 10.95 8.75 L 11.3 7.55 L 10.3 6.8 L 11.55 6.75 Z" fill="currentColor" stroke="none"></path><path d="M 12 15.25 L 12.45 16.45 L 13.7 16.5 L 12.7 17.25 L 13.05 18.45 L 12 17.75 L 10.95 18.45 L 11.3 17.25 L 10.3 16.5 L 11.55 16.45 Z" fill="currentColor" stroke="none"></path><path d="M 7.2 10.45 L 7.65 11.65 L 8.9 11.7 L 7.9 12.45 L 8.25 13.65 L 7.2 12.95 L 6.15 13.65 L 6.5 12.45 L 5.5 11.7 L 6.75 11.65 Z" fill="currentColor" stroke="none"></path><path d="M 16.8 10.45 L 17.25 11.65 L 18.5 11.7 L 17.5 12.45 L 17.85 13.65 L 16.8 12.95 L 15.75 13.65 L 16.1 12.45 L 15.1 11.7 L 16.35 11.65 Z" fill="currentColor" stroke="none"></path></svg>',
  maison:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="10" role="img"><path d="M 12 2.6 L 1.4 11.6 L 3 13.5 L 4 12.65 L 4 21.5 L 20 21.5 L 20 12.65 L 21 13.5 L 22.6 11.6 Z" fill="currentColor" stroke="none"></path></svg>',
  allHash: "79f06621074c88f6b59f59ebe52f5cf1614f096f536197c992e9e98c87c3c20a",
  svgHash: "edea59fd337b30a4fc034ee0db90cf06a7e5def067256a74af4b5d5099a3b4cf",
} as const;

const sha = (s: string) =>
  new Bun.CryptoHasher("sha256").update(s).digest("hex");
const r = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el);

describe("@shenron/ui/icones", () => {
  test("sample glyphs render identically to the pre-move site output", () => {
    expect(r(createElement(I.ChevronGauche, { className: "h-4 w-4" }))).toBe(
      BEFORE.chevron,
    );
    expect(
      r(
        createElement(I.Croix, {
          size: 16,
          strokeWidth: 3,
          absoluteStrokeWidth: true,
          color: "red",
          "aria-label": "Fermer",
        }),
      ),
    ).toBe(BEFORE.croix);
    expect(r(createElement(I.DragonBall))).toBe(BEFORE.dragon);
    expect(r(createElement(I.MaisonPleine, { role: "img" }))).toBe(
      BEFORE.maison,
    );
  });

  test("every exported glyph component renders identically (digest)", () => {
    const names = Object.keys(I)
      .filter(
        (k) =>
          /^[A-Z]/.test(k) &&
          k !== "Glyphe" &&
          typeof (I as Record<string, unknown>)[k] === "function",
      )
      .sort();
    expect(names.length).toBe(98);
    const all = names
      .map((k) => {
        const C = (
          I as unknown as Record<
            string,
            (p: { size: number }) => ReturnType<typeof createElement>
          >
        )[k]!;
        return k + r(C({ size: 20 }));
      })
      .join("\n");
    expect(sha(all)).toBe(BEFORE.allHash);
  });

  test("standalone SVG documents are unchanged", () => {
    expect(NOMS_ICONES.length).toBe(89);
    expect(
      sha(NOMS_ICONES.map((n) => svgIcone(n, { taille: 16 })).join("\n")),
    ).toBe(BEFORE.svgHash);
  });
});
