<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-web-bridge

The source bridge was imported from clean Aphrody Web commit
`bbeb5ef4c497f7d27f546ad2cc15a250dcc93c83` with hashes checked against
`docs/migration/source-map.json`. Its Rust package name, `1.0.0-canary`
version, public modules and browser CLI profiles are preserved.

Direct HTML fetch and `Bridge::html_to_markdown` now use the local
`aphrody-web-extract` Rust crate. `Rendering::Markdown.via` keeps its existing
serialized value for consumers; `Fetched::path_taken` reports the actual Rust
backend. Other DOM, title and DNS calls still use the native library, and
browser profiles dispatch through the linked Rust Web service.

The optional executable resolver reports the installed `aphrody-web` CLI from
`~/.local/bin` or `PATH`. `APHRODY_WEB_BIN` configures its explicit location;
published `APHRODY_WEB_BROWSER_BIN` and `BXC_BIN` override names remain accepted
only when explicitly configured. Legacy executable names are not discovered.
Browser and MCP execution use native Rust capabilities and require no BXC
subprocess.

The import and local adaptations are recorded in
`docs/migration/aphrody-web-bridge-import.json`. The offline local HTTP test
proves Markdown conversion does not require loading the native library. It
is not evidence of browser or whole BXC parity.
