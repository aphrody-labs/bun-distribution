/** Relative paths preserved by the asset copy command. */
export const uiAssetPaths = [
  "dbz/marque/banc-nuage.svg",
  "dbz/kinto-un.svg",
  "dbz/kinto-un-icone.svg",
  "safari-pinned-tab.svg",
  "badges/badge-zeni.svg",
  "badges/badge-shenron.svg",
  "badges/badge-kame.svg",
  "badges/badge-kaio.svg",
  "favicon-16.png",
  "favicon-32.png",
  "favicon-48.png",
  "favicon-96.png",
  "favicon.ico",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "mstile-150.png",
  "dbz/marque/avatar-1024-fond-sombre.png",
  "dbz/marque/avatar-1024-transparent.png",
  "dbz/marque/banniere-960x540.png",
  "dbz/marque/emoji-128.png",
  "dbz/marque/kinto-un-1024.png",
  "dbz/marque/kinto-un-2048.png",
] as const;

export type UiAssetPath = (typeof uiAssetPaths)[number];

export function uiAssetUrl(path: UiAssetPath, base = "/"): string {
  return `${base.replace(/\/?$/, "/")}${path}`;
}
