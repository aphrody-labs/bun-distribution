import { describe, expect, test } from "bun:test";
import { fetchFirmwareCatalog, parseFirmwareCatalogHtml, parseFirmwareDetailHtml } from "../src/firmware/catalog";

describe("firmware metadata catalog", () => {
  test("keeps detail pages and rejects direct payload links", async () => {
    const entries = await parseFirmwareCatalogHtml(
      '<table><tr><td><a href="/fr/bios/nintendo-ds">Nintendo DS</a></td><td>42</td><td>2026-10-14 16:09:03</td></tr></table><a href="/payload/bios.zip">archive</a>',
    );
    expect(entries).toEqual([
      {
        name: "Nintendo DS",
        page: "https://www.retrostic.com/fr/bios/nintendo-ds",
        downloads: 42,
        updatedAt: "2026-10-14 16:09:03",
      },
    ]);
  });

  test("extracts detail metadata without exposing a download URL", async () => {
    const entry = {
      name: "Nintendo DS",
      page: "https://www.retrostic.com/fr/bios/nintendo-ds",
    };
    expect(
      await parseFirmwareDetailHtml(
        "<table><tr><td>Nom de fichier:</td><td>Nintendo DS Bios.rar</td></tr><tr><td>Taille du fichier:</td><td>269.94 KB</td></tr><tr><td>Descargas:</td><td>853240</td></tr></table>",
        entry,
      ),
    ).toEqual({
      ...entry,
      fileName: "Nintendo DS Bios.rar",
      fileSize: "269.94 KB",
      downloads: 853240,
    });
  });

  test("rejects chunked metadata beyond the bounded response size", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        const chunk = new Uint8Array(1024 * 1024 + 1);
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(chunk);
              controller.enqueue(chunk);
              controller.close();
            },
          }),
        );
      },
    });
    try {
      await expect(fetchFirmwareCatalog(`http://127.0.0.1:${server.port}`)).rejects.toThrow(
        "firmware metadata exceeds 2 MiB",
      );
    } finally {
      server.stop(true);
    }
  });
});
