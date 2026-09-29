<!-- SPDX-License-Identifier: Apache-2.0 -->
# Contrat Google / Gemini / Aphrody Web Browser

Ce document fixe la frontière entre `aphrody-os` et Aphrody Web Browser.
L’OS possède le kernel, le shell Tauri et la session Obscura. Aphrody Web Browser
possède les implémentations Bun, curl-impersonate, Gemini Web, Google et leurs
bindings Rust/Python.

## Routage canonique

| Besoin | Contrat visible dans Aphrody OS | Fournisseur canonique |
|---|---|---|
| Navigation DOM/V8 | `browser_navigate` + `browser_*` | Obscura (`aphrody-web`, sous-système `aphrody-browser` du kernel) |
| Page vers Markdown | `web_fetch` ou `web_browser_fetch` | Obscura pour page rendue ; Aphrody Web Browser pour HTTP brut |
| Recherche Google | `google_search` | Obscura dans le shell ; moteur Google d’Aphrody Web Browser |
| Gemini Web rendu | `gemini_web_navigate` | Obscura, session kernel |
| Gemini Web interactif | `Open Gemini Web` | fenêtre Wry/Tauri avec profil hôte |
| Gemini authentifié / modèles | MCP `aphrody_gemini_rust` | `aphrody-gemini-web` + `aphrody-mcp` |
| Google spécialisé | aliases `google_*` | `aphrody-mcp-client` vers Aphrody Web Browser |

## Règles d’implémentation

1. Le kernel ne copie pas les crates du dépôt Aphrody Web et ne charge jamais
   leurs cookies ou secrets directement.
2. Les capacités inter-dépôts sont routées par le contrat MCP stable et par le
   fournisseur Aphrody Web Browser configuré.
3. `web_fetch` in the kernel remains the rendered Obscura path. `web_browser_fetch`
   routes `render` to Obscura and `static`/`http`/`fast`/`stealth`/`max` to the
   configured Aphrody Web MCP backend. The backend can escalate its profile;
   callers must inspect its result before claiming that curl performed a transfer.
   Raw bytes, headers and POST use the provider's native tools.
4. Une fenêtre Gemini utilise le stockage de session du WebView hôte. La
   session Obscura et le MCP Rust ne reçoivent aucun cookie par défaut.
5. Toute nouvelle capacité Google doit être ajoutée au catalogue fournisseur
   puis branchée par alias MCP ; aucun second catalogue local n’est autorisé.

## Activation du fournisseur MCP Aphrody Web Browser

The kernel can attach the Aphrody Web Browser MCP provider to its single `aphrody_web`
subsystem without linking provider crates. The same configuration applies to
`aphrody-kernel serve`, its stdio fallback and a desktop hosted kernel:

```powershell
$env:APHRODY_WEB_MCP_BIN = "aphrody-mcp"
$env:APHRODY_WEB_MCP_ARGS = "server"
aphrody-kernel serve
```

The proxy performs `initialize`, `notifications/initialized` and `tools/list`,
then routes `tools/call` to the provider process. For `web_browser_fetch`, it
uses the provider's `aphrody_web_call` gateway to select the native fetch backend,
not the provider's separate native `aphrody_google_fetch` implementation.
Arguments remain JSON-RPC; the kernel adds no secret or cookie.

## Vérification de présence

Depuis le dépôt Aphrody Web :

```text
bun run workspace:check
bun run typecheck
bun run lint
bun test test/ packages/ src/ --path-ignore-patterns 'vendor/**' --path-ignore-patterns 'third_party/**'
```

Depuis Aphrody OS :

```text
cargo test -p aphrody-browser --locked
cargo test -p aphrody-app --lib --locked
bun run check
bun run build
```

Ces commandes vérifient les deux frontières séparément ; une réussite locale
ne prétend pas qu’un compte Google est authentifié ou qu’un cookie existe.
