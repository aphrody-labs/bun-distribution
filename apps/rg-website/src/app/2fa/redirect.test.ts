// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { safeReturnUrl } from "@rosegriffon/auth/redirect";

const pages = [
  { page: new URL("./page.tsx", import.meta.url), fallback: "/dashboard" },
  {
    page: new URL("../../../../azalee-web/app/2fa/page.tsx", import.meta.url),
    fallback: "/",
  },
];

for (const { page, fallback } of pages) {
  test(`2FA ${fallback} rejects browser-normalized external redirects`, () => {
    for (const callback of [
      "/\\evil.example",
      "//evil.example",
      "https://evil.example",
      "\\evil.example",
      "/safe\nheader",
      null,
    ]) {
      expect(safeReturnUrl(callback, fallback)).toBe(fallback);
    }
  });

  test(`2FA ${fallback} retains safe paths, queries and fragments`, () => {
    for (const callback of [
      "/",
      "/dashboard",
      "/account/settings?tab=security#totp",
      "/orders/42?view=compact",
    ]) {
      expect(safeReturnUrl(callback, fallback)).toBe(callback);
    }
  });

  test(`2FA ${fallback} wires the canonical guard without changing factor verification`, async () => {
    const source = await Bun.file(page).text();
    expect(source).toContain('from "@rosegriffon/auth/redirect"');
    expect(source).toContain(`safeReturnUrl(demande, "${fallback}")`);
    expect(source).not.toContain('demande.startsWith("/")');
    expect(source).toContain("authClient.twoFactor.verifyTotp({");
    expect(source).toContain("trustDevice: appareilDeConfiance");
    expect(source).toMatch(/authClient\.twoFactor\.verifyBackupCode\(\{\s*code,?\s*\}\)/);
    expect(source).toContain('error.message ?? "Code refusé."');
    expect(source).toContain('error.message ?? "Code de secours refusé."');
    expect(source).toContain("router.push(destination)");
    expect(source).toContain("router.refresh()");
  });
}
