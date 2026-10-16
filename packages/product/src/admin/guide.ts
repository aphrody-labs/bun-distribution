// SPDX-License-Identifier: Apache-2.0
const CSS = `body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1b1b1f}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #d9d9e0;padding:.4rem .6rem;text-align:left;vertical-align:top}
code{background:#f2f2f6;padding:0 .25rem;border-radius:4px}@media (prefers-color-scheme:dark){body{background:#121214;color:#e6e6ea}td,th{border-color:#2c2c33}code{background:#1d1d22}}`;

/** docs/operations/omar-guide.md as one standalone page (what the menu's « Ouvrir le guide » shows). */
export function guideHtml(markdown: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aphrody : le guide d'Omar</title><style>${CSS}</style></head><body>${Bun.markdown.html(markdown)}</body></html>\n`;
}
