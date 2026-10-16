// SPDX-License-Identifier: Apache-2.0
// Source: packages/shenron/config/test/public-urls.test.ts at 8172f535ce (preserved Git ancestry).
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PUBLIC_ORIGINS,
  assetMirrorUrl,
  discordDefaultAvatar,
  joinUrl,
  originOf,
  resolveApiUrl,
  resolveAssetsUrl,
  resolveSiteUrl,
} from "../public-urls";

describe("@rosegriffon/config/public-urls", () => {
  test("defaults apply with an empty environment", () => {
    expect(resolveSiteUrl({})).toBe(DEFAULT_PUBLIC_ORIGINS.site);
    expect(resolveApiUrl({})).toBe(DEFAULT_PUBLIC_ORIGINS.api);
    expect(resolveAssetsUrl({})).toBe(DEFAULT_PUBLIC_ORIGINS.api);
  });
  test("NEXT_PUBLIC mirror wins, then canonical, then legacy names", () => {
    expect(
      resolveApiUrl({
        NEXT_PUBLIC_SHENRON_API_URL: "https://a.test/",
        SHENRON_PUBLIC_API_URL: "https://b.test",
      }),
    ).toBe("https://a.test");
    expect(resolveApiUrl({ SHENRON_PUBLIC_API_URL: "https://b.test", API_PUBLIC_URL: "https://c.test" })).toBe(
      "https://b.test",
    );
    expect(resolveApiUrl({ API_PUBLIC_URL: " https://c.test// " })).toBe("https://c.test");
    expect(resolveSiteUrl({ SITE_PUBLIC_URL: "https://s.test" })).toBe("https://s.test");
    expect(resolveSiteUrl({ SHENRON_PUBLIC_SITE_URL: "", BETTER_AUTH_URL: "https://auth.test" })).toBe(
      "https://auth.test",
    );
  });
  test("assets fall back to the api origin", () => {
    expect(resolveAssetsUrl({ API_PUBLIC_URL: "https://api.test" })).toBe("https://api.test");
    expect(
      resolveAssetsUrl({ API_PUBLIC_URL: "https://api.test", SHENRON_PUBLIC_ASSETS_URL: "https://cdn.test/x/" }),
    ).toBe("https://cdn.test/x");
  });
  test("joinUrl and originOf", () => {
    expect(joinUrl("https://h.test/", "/a/b")).toBe("https://h.test/a/b");
    expect(joinUrl("https://h.test/")).toBe("https://h.test");
    expect(originOf("https://h.test/a?b")).toBe("https://h.test");
    expect(originOf("nope")).toBe("nope");
  });
  test("assetMirrorUrl swaps cdn and api hosts only", () => {
    expect(assetMirrorUrl("https://cdn.test/assets/p.webp?v=1", "https://cdn.test", "https://api.test")).toBe(
      "https://api.test/assets/p.webp?v=1",
    );
    expect(assetMirrorUrl("https://api.test/assets/p.webp", "https://cdn.test", "https://api.test")).toBe(
      "https://cdn.test/assets/p.webp",
    );
    expect(assetMirrorUrl("https://other.test/x", "https://cdn.test", "https://api.test")).toBeNull();
    expect(assetMirrorUrl("not a url")).toBeNull();
  });
  test("discordDefaultAvatar", () => {
    expect(discordDefaultAvatar("0")).toBe("https://cdn.discordapp.com/embed/avatars/0.png");
    expect(discordDefaultAvatar("garbage")).toBe("https://cdn.discordapp.com/embed/avatars/0.png");
  });
});

describe("ownImageRemotePatterns and Discord helpers", () => {
  test("derives own origins, dedupes, keeps Discord media", async () => {
    const { ownImageRemotePatterns, discordUserAvatar, discordUserBanner, discordEmbedAvatar } =
      await import("../public-urls");
    const pats = ownImageRemotePatterns({
      SHENRON_PUBLIC_API_URL: "https://api.test",
      SHENRON_PUBLIC_SITE_URL: "https://site.test",
    });
    const keys = pats.map(p => `${p.protocol}://${p.hostname}${p.pathname}`);
    expect(keys).toContain("https://api.test/db/**");
    expect(keys).toContain("https://api.test/assets/**");
    expect(keys).toContain("https://site.test/assets/**");
    expect(keys).toContain("https://cdn.discordapp.com/**");
    expect(new Set(keys).size).toBe(keys.length);
    expect(discordUserAvatar("1", "a_x", { size: 64 })).toBe("https://cdn.discordapp.com/avatars/1/a_x.gif?size=64");
    expect(discordUserAvatar("1", "x")).toBe("https://cdn.discordapp.com/avatars/1/x.webp?size=256");
    expect(discordUserBanner("1", null)).toBeNull();
    expect(discordEmbedAvatar(3)).toBe("https://cdn.discordapp.com/embed/avatars/3.png");
  });
});
