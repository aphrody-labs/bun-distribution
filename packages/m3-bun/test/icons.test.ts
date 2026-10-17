// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  iconCacheFile,
  iconFile,
  iconUrl,
  iconVariant,
  iconsRoot,
  loadIcon,
  parseIconSpecifier,
  readIcon,
} from "../src/icons.ts";
import { cleanup, tmp } from "./helpers.ts";

afterAll(cleanup);

describe("parseIconSpecifier", () => {
  test("name, style and variant query", () => {
    expect(parseIconSpecifier("home")).toEqual({
      name: "home",
      style: "outlined",
      fill: false,
      weight: 400,
    });
    expect(parseIconSpecifier("rounded/arrow_back?fill=1&wght=300")).toEqual({
      name: "arrow_back",
      style: "rounded",
      fill: true,
      weight: 300,
    });
  });
  test("bad names, styles and weights are errors", () => {
    expect(() => parseIconSpecifier("Home")).toThrow(/invalid icon name/);
    expect(() => parseIconSpecifier("../x")).toThrow(/invalid icon name|style must be/);
    expect(() => parseIconSpecifier("fancy/home")).toThrow(/style must be one of/);
    expect(() => parseIconSpecifier("home?wght=450")).toThrow(/wght must be/);
  });
  test("file names follow the catalogue spelling", () => {
    expect(iconFile({ name: "home", style: "outlined", fill: false, weight: 400 })).toBe("home_24px.svg");
    expect(iconFile({ name: "home", style: "outlined", fill: true, weight: 400 })).toBe("home_fill1_24px.svg");
    expect(iconFile({ name: "home", style: "outlined", fill: false, weight: 300 })).toBe("home_wght300_24px.svg");
    expect(iconFile({ name: "home", style: "outlined", fill: true, weight: 300 })).toBe("home_wght300fill1_24px.svg");
  });
});

describe("readIcon", () => {
  const root = iconsRoot() ?? null;
  test.skipIf(!root)("reads real SVG markup from the forked catalogue", () => {
    const svg = readIcon({ name: "home", style: "outlined", fill: false, weight: 400 }, root);
    expect(svg).toStartWith("<svg");
    expect(svg).toContain('viewBox="0 -960 960 960"');
    expect(readIcon({ name: "home", style: "rounded", fill: true, weight: 400 }, root)).not.toBe(svg);
    expect(() =>
      readIcon(
        {
          name: "no_such_symbol_xyz",
          style: "outlined",
          fill: false,
          weight: 400,
        },
        root,
      ),
    ).toThrow(/no icon outlined\/no_such_symbol_xyz_24px\.svg/);
  });
  test("without a catalogue readIcon points to loadIcon", () => {
    expect(() => readIcon({ name: "home", style: "outlined", fill: false, weight: 400 }, null)).toThrow(/use loadIcon/);
  });
  test("CDN variants follow the gstatic layout", () => {
    expect(
      iconVariant({
        name: "home",
        style: "outlined",
        fill: false,
        weight: 400,
      }),
    ).toBe("default");
    expect(iconVariant({ name: "home", style: "outlined", fill: true, weight: 300 })).toBe("wght300fill1");
    expect(iconUrl({ name: "home", style: "rounded", fill: true, weight: 400 }, "https://cdn.aphrody.com/")).toBe(
      "https://cdn.aphrody.com/s/i/short-term/release/materialsymbolsrounded/home/fill1/24px.svg",
    );
  });
  test("loadIcon fetches from the icon origin once, then reads its disk cache", async () => {
    const requests: string[] = [];
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        const { pathname } = new URL(request.url);
        requests.push(pathname);
        if (pathname.includes("/no_such_symbol_xyz/")) return new Response("missing", { status: 404 });
        return new Response(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><title>${pathname}</title></svg>`,
        );
      },
    });
    const saved = {
      cache: Bun.env.M3_ICONS_CACHE,
      origin: Bun.env.M3_ICONS_ORIGIN,
    };
    const cache = tmp("m3-icons-");
    Bun.env.M3_ICONS_CACHE = cache;
    Bun.env.M3_ICONS_ORIGIN = server.url.href;
    try {
      const home = {
        name: "home",
        style: "outlined",
        fill: false,
        weight: 400,
      } as const;
      const svg = await loadIcon(home, null);
      expect(svg).toBe(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><title>/s/i/short-term/release/materialsymbolsoutlined/home/default/24px.svg</title></svg>`,
      );
      const file = iconCacheFile(home);
      expect(file).toStartWith(`${cache}/`);
      expect(file).toEndWith("/outlined/home/default.svg");
      expect(iconCacheFile(home, "https://other.example")).not.toBe(file);
      expect(await Bun.file(file).text()).toBe(svg);
      expect(await loadIcon(home, null)).toBe(svg);
      expect(await loadIcon({ name: "home", style: "rounded", fill: true, weight: 400 }, null)).not.toBe(svg);
      await expect(
        loadIcon(
          {
            name: "no_such_symbol_xyz",
            style: "outlined",
            fill: false,
            weight: 400,
          },
          null,
        ),
      ).rejects.toThrow(/no icon outlined\/no_such_symbol_xyz_24px\.svg/);
      expect(requests).toEqual([
        "/s/i/short-term/release/materialsymbolsoutlined/home/default/24px.svg",
        "/s/i/short-term/release/materialsymbolsrounded/home/fill1/24px.svg",
        "/s/i/short-term/release/materialsymbolsoutlined/no_such_symbol_xyz/default/24px.svg",
      ]);
    } finally {
      for (const [key, value] of [
        ["M3_ICONS_CACHE", saved.cache],
        ["M3_ICONS_ORIGIN", saved.origin],
      ] as const) {
        if (value === undefined) delete Bun.env[key];
        else Bun.env[key] = value;
      }
    }
  });
  test("M3_ICONS_ROOT wins", () => {
    const saved = Bun.env.M3_ICONS_ROOT;
    Bun.env.M3_ICONS_ROOT = "/somewhere/else";
    try {
      expect(iconsRoot()).toBe(resolve("/somewhere/else"));
    } finally {
      if (saved === undefined) delete Bun.env.M3_ICONS_ROOT;
      else Bun.env.M3_ICONS_ROOT = saved;
    }
  });
});
