const catalogUrl = "https://www.retrostic.com/fr/bios";
const maxCatalogBytes = 2 * 1024 * 1024;
const catalogTimeoutMs = 20_000;

export interface FirmwareCatalogEntry {
  name: string;
  page: string;
  downloads?: number;
  updatedAt?: string;
  fileName?: string;
  fileSize?: string;
}

interface TableRow {
  cells: string[];
  href?: string;
}

async function parseTableRows(html: string, base: string): Promise<TableRow[]> {
  const rows: TableRow[] = [];
  let row: TableRow | undefined;
  let cell = -1;
  const rewriter = new HTMLRewriter()
    .on("tr", {
      element(element) {
        row = { cells: [] };
        cell = -1;
        element.onEndTag(() => {
          if (row) rows.push(row);
          row = undefined;
          cell = -1;
        });
      },
    })
    .on("tr td", {
      element() {
        if (row) row.cells[++cell] = "";
      },
      text(text) {
        if (row && cell >= 0) row.cells[cell] += text.text;
      },
    })
    .on("tr td a[href]", {
      element(element) {
        if (!row) return;
        const url = new URL(element.getAttribute("href") ?? "", base);
        if (url.origin === new URL(base).origin) row.href = url.href;
      },
    });
  await rewriter.transform(new Response(html)).text();
  return rows.map(item => ({
    ...item,
    cells: item.cells.map(value => value.replace(/\s+/g, " ").trim()),
  }));
}

export async function parseFirmwareCatalogHtml(html: string, base = catalogUrl): Promise<FirmwareCatalogEntry[]> {
  const entries = (await parseTableRows(html, base))
    .filter(row => row.href && /^\/fr\/bios\/[^/]+\/?$/.test(new URL(row.href).pathname))
    .map(row => ({
      name: row.cells[0] ?? "",
      page: row.href!,
      downloads: /^\d+$/.test(row.cells[1] ?? "") ? Number(row.cells[1]) : undefined,
      updatedAt: row.cells[2] || undefined,
    }))
    .filter(entry => entry.name);
  return [...new Map(entries.map(entry => [entry.page, entry])).values()];
}

export async function parseFirmwareDetailHtml(
  html: string,
  entry: FirmwareCatalogEntry,
): Promise<FirmwareCatalogEntry> {
  const fields = new Map<string, string>();
  for (const row of await parseTableRows(html, entry.page)) {
    if (row.cells.length >= 2) fields.set(row.cells[0]!.replace(/:$/, "").toLowerCase(), row.cells[1]!);
  }
  const downloads = fields.get("descargas");
  return {
    ...entry,
    fileName: fields.get("nom de fichier") || undefined,
    fileSize: fields.get("taille du fichier") || undefined,
    downloads: downloads && /^\d+$/.test(downloads) ? Number(downloads) : entry.downloads,
  };
}

async function fetchHtml(url: string): Promise<{ html: string; url: string }> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(catalogTimeoutMs),
    headers: {
      accept: "text/html",
      "user-agent": "Bun-Engine/0.1 (+metadata-index)",
    },
  });
  if (!response.ok) throw new Error(`firmware metadata returned HTTP ${response.status}: ${url}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxCatalogBytes) throw new Error(`firmware metadata exceeds 2 MiB: ${url}`);
  if (!response.body) return { html: "", url: response.url || url };

  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxCatalogBytes) {
        await reader.cancel();
        throw new Error(`firmware metadata exceeds 2 MiB: ${url}`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { html: new TextDecoder().decode(bytes), url: response.url || url };
}

export async function fetchFirmwareCatalog(url = catalogUrl): Promise<FirmwareCatalogEntry[]> {
  const catalog = await fetchHtml(url);
  const entries = await parseFirmwareCatalogHtml(catalog.html, catalog.url);
  const detailed = entries.map(entry => ({ ...entry }));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, entries.length) }, async () => {
      while (cursor < entries.length) {
        const index = cursor++;
        const entry = entries[index]!;
        try {
          const detail = await fetchHtml(entry.page);
          detailed[index] = await parseFirmwareDetailHtml(detail.html, entry);
        } catch (error) {
          detailed[index] = { ...entry };
          console.error(`metadata warning: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }),
  );
  return detailed;
}
