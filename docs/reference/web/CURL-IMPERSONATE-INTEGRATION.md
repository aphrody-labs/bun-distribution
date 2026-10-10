<!-- SPDX-License-Identifier: Apache-2.0 -->
# curl-impersonate et Aphrody OS

## Contrat unique

The kernel exposes `browser_*`, `google_search`, `gemini_web_navigate` and
`web_fetch` through one `aphrody_web` subsystem. `web_fetch` reuses the Obscura
session and returns page Markdown after navigation, for pages that need V8,
DOM and JavaScript.

For static or fingerprinted HTTP, `web_browser_fetch` routes through the
configured Aphrody Web Browser MCP provider to its existing profiles: `static`,
`http`, `fast`, `stealth` and `max`. `render` uses Obscura. The engine can escalate
from the requested profile, so callers must inspect the backend result before
claiming that curl performed a transfer. Raw downloads and other HTTP methods
use the provider's native tools. The OS does not copy libcurl.

## Capacités curl-impersonate prises en charge par la façade Aphrody Web

- wrappers CLI `curl_chrome*`, `curl_firefox*` et options curl standard ;
- profils Chrome, Edge, Safari, Firefox et Tor selon les binaires disponibles ;
- HTTP/2 et HTTP/3 lorsque le binaire et le serveur les supportent ;
- bibliothèque libcurl-impersonate via `curl_easy_impersonate` côté FFI ;
- bindings Python `curl_cffi` et TypeScript `impers` côté packages dédiés ;
- sélection déterministe du profil, timeouts, redirections, CA, proxy et
  limites de taille dans le client Aphrody Web.

Les paramètres qui modifient la signature TLS (ciphers, curves, version TLS,
ALPN/NPN et certains headers) restent sous le contrôle du profil. Un appel
doit donc sélectionner un profil avant d’ajouter des overrides.

## Cross-platform et production

Les binaires précompilés doivent être empaquetés par cible et accompagnés des
certificats CA du système. Linux, macOS et Windows ont des chemins et des
artifacts différents ; aucun `LD_PRELOAD` n’est utilisé par le kernel Windows.
Les secrets, cookies et headers d’authentification restent hors Git et ne sont
jamais renvoyés dans les logs.

Sources upstream : [documentation curl-impersonate](https://curl-impersonate.readthedocs.io/en/latest/),
[bindings](https://curl-impersonate.readthedocs.io/en/latest/bindings.html),
[dépôt officiel](https://github.com/lwthiker/curl-impersonate).
