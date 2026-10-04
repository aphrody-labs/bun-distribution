// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EMPTY_RETRIEVAL_NOTICE,
  IA_COCKPIT_TABS,
  OCR_PROBE_MAX_BYTES,
  bytesToBase64,
  describeHttpFailure,
  formatRagContext,
  ocrProbeFileError,
  parseCockpitTab,
  splitMarkedExcerpt,
} from "../src/components/admin/ia-cockpit-view";

const siteRoot = fileURLToPath(new URL("..", import.meta.url));
const adminSrc = (file: string) =>
  Bun.file(new URL(`../../../../m3/packages/admin-ui/src/components/admin/${file}`, import.meta.url)).text();

describe("onglets du cockpit IA", () => {
  test("accepte chaque onglet connu et rejette le reste vers le repli", () => {
    for (const tab of IA_COCKPIT_TABS) expect(parseCockpitTab(tab)).toBe(tab);
    expect(parseCockpitTab("inconnu")).toBe("overview");
    expect(parseCockpitTab("")).toBe("overview");
    expect(parseCockpitTab(null)).toBe("overview");
    expect(parseCockpitTab(undefined, "training")).toBe("training");
    // Object.prototype keys must not pass as tabs.
    expect(parseCockpitTab("constructor")).toBe("overview");
  });

  test("chaque redirection historique cible un onglet existant", async () => {
    const redirect = await adminSrc("admin-ia-redirect.tsx");
    const declared = /AdminIaTab\s*=\s*([^;]+);/.exec(redirect)?.[1] ?? "";
    const tabs = [...declared.matchAll(/"([a-z]+)"/g)].map((match) => match[1]!);
    expect(tabs.length).toBeGreaterThan(0);
    for (const tab of tabs) expect(IA_COCKPIT_TABS as readonly string[]).toContain(tab);
  });
});

describe("états d'échec du cockpit", () => {
  test("distingue session expirée, accès refusé et erreur serveur", () => {
    expect(describeHttpFailure(401).kind).toBe("unauthenticated");
    const forbidden = describeHttpFailure(403, "Accès réservé aux administrateurs.");
    expect(forbidden.kind).toBe("forbidden");
    expect(forbidden.text).toContain("Accès réservé aux administrateurs.");
    const server = describeHttpFailure(502, "Aphrody injoignable");
    expect(server).toEqual({ kind: "server", text: "HTTP 502 : Aphrody injoignable" });
    expect(describeHttpFailure(500, "  ").text).toBe("HTTP 500 : réponse illisible");
  });
});

describe("extraits OCR du banc d'essai", () => {
  test("conserve les surlignages <mark> et rend tout le reste littéral", () => {
    expect(splitMarkedExcerpt("le <mark>Kamehameha</mark> de Goku")).toEqual([
      { text: "le ", marked: false },
      { text: "Kamehameha", marked: true },
      { text: " de Goku", marked: false },
    ]);
  });

  test("ne laisse passer aucune balise active : un extrait OCR hostile reste du texte", () => {
    const hostile = `<img src=x onerror="alert(1)"><mark>ok</mark><script>steal()</script>`;
    const segments = splitMarkedExcerpt(hostile);
    expect(segments.filter((segment) => segment.marked)).toEqual([{ text: "ok", marked: true }]);
    expect(segments.map((segment) => segment.text).join("")).toBe(
      `<img src=x onerror="alert(1)">ok<script>steal()</script>`,
    );
  });

  test("tolère un <mark> non fermé et une casse différente", () => {
    expect(splitMarkedExcerpt("a <MARK>b")).toEqual([
      { text: "a ", marked: false },
      { text: "b", marked: true },
    ]);
    expect(splitMarkedExcerpt("")).toEqual([]);
  });

  test("le cockpit n'injecte plus de HTML brut", async () => {
    const cockpit = await adminSrc("UnifiedIaCockpit.tsx");
    expect(cockpit).not.toContain("dangerouslySetInnerHTML");
    expect(cockpit).toContain("splitMarkedExcerpt(");
  });
});

describe("sonde OCR", () => {
  test("refuse un format ou un poids hors limites avec une raison lisible", () => {
    expect(ocrProbeFileError({ size: 1_000, type: "image/png" })).toBeNull();
    expect(ocrProbeFileError({ size: OCR_PROBE_MAX_BYTES, type: "image/webp" })).toBeNull();
    expect(ocrProbeFileError({ size: 10, type: "application/pdf" })).toContain("PNG, JPEG ou WebP");
    expect(ocrProbeFileError({ size: OCR_PROBE_MAX_BYTES + 1, type: "image/jpeg" })).toContain(
      "6 Mo maximum",
    );
  });

  test("encode en base64 identique à Buffer, y compris au-delà d'un bloc de 32 Ko", () => {
    const bytes = Uint8Array.from(
      { length: 0x8000 * 2 + 17 },
      (_, index) => (index * 31 + 7) & 0xff,
    );
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    expect(bytesToBase64(new Uint8Array())).toBe("");
  });
});

describe("IA locale du bureau", () => {
  test("numérote les passages comme les citations [n] attendues du modèle", () => {
    expect(formatRagContext([{ title: "Freezer", snippet: "530 000" }, {}])).toBe(
      "[1] Freezer — 530 000\n[2] Sans titre — ",
    );
    expect(formatRagContext([])).toBe("");
  });

  test("n'interroge pas le modèle quand la recherche ne renvoie aucun passage", async () => {
    const panel = await adminSrc("NativeAiPanel.tsx");
    const guard = panel.indexOf("results.length === 0");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(panel.indexOf("native.chat("));
    expect(panel).toContain("EMPTY_RETRIEVAL_NOTICE");
    expect(EMPTY_RETRIEVAL_NOTICE).toContain("non ingéré");
  });
});

describe("frontière d'erreur du cockpit", () => {
  test("une erreur de rendu reste locale à /admin/ia et renvoie au tableau de bord", async () => {
    const boundary = await Bun.file(
      new URL("../../../../m3/packages/admin-ui/src/app/admin/ia/error.tsx", import.meta.url),
    ).text();
    expect(boundary).toContain("SectionError");
    expect(boundary).toContain('backHref="/admin/dashboard"');
    expect(existsSync(`${siteRoot}src/app/admin/dashboard/page.tsx`)).toBe(true);
  });
});

describe("navigation administrateur : liens vers des pages réelles", () => {
  test("chaque lien de la barre latérale pointe vers une page existante", async () => {
    const sidebar = await adminSrc("AdminSidebar.tsx");
    const links = [...sidebar.matchAll(/href:\s*"(\/admin[^"?#]*)/g)].map((match) => match[1]!);
    const dead = links.filter(
      (href) =>
        href !== "/admin" &&
        !existsSync(`${siteRoot}src/app${href}/page.tsx`) &&
        !existsSync(`${siteRoot}src/app${href}/page.ts`),
    );
    expect(links.length).toBeGreaterThan(30);
    expect(dead).toEqual([]);
  });
});
