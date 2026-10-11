<!-- SPDX-License-Identifier: Apache-2.0 -->
# WinClean Rust intégré

La migration est terminée côté runtime : `aphrody-kernel` est l’unique control-plane et
`aphrody-winclean` l’unique backend. Les 166 noms historiques restent compatibles, mais sont
dispatchés directement vers Rust. Aucun client ne charge de DLL NativeAOT, C ABI ou runtime .NET.

Surfaces canoniques :

- Rust : `crates/os/kernel/comps/winclean`, registre et dispatch typés ;
- kernel/MCP/CLI/A2A : subsystem `admin` ;
- Bun : `packages/os/winclean`, façade privée sur `@aphrody/os` ;
- plugin : `../aphrody-ai/plugins/aphrody` uniquement.

Validation :

```pwsh
bun scripts/audit/os/verify-winclean-integration.ts
cargo test -p aphrody-winclean --locked --offline
bun test packages/winclean
```

Le catalogue et les bindings sont désormais des artefacts Rust contrôlés par le registre local.
Toute modification de schéma doit mettre à jour `tool-migration.json` et ses tests.
