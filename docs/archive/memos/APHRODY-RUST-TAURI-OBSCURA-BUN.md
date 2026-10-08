<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- docs-links: external-paths — backtick paths in this dated document name files of the repository at the time it records (Shenron and Koharu moved to aphrody-labs/shenron on 2026-10-05), not of this checkout. -->
# Inventaire Rust Aphrody : Tauri, Obscura et Bun

> Scan statique effectué le 2026-10-03 sur le workspace `aphrody`, HEAD `c4ca873709fe6d8d8cd3d7f24a5742930d11b3b5`. Périmètre : `crates/**` (sources Rust, tests et manifestes Cargo). Le rapport est enregistré dans le dépôt yolo à la demande du propriétaire. Les chemins pointent vers le checkout Aphrody. Ce scan ne lance ni compilation, ni test, ni application.

## Statut après la décision runtime du 2026-10-03

La direction active est désormais le [plan producteur](../PLAN.md) : runtime
Bun/Tauri/Obscura précompilé dans Yolo, SDK léger consommé par Aphrody. Ce scan
historique sert à retrouver des sources. Ses comptages de dépendances concernent
les tables directes lues statiquement ; ils ne résolvent ni le graphe Cargo ni
les tables conditionnelles par cible. Les affirmations précédentes sur des
profils panic effectifs ont été retirées : elles n'étaient pas établies par le scan.

## Résultats

| Sujet | Fichiers Rust touchés | Lignes correspondantes |
| --- | ---: | ---: |
| Tauri | 141 | 1132 |
| Obscura | 151 | 1952 |
| Bun | 153 | 1526 |

Les résultats lexicaux incluent code, commentaires, tests et chaînes. Les numéros servent à naviguer dans les sources et ne prouvent pas à eux seuls un appel à l’exécution. Les manifestes et chemins d’exécution sont classés séparément ci-dessous.

## Dépendances Cargo directes

| Package consommateur | Manifest | Catégorie | Clé Cargo | Déclaration |
| --- | --- | --- | --- | --- |
| `aphrody-agent-tools` | `crates/ai/agent-tools/Cargo.toml` | dependencies | `obscura-net` | `workspace=True` |
| `aphrody-app` | `crates/ui/app/Cargo.toml` | build-dependencies | `tauri-build` | `workspace=True` |
| `aphrody-app` | `crates/ui/app/Cargo.toml` | dependencies | `aphrody-shell-tauri` | `workspace=True` |
| `aphrody-app` | `crates/ui/app/Cargo.toml` | dependencies | `tauri` | `workspace=True, features=['dynamic-acl', 'image-ico', 'tray-icon']` |
| `aphrody-app` | `crates/ui/app/Cargo.toml` | dependencies | `tauri-plugin-autostart` | `workspace=True` |
| `aphrody-app` | `crates/ui/app/Cargo.toml` | dependencies | `tauri-plugin-clipboard-manager` | `workspace=True` |
| `aphrody-app` | `crates/ui/app/Cargo.toml` | dependencies | `tauri-plugin-deep-link` | `workspace=True` |
| `aphrody-app` | `crates/ui/app/Cargo.toml` | dependencies | `tauri-plugin-dialog` | `workspace=True` |
| `aphrody-app` | `crates/ui/app/Cargo.toml` | dependencies | `tauri-plugin-fs` | `workspace=True` |
| `aphrody-app` | `crates/ui/app/Cargo.toml` | dependencies | `tauri-plugin-global-shortcut` | `workspace=True` |
| `aphrody-app` | `crates/ui/app/Cargo.toml` | dependencies | `tauri-plugin-log` | `workspace=True` |
| `aphrody-app` | `crates/ui/app/Cargo.toml` | dependencies | `tauri-plugin-notification` | `workspace=True` |
| `aphrody-app` | `crates/ui/app/Cargo.toml` | dependencies | `tauri-plugin-opener` | `workspace=True` |
| `aphrody-app` | `crates/ui/app/Cargo.toml` | dependencies | `tauri-plugin-os` | `workspace=True` |
| `aphrody-app` | `crates/ui/app/Cargo.toml` | dependencies | `tauri-plugin-process` | `workspace=True` |
| `aphrody-app` | `crates/ui/app/Cargo.toml` | dependencies | `tauri-plugin-single-instance` | `workspace=True, features=['deep-link']` |
| `aphrody-app` | `crates/ui/app/Cargo.toml` | dependencies | `tauri-plugin-store` | `workspace=True` |
| `aphrody-app` | `crates/ui/app/Cargo.toml` | dependencies | `tauri-plugin-updater` | `workspace=True` |
| `aphrody-app` | `crates/ui/app/Cargo.toml` | dependencies | `tauri-plugin-window-state` | `workspace=True` |
| `aphrody-app` | `crates/ui/app/Cargo.toml` | dependencies | `tauri-runtime-wry` | `workspace=True` |
| `aphrody-drive` | `crates/ui/drive/Cargo.toml` | build-dependencies | `tauri-plugin` | `workspace=True, features=['build']` |
| `aphrody-drive` | `crates/ui/drive/Cargo.toml` | dependencies | `tauri` | `workspace=True` |
| `aphrody-kernel` | `crates/os/kernel/core/Cargo.toml` | dependencies | `aphrody-bun-docs` | `workspace=True, optional=True` |
| `aphrody-shell-tauri` | `crates/shell/tauri/Cargo.toml` | build-dependencies | `tauri-plugin` | `workspace=True, features=['build']` |
| `aphrody-shell-tauri` | `crates/shell/tauri/Cargo.toml` | dependencies | `tauri` | `workspace=True` |
| `aphrody-shell-tauri` | `crates/shell/tauri/Cargo.toml` | dev-dependencies | `tauri` | `workspace=True, features=['test']` |
| `aphrody-shell-tauri-e2e` | `crates/shell/tauri-e2e/Cargo.toml` | build-dependencies | `tauri-build` | `workspace=True` |
| `aphrody-shell-tauri-e2e` | `crates/shell/tauri-e2e/Cargo.toml` | dependencies | `aphrody-shell-tauri` | `workspace=True` |
| `aphrody-shell-tauri-e2e` | `crates/shell/tauri-e2e/Cargo.toml` | dependencies | `tauri` | `workspace=True` |
| `aphrody-shell-tauri-e2e` | `crates/shell/tauri-e2e/Cargo.toml` | dependencies | `tauri-runtime-wry` | `workspace=True` |
| `aphrody-tauri-wrap` | `crates/ui/tauri-wrap/Cargo.toml` | dependencies | `tauri` | `workspace=True` |
| `aphrody-tauri-wrap` | `crates/ui/tauri-wrap/Cargo.toml` | dependencies | `tauri-plugin-mcp-bridge` | `workspace=True, optional=True` |
| `aphrody-web-bridge` | `crates/web/web-bridge/Cargo.toml` | dependencies | `obscura` | `workspace=True` |
| `aphrody-web-bridge` | `crates/web/web-bridge/Cargo.toml` | dependencies | `obscura-dom` | `workspace=True` |
| `aphrody-web-bridge` | `crates/web/web-bridge/Cargo.toml` | dependencies | `obscura-net` | `workspace=True` |
| `aphrody-web-crawl` | `crates/web/web-crawl/Cargo.toml` | dependencies | `obscura-dom` | `workspace=True` |
| `aphrody-web-crawl` | `crates/web/web-crawl/Cargo.toml` | dependencies | `obscura-net` | `workspace=True` |
| `aphrody-web-engine` | `crates/web/web-engine/Cargo.toml` | dependencies | `obscura-browser` | `workspace=True` |
| `aphrody-web-engine` | `crates/web/web-engine/Cargo.toml` | dependencies | `obscura-cdp` | `workspace=True` |
| `aphrody-web-engine` | `crates/web/web-engine/Cargo.toml` | dependencies | `obscura-dom` | `workspace=True` |
| `aphrody-web-engine` | `crates/web/web-engine/Cargo.toml` | dependencies | `obscura-js` | `workspace=True` |
| `aphrody-web-engine` | `crates/web/web-engine/Cargo.toml` | dependencies | `obscura-net` | `workspace=True` |
| `aphrody-web-extract` | `crates/web/web-extract/Cargo.toml` | dependencies | `obscura-dom` | `workspace=True` |
| `aphrody-web-service` | `crates/web/web-service/Cargo.toml` | dependencies | `obscura-dom` | `workspace=True` |
| `aphrody-web-service` | `crates/web/web-service/Cargo.toml` | dependencies | `obscura-mcp` | `workspace=True` |
| `koharu` | `crates/koharu/koharu/Cargo.toml` | build-dependencies | `tauri-build` | `workspace=True` |
| `koharu` | `crates/koharu/koharu/Cargo.toml` | dependencies | `tauri` | `workspace=True, features=['dynamic-acl', 'specta']` |
| `koharu` | `crates/koharu/koharu/Cargo.toml` | dependencies | `tauri-plugin-opener` | `workspace=True` |
| `koharu` | `crates/koharu/koharu/Cargo.toml` | dependencies | `tauri-plugin-process` | `workspace=True` |
| `koharu` | `crates/koharu/koharu/Cargo.toml` | dependencies | `tauri-runtime-cef` | `workspace=True` |
| `koharu-app` | `crates/koharu/koharu-app/Cargo.toml` | dependencies | `tauri` | `workspace=True, features=['dynamic-acl', 'specta']` |
| `koharu-app` | `crates/koharu/koharu-app/Cargo.toml` | dependencies | `tauri-plugin-log` | `workspace=True` |
| `koharu-app` | `crates/koharu/koharu-app/Cargo.toml` | dependencies | `tauri-plugin-opener` | `workspace=True` |
| `koharu-app` | `crates/koharu/koharu-app/Cargo.toml` | dependencies | `tauri-plugin-process` | `workspace=True` |
| `koharu-app` | `crates/koharu/koharu-app/Cargo.toml` | dependencies | `tauri-plugin-single-instance` | `workspace=True` |
| `koharu-app` | `crates/koharu/koharu-app/Cargo.toml` | dependencies | `tauri-plugin-window-state` | `workspace=True` |
| `koharu-app` | `crates/koharu/koharu-app/Cargo.toml` | dependencies | `tauri-runtime-cef` | `workspace=True, optional=True` |
| `koharu-app` | `crates/koharu/koharu-app/Cargo.toml` | dependencies | `tauri-specta` | `workspace=True` |
| `obscura` | `crates/web/obscura/Cargo.toml` | dependencies | `obscura-browser` | `workspace=True, optional=True` |
| `obscura` | `crates/web/obscura/Cargo.toml` | dependencies | `obscura-net` | `workspace=True, optional=True` |
| `obscura-browser` | `crates/web/obscura-browser/Cargo.toml` | dependencies | `obscura-dom` | `workspace=True` |
| `obscura-browser` | `crates/web/obscura-browser/Cargo.toml` | dependencies | `obscura-js` | `workspace=True` |
| `obscura-browser` | `crates/web/obscura-browser/Cargo.toml` | dependencies | `obscura-net` | `workspace=True` |
| `obscura-cdp` | `crates/web/obscura-cdp/Cargo.toml` | dependencies | `obscura-browser` | `workspace=True` |
| `obscura-cdp` | `crates/web/obscura-cdp/Cargo.toml` | dependencies | `obscura-dom` | `workspace=True` |
| `obscura-cdp` | `crates/web/obscura-cdp/Cargo.toml` | dependencies | `obscura-js` | `workspace=True` |
| `obscura-cdp` | `crates/web/obscura-cdp/Cargo.toml` | dependencies | `obscura-net` | `workspace=True` |
| `obscura-js` | `crates/web/obscura-js/Cargo.toml` | dependencies | `obscura-dom` | `workspace=True` |
| `obscura-js` | `crates/web/obscura-js/Cargo.toml` | dependencies | `obscura-net` | `workspace=True` |
| `obscura-js` | `crates/web/obscura-js/Cargo.toml` | dependencies | `obscura-render` | `workspace=True, optional=True` |
| `obscura-mcp` | `crates/web/obscura-mcp/Cargo.toml` | dependencies | `obscura-browser` | `workspace=True` |
| `obscura-mcp` | `crates/web/obscura-mcp/Cargo.toml` | dependencies | `obscura-dom` | `workspace=True` |
| `obscura-mcp` | `crates/web/obscura-mcp/Cargo.toml` | dependencies | `obscura-net` | `workspace=True` |
| `obscura-render` | `crates/web/obscura-render/Cargo.toml` | dependencies | `obscura-dom` | `workspace=True` |
| `tauri-plugin-dialog` | `crates/ui/tauri-plugin-dialog/Cargo.toml` | build-dependencies | `tauri-plugin` | `version=3.0.0-alpha.1, features=['build']` |
| `tauri-plugin-dialog` | `crates/ui/tauri-plugin-dialog/Cargo.toml` | dependencies | `tauri` | `version=3.0.0-alpha.2, default-features=False` |
| `tauri-plugin-dialog` | `crates/ui/tauri-plugin-dialog/Cargo.toml` | dependencies | `tauri-plugin-fs` | `version=3.0.0-alpha.2` |
| `tauri-plugin-mcp-bridge` | `crates/ui/tauri-plugin-mcp-bridge/Cargo.toml` | build-dependencies | `tauri-plugin` | `version==3.0.0-alpha.3, features=['build']` |
| `tauri-plugin-mcp-bridge` | `crates/ui/tauri-plugin-mcp-bridge/Cargo.toml` | dependencies | `tauri` | `version==3.0.0-alpha.4, default-features=False` |
| `tauri-plugin-mcp-bridge` | `crates/ui/tauri-plugin-mcp-bridge/Cargo.toml` | dependencies | `tauri-runtime-wry` | `version==3.0.0-alpha.4, default-features=False` |

## Manifestes de crates UI natives pertinents

- `crates/ui/app`: application Tauri, `tauri-build` en build-dependency, Tauri 3 API et plugins OS/dialog/clipboard/notification/process/log/window-state/single-instance/store/updater/global-shortcut/autostart/deep-link/fs/opener. Le code Rust enregistre plugins, commandes et événements, intègre kernel, modèles, fenêtres, mise à jour et assets UI.
- `crates/ui/tauri-wrap`: adaptateur Tauri pour modes bundle/remote/sidecar, politique de navigation, serveur loopback, fenêtre et pont de debug optionnel. Le pont MCP est behind feature `debug-bridge`, et actif uniquement en debug avec `APHRODY_TAURI_DEBUG=1`.
- `crates/ui/tauri-mcp` et `crates/ui/tauri-plugin-mcp-bridge`: serveur/outils MCP desktop et plugin qui expose des commandes, inspection DOM, fenêtres, captures, événements IPC/WebSocket. La passerelle MCP du kernel relaie les outils UI.
- `crates/ui/tauri-plugin-dialog`: plugin dialog intégré localement avec adaptations plateforme.
- `crates/shell/tauri`: shell Tauri partagé; `crates/shell/tauri-e2e`: binaire de scénario de test.
- `crates/koharu/koharu-app` et `crates/koharu/koharu`: application desktop Koharu bâtie sur Tauri, commandes et cycle de vie.
- Les mentions dans `crates/ai/gateway`, `crates/ai/app-server`, `crates/compat/n2b` et `crates/infra/git` décrivent respectivement l’autorisation d’origine `tauri://`, le partage avec l’app desktop, l’analyse/migration de projets et les catalogues/docs. Elles ne signifient pas que chaque package Rust dépend du runtime Tauri.

## Tauri — références Rust exhaustives

Le tableau liste chaque fichier Rust correspondant et les lignes contenant le motif. Les fichiers sont groupés par rôle.

### Tauri: fichiers et lignes

**configuration, discovery, or incidental reference (39 fichiers)**
- `crates/ai/app-server/src/lib.rs` : 1812, 1816
- `crates/ai/app-server/src/web.rs` : 2
- `crates/ai/gateway/src/server.rs` : 8, 54, 63, 329, 330, 331
- `crates/compat/n2b-core/src/ai/mod.rs` : 61, 62, 210
- `crates/compat/n2b-core/src/run.rs` : 45, 225, 246, 295, 296
- `crates/compat/n2b-core/src/scanners/cargo_toml.rs` : 74
- `crates/compat/n2b-core/src/scanners/mod.rs` : 33
- `crates/compat/n2b-core/src/scanners/package_json.rs` : 129, 130, 131, 132, 227, 229, 230, 231, 232, 234, 236, 237, 238, 239, 242, 243, 244, 245, 248, 249, 250, 251, 254, 255, 256, 257, 260, 261, 262, 263, 266, 267, 268, 269, 272, 273, 274, 275, 278, 279, 280, 281, 284, 285, 286, 287
- `crates/compat/n2b-core/src/scanners/tauri_conf.rs` : 15, 20, 21, 27, 49, 74, 91, 92
- `crates/compat/n2b/src/cli/args.rs` : 441
- `crates/compat/n2b/src/commands/rules.rs` : 199, 230, 298, 299, 300, 301, 302
- `crates/compat/n2b/src/rust_cmd.rs` : 36, 54, 64, 116, 675, 677, 686, 687, 690, 693, 705, 713, 720, 732, 739, 757, 758, 763, 765, 766, 767, 1353, 1354, 1355
- `crates/google/google/src/detection.rs` : 327
- `crates/infra/aphrody-command/src/lib.rs` : 2379, 2398
- `crates/infra/git/src/awesome.rs` : 5, 24, 25, 27, 286
- `crates/infra/git/src/upstream.rs` : 331, 344
- `crates/infra/infra/src/drive.rs` : 4
- `crates/os/kernel/comps/drive/crates/sd-client/src/client.rs` : 30
- `crates/os/kernel/comps/drive/xtask/src/main.rs` : 177, 178, 179, 181, 206, 207, 274
- `crates/os/stdio-capture/src/lib.rs` : 18
- `crates/shell/session/src/lib.rs` : 5
- `crates/shell/terminal-backend/src/lib.rs` : 216, 1049
- `crates/shell/terminal-core/src/lib.rs` : 2
- `crates/shell/vfs/src/lib.rs` : 5
- `crates/shell/web/src/lib.rs` : 5, 6
- `crates/shell/web/src/local.rs` : 6
- `crates/shell/web/src/wire.rs` : 5
- `crates/ui/identity/src/assets.rs` : 265, 275
- `crates/ui/identity/src/bin/export_assets.rs` : 11, 51, 52, 54
- `crates/ui/local-ai/src/lib.rs` : 4
- `crates/ui/m3-tokens/src/facade.rs` : 5, 90, 185
- `crates/ui/m3-tokens/src/lib.rs` : 9
- `crates/ui/m3-tokens/src/sheets.rs` : 64
- `crates/ui/render/src/gpu.rs` : 96
- `crates/ui/render/src/gpu3d.rs` : 215
- `crates/ui/render/src/lib.rs` : 8, 42, 117, 147
- `crates/ui/render/src/pipeline3d.rs` : 6
- `crates/web/web-engine/src/main.rs` : 384
- `crates/web/web-service/src/lib.rs` : 9, 101

**MCP bridge (3 fichiers)**
- `crates/ai/mcp/src/main.rs` : 50, 52, 408, 422, 2369, 2397, 3378, 3487, 3489, 3525
- `crates/ai/mcp/src/protocol.rs` : 37, 38, 39, 40, 41
- `crates/ai/mcp/src/tauri_tools.rs` : 2, 12, 14, 16, 18, 19, 23, 24, 28, 29, 33, 34, 38, 39, 43, 44, 48, 49, 53, 54, 58, 59, 63, 64, 68, 69, 73, 74, 78, 79, 84, 89, 130, 133, 137, 146, 167, 181

**tests (3 fichiers)**
- `crates/infra/git/tests/awesome_black_box.rs` : 107, 108, 109
- `crates/ui/app/tests/ui_dist_assets.rs` : 2, 4
- `crates/ui/identity/tests/brand_assets.rs` : 146, 149

**application and shell integration (55 fichiers)**
- `crates/koharu/koharu-app/src/app.rs` : 3, 5, 26, 42, 73, 106, 107, 116, 125, 220, 244, 247, 259, 262, 263, 266, 267, 271, 279, 281, 282, 283, 284, 288, 289
- `crates/koharu/koharu-app/src/commands/agent.rs` : 10, 24, 31, 93, 95, 96, 97, 109, 111, 112, 113, 151, 153, 154, 155, 169, 171, 172, 173, 186, 188, 211, 242, 244, 245, 246
- `crates/koharu/koharu-app/src/commands/agent/host.rs` : 13, 24, 29, 35, 146, 184, 419, 424
- `crates/koharu/koharu-app/src/commands/canvas.rs` : 12, 50, 60, 69, 84, 108, 118, 140, 172, 204, 235, 312, 344, 346
- `crates/koharu/koharu-app/src/commands/editing.rs` : 5, 27, 54, 81, 108, 139, 166, 192, 218, 246, 272, 304, 329
- `crates/koharu/koharu-app/src/commands/fonts.rs` : 8, 57, 62, 123
- `crates/koharu/koharu-app/src/commands/lifecycle.rs` : 9, 147, 149, 180, 208, 216, 231, 248, 262, 264, 280, 282, 298, 300, 311, 313, 334, 362, 364, 437
- `crates/koharu/koharu-app/src/commands/mod.rs` : 14, 56, 63, 64, 65, 66, 73, 75, 76, 77
- `crates/koharu/koharu-app/src/commands/output.rs` : 15, 27, 46, 48, 169
- `crates/koharu/koharu-app/src/commands/preferences.rs` : 157, 193, 199
- `crates/koharu/koharu-app/src/commands/processing.rs` : 9, 73, 76, 207, 212, 286
- `crates/koharu/koharu-app/src/lib.rs` : 1
- `crates/koharu/koharu-library/src/agent_host.rs` : 1
- `crates/koharu/koharu-library/src/agent_tools.rs` : 17
- `crates/koharu/koharu-library/src/bin/koharu-sdk.rs` : 2
- `crates/koharu/koharu/build.rs` : 2
- `crates/koharu/koharu/src/main.rs` : 17, 45
- `crates/shell/tauri-e2e/build.rs` : 3
- `crates/shell/tauri-e2e/src/main.rs` : 2, 5, 12, 13, 14, 16, 17
- `crates/shell/tauri/build.rs` : 12
- `crates/shell/tauri/src/lib.rs` : 2, 7, 22, 87, 89, 104, 121, 123, 157, 194, 205, 216, 226, 228, 229, 235, 237, 244, 249, 266, 270, 293, 300
- `crates/ui/app/build.rs` : 2, 3, 7, 22, 24, 29, 33, 35, 36, 85, 99
- `crates/ui/app/src/broker.rs` : 13, 30, 62, 461
- `crates/ui/app/src/desktop.rs` : 113, 123, 146, 156, 163, 202, 222, 232, 243, 250
- `crates/ui/app/src/identity.rs` : 4, 12, 341, 344, 350, 357, 384, 395, 406, 418
- `crates/ui/app/src/integration.rs` : 5, 16, 26, 31, 32, 33, 34, 35, 314, 333, 347, 392, 415, 416, 571, 587, 596, 631, 651, 659, 670, 700, 746, 750, 794
- `crates/ui/app/src/koharu.rs` : 11, 32, 59, 61, 62, 84, 86, 87
- `crates/ui/app/src/lib.rs` : 2, 11, 43, 49, 54, 60, 69, 86, 107, 109, 128, 130, 143, 145, 147, 157, 158, 162, 163, 164, 183, 196, 197, 200, 201, 207, 209, 212, 217, 218, 222, 227, 232, 237, 242, 247, 248, 252, 253, 257, 258, 262, 263, 267, 268, 272, 273, 277, 278, 283, 288, 298, 303, 307, 310, 321, 354, 369, 384, 409, 410, 415, 417, 424, 428, 429, 441, 444, 449, 459, 512, 517, 522, 527, 533, 539, 545, 553, 568, 634, 635, 653, 654, 689, 690, 698, 704, 707, 708, 709, 712, 715, 717, 721, 722, 726, 727, 728, 729, 730, 731, 735, 743, 744, 745, 747, 749, 750, 752, 754, 761, 766, 792, 796, 802, 806, 816, 822, 823, 835, 836, 897, 905, 906, 910, 913
- `crates/ui/app/src/llama_daemon.rs` : 8
- `crates/ui/app/src/main.rs` : 6
- `crates/ui/app/src/models.rs` : 2, 6, 19, 46, 65, 72, 79, 86, 97, 104, 111, 120, 175, 187, 189, 193, 237
- `crates/ui/app/src/quickbar.rs` : 5, 10, 11, 13, 117
- `crates/ui/app/src/runtime.rs` : 2, 4, 11
- `crates/ui/app/src/shenron.rs` : 30
- `crates/ui/app/src/studio.rs` : 7, 20, 21, 27, 28, 34, 36, 46, 47, 53, 70, 102, 115, 117, 118, 121, 131, 135, 151, 153, 154, 161, 175, 195, 201, 213, 234, 235, 236, 331, 381, 420, 446
- `crates/ui/app/src/window.rs` : 2, 14, 18, 19, 21, 48, 67, 98, 110, 194, 301
- `crates/ui/drive/build.rs` : 2, 4, 45, 60
- `crates/ui/drive/src/daemon.rs` : 2, 7, 25, 43, 173, 190, 227
- `crates/ui/drive/src/data_dir.rs` : 2
- `crates/ui/drive/src/drag/commands.rs` : 2, 8, 15, 17, 90, 92, 113, 115, 121, 122
- `crates/ui/drive/src/drag/events.rs` : 2
- `crates/ui/drive/src/drag/mod.rs` : 2, 19, 139, 150, 157, 164, 171, 181
- `crates/ui/drive/src/drag/session.rs` : 2
- `crates/ui/drive/src/file_opening/linux.rs` : 2
- `crates/ui/drive/src/file_opening/macos.rs` : 2
- `crates/ui/drive/src/file_opening/mod.rs` : 2, 21, 116, 169, 175, 187, 196, 206
- `crates/ui/drive/src/file_opening/win.rs` : 2
- `crates/ui/drive/src/files.rs` : 2, 8, 13, 19, 29, 49
- `crates/ui/drive/src/keybinds.rs` : 2, 12, 166, 178, 186, 194, 210
- `crates/ui/drive/src/lib.rs` : 2, 6, 35, 56, 100, 101, 106, 107, 117, 122, 127, 136, 138, 152, 181, 192, 204, 210, 215, 220, 228, 233, 238, 243, 245, 253, 258, 260, 270, 281, 293, 294, 306
- `crates/ui/drive/src/macos.rs` : 2
- `crates/ui/drive/src/rpc.rs` : 2, 9
- `crates/ui/drive/src/server.rs` : 2, 6, 175, 176, 177, 210, 231, 232, 233
- `crates/ui/drive/src/service.rs` : 2
- `crates/ui/drive/src/window.rs` : 4, 22, 23

**Tauri plugins and adapters (41 fichiers)**
- `crates/ui/tauri-mcp/src/main.rs` : 2, 20, 29, 32, 34, 35, 39, 40, 44, 45, 49, 50, 54, 55, 59, 60, 64, 65, 69, 70, 74, 75, 79, 80, 84, 85, 89, 90, 94, 95, 100, 105, 128, 218, 220, 221, 222, 225, 226, 227, 229, 230, 231, 233, 234, 239, 245, 247, 248, 251, 253, 258, 264, 266, 267, 269, 270, 271, 273, 274, 279, 284, 285, 289, 292, 294, 295, 297, 298, 302, 304, 305, 309, 312, 314, 319, 326, 340, 354, 359, 360, 381
- `crates/ui/tauri-plugin-dialog/build.rs` : 1, 8
- `crates/ui/tauri-plugin-dialog/src/commands.rs` : 1, 8, 9, 104, 155, 165, 180, 188, 198, 204, 213, 246, 255
- `crates/ui/tauri-plugin-dialog/src/desktop.rs` : 1, 14, 150, 168, 180, 198, 210, 226
- `crates/ui/tauri-plugin-dialog/src/error.rs` : 1, 14, 16, 23, 30
- `crates/ui/tauri-plugin-dialog/src/lib.rs` : 1, 13, 14, 18, 20, 30, 96, 117, 119, 123, 134, 136, 151, 153, 173, 175, 203, 214, 536, 537, 560, 563, 564, 565, 584, 585, 608, 609, 633, 634, 658, 659, 685, 686, 687, 707, 708, 709, 729, 730, 731, 752, 753, 754, 775, 776, 777
- `crates/ui/tauri-plugin-dialog/src/mobile.rs` : 1, 6, 14, 17
- `crates/ui/tauri-plugin-dialog/src/models.rs` : 1
- `crates/ui/tauri-plugin-mcp-bridge/build.rs` : 2
- `crates/ui/tauri-plugin-mcp-bridge/src/commands/backend_state.rs` : 5, 9, 16, 44, 57, 58
- `crates/ui/tauri-plugin-mcp-bridge/src/commands/element_picker.rs` : 3, 9, 12, 15
- `crates/ui/tauri-plugin-mcp-bridge/src/commands/emit_event.rs` : 4, 14, 26
- `crates/ui/tauri-plugin-mcp-bridge/src/commands/execute_command.rs` : 4, 6, 9, 13, 25, 36, 43
- `crates/ui/tauri-plugin-mcp-bridge/src/commands/execute_js.rs` : 3, 5, 13
- `crates/ui/tauri-plugin-mcp-bridge/src/commands/ipc_monitor.rs` : 4, 6, 8, 24, 65, 107
- `crates/ui/tauri-plugin-mcp-bridge/src/commands/list_windows.rs` : 5, 32, 42, 97, 106, 152, 162
- `crates/ui/tauri-plugin-mcp-bridge/src/commands/mod.rs` : 3
- `crates/ui/tauri-plugin-mcp-bridge/src/commands/resize_window.rs` : 4, 7, 53
- `crates/ui/tauri-plugin-mcp-bridge/src/commands/screenshot.rs` : 4
- `crates/ui/tauri-plugin-mcp-bridge/src/commands/script_executor.rs` : 6
- `crates/ui/tauri-plugin-mcp-bridge/src/commands/script_injection.rs` : 4
- `crates/ui/tauri-plugin-mcp-bridge/src/commands/window_info.rs` : 4, 13, 30
- `crates/ui/tauri-plugin-mcp-bridge/src/config.rs` : 71, 74, 77, 108, 128, 150
- `crates/ui/tauri-plugin-mcp-bridge/src/discovery.rs` : 1, 3
- `crates/ui/tauri-plugin-mcp-bridge/src/lib.rs` : 1, 3, 4, 9, 15, 23, 26, 29, 30, 31, 32, 40, 49, 99, 109, 113, 117, 122, 124, 125, 126, 127, 135, 148, 152, 154, 155, 157, 166, 181, 203, 211, 220
- `crates/ui/tauri-plugin-mcp-bridge/src/monitor.rs` : 3, 11, 18, 27, 49, 63, 92, 112, 131, 154, 187, 201, 214
- `crates/ui/tauri-plugin-mcp-bridge/src/screenshot/android.rs` : 2, 22
- `crates/ui/tauri-plugin-mcp-bridge/src/screenshot/ios.rs` : 2, 28
- `crates/ui/tauri-plugin-mcp-bridge/src/screenshot/linux.rs` : 2, 21, 23
- `crates/ui/tauri-plugin-mcp-bridge/src/screenshot/macos.rs` : 2, 30, 33, 35, 42
- `crates/ui/tauri-plugin-mcp-bridge/src/screenshot/mod.rs` : 6, 25
- `crates/ui/tauri-plugin-mcp-bridge/src/screenshot/windows.rs` : 2, 26, 28, 33
- `crates/ui/tauri-plugin-mcp-bridge/src/utils.rs` : 1, 4, 19, 20
- `crates/ui/tauri-plugin-mcp-bridge/src/websocket.rs` : 4, 13, 139, 143, 168, 178, 220, 224, 272, 274, 301, 302, 303, 313, 351, 384, 459, 588, 620, 656, 695, 730, 732, 734, 1046
- `crates/ui/tauri-wrap/src/config.rs` : 2, 12, 178, 200
- `crates/ui/tauri-wrap/src/debug.rs` : 2, 3, 4, 7, 8, 9, 18, 20, 21, 22, 24, 25, 33, 35, 41, 43, 45, 74, 95, 96, 112, 129, 148, 155, 169, 173, 200, 207, 245, 247
- `crates/ui/tauri-wrap/src/lib.rs` : 2, 3, 9, 14, 15, 16, 17, 20, 28, 43, 44, 110, 121
- `crates/ui/tauri-wrap/src/policy.rs` : 3, 4, 205
- `crates/ui/tauri-wrap/src/serve.rs` : 2, 15, 52, 153, 157, 160
- `crates/ui/tauri-wrap/src/sidecar.rs` : 13
- `crates/ui/tauri-wrap/src/window.rs` : 8, 9, 23, 26, 86


### Obscura: fichiers et lignes

**AI, search, and agent consumers (6 fichiers)**
- `crates/ai/agent-tools/src/web_tools.rs` : 349
- `crates/ai/mcp/src/browser_tools.rs` : 2, 4, 5, 147, 194, 197
- `crates/ai/mcp/src/native_crawl_tools.rs` : 10, 148
- `crates/google/google/src/detection.rs` : 327
- `crates/google/google/src/search/network.rs` : 382
- `crates/google/google/src/search/serp.rs` : 6, 144

**operations or incidental reference (12 fichiers)**
- `crates/infra/aphrody-command/src/codex_provision.rs` : 10, 205
- `crates/infra/aphrody-command/src/lib.rs` : 391
- `crates/infra/aphrody-command/src/pillars_cmd.rs` : 7
- `crates/infra/aphrody-command/src/pillars_cmd/web.rs` : 228, 258, 462, 852, 886, 927, 928, 932, 1066, 1121, 1139, 1140, 1206, 1207, 1311, 1378, 1380
- `crates/os/kernel/core/build.rs` : 4
- `crates/os/kernel/core/src/main.rs` : 43, 141
- `crates/os/kernel/core/src/mcp_proxy.rs` : 400
- `crates/os/kernel/core/src/rpc.rs` : 21, 106
- `crates/ui/app/src/lib.rs` : 14
- `crates/ui/app/src/web_subsystem.rs` : 7
- `crates/ui/identity/src/logo.rs` : 96
- `crates/ui/m3-reproduce/src/crawl.rs` : 12

**web and FFI consumers (23 fichiers)**
- `crates/interop/ffi/src/web/dom.rs` : 10, 34, 57, 449
- `crates/interop/ffi/src/web/mod.rs` : 116, 125, 135, 147, 234, 239, 244
- `crates/interop/ffi/src/web/native_http.rs` : 1, 4, 13, 15, 24, 25, 26, 53, 65, 75, 78, 82, 84, 91, 113, 182, 197, 262, 272
- `crates/interop/ffi/src/web/net.rs` : 47
- `crates/web/web-bridge/src/cli.rs` : 411, 520, 611
- `crates/web/web-bridge/src/error.rs` : 43
- `crates/web/web-bridge/src/fetch.rs` : 31, 76, 389, 410, 451
- `crates/web/web-bridge/src/ffi.rs` : 13, 14, 88, 99, 112, 131
- `crates/web/web-bridge/src/lib.rs` : 7
- `crates/web/web-crawl/src/blocking.rs` : 5, 15, 44, 56, 119, 120
- `crates/web/web-crawl/src/lib.rs` : 26
- `crates/web/web-crawl/src/mediawiki.rs` : 11, 98, 101, 264
- `crates/web/web-crawl/src/mirror.rs` : 2, 13, 14, 36, 203, 206
- `crates/web/web-crawl/src/runner.rs` : 10, 11, 33, 34, 35, 38, 40, 44, 46, 51
- `crates/web/web-crawl/src/wiki.rs` : 12, 30, 144
- `crates/web/web-crawl/src/wiki_page.rs` : 8, 9, 103, 175, 191, 241, 403, 482, 776, 925, 981, 1040
- `crates/web/web-engine/src/crawl.rs` : 12, 16, 17, 70, 74, 194, 209, 402, 436, 447, 603, 718, 728, 777, 781
- `crates/web/web-engine/src/main.rs` : 12, 155, 241, 272, 292, 293, 368, 384, 588, 652, 653, 670, 825, 1036, 1054, 1078, 1109, 1110, 1153, 1169, 1204, 1211, 1218, 1230, 1245, 1253, 1267, 1281, 1350
- `crates/web/web-engine/src/worker.rs` : 5, 48
- `crates/web/web-extract/src/dom.rs` : 1, 6, 580, 581
- `crates/web/web-extract/src/lib.rs` : 19
- `crates/web/web-extract/src/url_metadata.rs` : 87
- `crates/web/web-service/src/lib.rs` : 8, 50, 99, 179, 181, 187, 193, 196, 205

**Obscura implementation (58 fichiers)**
- `crates/web/obscura-browser/src/context.rs` : 3, 8, 19, 20, 21, 101, 166
- `crates/web/obscura-browser/src/lib.rs` : 11, 12, 13, 14, 16
- `crates/web/obscura-browser/src/page.rs` : 4, 5, 6, 7, 14, 19, 102, 186, 222, 224, 277, 296, 315, 323, 333, 338, 673, 742, 816, 966, 1025, 1075, 1083, 1094, 1304, 1340, 1341, 1342, 1343, 1344, 1345, 1346, 1347, 1351, 1402, 1599, 1623, 1639, 1659, 1671, 1673, 1674, 1675, 1910, 1992, 1994, 2013, 2035, 2041, 2048, 2054, 2073, 2076, 2283, 2326, 2345, 2393, 2413, 2422, 2453, 2846, 2893, 2919, 3022, 3206, 3246, 3295, 3322, 3345, 3510, 3511, 3758, 3762, 3764, 3773, 3813, 3815, 3834, 3835, 3842, 3843, 3844, 3847, 3849, 3857, 3858, 3859, 3860, 3862, 3878, 3880, 3882, 3889, 3896, 3901, 3902, 3905, 3960, 4026, 4032, 4045, 4068, 4079, 4103, 4118, 4130, 4150, 4281, 4397, 4402, 4434, 4437, 4439, 4514, 4576, 4590, 5011, 5020, 5029, 5117, 5123, 5220, 5233, 6007, 6058, 6075, 6084, 6104, 6105, 6106, 6913, 6914, 7219, 7313, 7342, 7418, 7605, 7760, 8030, 8032, 8109, 8184, 8287, 8520, 8560, 8601, 8659, 8701, 8848, 8853, 8854, 8883, 8890
- `crates/web/obscura-browser/src/pdf.rs` : 10, 179, 193, 269, 273, 275, 283, 291, 702, 710, 777, 799
- `crates/web/obscura-browser/src/profiles.rs` : 82, 83, 85, 95
- `crates/web/obscura-cdp/src/cookie_params.rs` : 1, 32, 134
- `crates/web/obscura-cdp/src/dispatch.rs` : 6, 7, 383, 784, 786, 787, 795, 852, 907, 916
- `crates/web/obscura-cdp/src/domains/accessibility.rs` : 3, 4, 363, 367, 371, 376, 404, 485, 560, 575, 607, 613, 675
- `crates/web/obscura-cdp/src/domains/browser.rs` : 33
- `crates/web/obscura-cdp/src/domains/dom.rs` : 1, 2, 20, 21, 157, 188, 237, 255, 284, 312, 723, 746, 789, 796, 835
- `crates/web/obscura-cdp/src/domains/domsnapshot.rs` : 9, 17
- `crates/web/obscura-cdp/src/domains/fetch.rs` : 180
- `crates/web/obscura-cdp/src/domains/input.rs` : 22, 30, 32, 35, 50, 53, 55, 57, 111, 113, 114, 116, 120, 128, 150, 153, 160, 165, 183, 185, 186, 192, 204, 218, 228, 230, 234, 236, 237, 304, 368, 392, 400, 404, 420
- `crates/web/obscura-cdp/src/domains/io.rs` : 15, 19
- `crates/web/obscura-cdp/src/domains/lp.rs` : 1
- `crates/web/obscura-cdp/src/domains/network.rs` : 3, 150, 389
- `crates/web/obscura-cdp/src/domains/page.rs` : 1, 73, 85, 86, 100, 101, 259, 261, 264, 267, 270, 280, 304, 387, 390, 412, 417, 437, 438, 439, 440, 483, 529, 530, 639, 679, 727, 807, 1005, 1116, 1117, 1124, 1190, 1344, 1526, 1527, 1568, 1598, 1606, 1622, 1642, 1643, 1689, 1691, 1813, 2233, 2234, 2434
- `crates/web/obscura-cdp/src/domains/pdf.rs` : 29, 57, 107, 114, 127, 183, 185, 218, 219, 220, 221, 222, 223, 237, 316, 317, 318, 324, 325, 395, 396, 437, 438, 439, 440, 441, 442, 443, 444, 445
- `crates/web/obscura-cdp/src/domains/runtime.rs` : 1, 2, 230, 244, 249, 352, 359, 385, 409, 723
- `crates/web/obscura-cdp/src/domains/storage.rs` : 13, 67
- `crates/web/obscura-cdp/src/domains/target.rs` : 78, 231
- `crates/web/obscura-cdp/src/server.rs` : 56, 60, 62, 318, 319, 324, 327, 331, 341, 359, 400, 484, 510, 547, 697, 698, 720, 786, 790, 799, 800, 801, 1050, 1054, 1056, 1060, 1077, 1182, 1259, 1265, 1474, 1490, 1533, 1547, 1567, 1570, 1632, 1658, 2042, 2234, 2483
- `crates/web/obscura-cdp/src/util.rs` : 22
- `crates/web/obscura-dom/src/selector.rs` : 20, 22, 124, 173, 185, 187, 188, 307, 625, 630, 633, 637, 1058, 1155
- `crates/web/obscura-dom/src/serialize.rs` : 58
- `crates/web/obscura-dom/src/tree.rs` : 787, 1086, 1108, 1124, 1678, 1701
- `crates/web/obscura-dom/src/tree_sink.rs` : 75, 80, 87, 100, 112, 124, 359
- `crates/web/obscura-js/build.rs` : 8, 26, 28, 31, 34, 51, 57, 60, 69, 79, 95, 120, 134, 141, 163, 172
- `crates/web/obscura-js/src/frame.rs` : 24, 27, 28, 56, 82, 104, 105, 124, 141, 150, 165, 203, 210, 219, 239, 282, 300, 360, 361, 444, 538, 606, 901, 938, 940, 1089, 1112, 1138, 1149, 1155, 1157, 1183, 1189, 1215
- `crates/web/obscura-js/src/lib.rs` : 13, 15
- `crates/web/obscura-js/src/markdown.rs` : 2, 3
- `crates/web/obscura-js/src/module_loader.rs` : 14, 59, 69, 70, 72, 82, 97, 98, 101, 115, 118, 142, 256, 303
- `crates/web/obscura-js/src/ops.rs` : 10, 15, 16, 17, 21, 93, 106, 120, 194, 199, 203, 205, 218, 222, 267, 272, 292, 340, 344, 384, 386, 388, 398, 422, 501, 550, 557, 568, 570, 621, 909, 921, 922, 928, 943, 944, 950, 969, 979, 988, 992, 1024, 1025, 1027, 1030, 1034, 1038, 1045, 1049, 1056, 1057, 1061, 1123, 1142, 1143, 1156, 1160, 1172, 1659, 2036, 2037, 2058, 2081, 2368, 2369, 2370, 2402, 2409, 2431, 2443, 2448, 2466, 3708, 3711, 3716, 3761, 4067, 4083, 4168, 4241, 4296, 4324, 4333, 4350, 4388, 4411, 4463, 4464, 4465, 4499, 4501, 4502, 4515, 4516, 4530, 4531, 4535, 4540, 4545, 4546, 4554, 4555, 4560, 4566, 4567, 4569, 4574, 4575, 4580, 4585, 4586, 4601, 4603, 4610, 4633, 4635, 4638, 4656, 4663, 4671, 4746, 4753, 4925, 5560, 5574, 5589, 5634, 5787, 5817, 5822, 5831, 5864, 5865, 5866, 5867, 5870, 5871, 5872, 5873, 5876, 5882, 5888, 5894, 5900, 5924, 5929, 5945, 5969, 5988, 6009, 6013, 6019, 6020, 6036, 6043, 6056, 6068, 6078, 6092, 6110, 6127, 6132, 6140, 6150, 6151, 6162, 6174, 6179, 6185, 6279, 6293, 6328, 6544, 6579, 6584, 6590, 6606, 6621, 6734, 6799, 6829, 6855, 6935
- `crates/web/obscura-js/src/runtime.rs` : 11, 15, 17, 27, 29, 38, 39, 41, 49, 54, 152, 153, 188, 199, 200, 219, 262, 280, 293, 345, 475, 498, 538, 543, 593, 594, 604, 689, 721, 745, 787, 876, 877, 878, 879, 880, 881, 882, 923, 981, 1018, 1116, 1120, 1131, 1138, 1156, 1157, 1177, 1254, 1257, 1258, 1365, 1373, 1374, 1385, 1410, 1414, 1415, 1416, 1417, 1431, 1433, 1449, 1450, 1454, 1461, 1462, 1489, 1490, 1502, 1507, 1509, 1519, 1520, 1565, 1569, 1570, 1595, 1605, 1622, 1623, 1630, 1632, 1635, 1636, 1645, 1647, 1649, 1652, 1667, 1669, 1672, 1673, 1682, 1684, 1686, 1689, 1706, 1709, 1712, 1713, 1721, 1724, 1732, 1736, 1852, 2056, 2058, 2250, 2254, 2255, 2266, 2337, 2338, 2339, 2340, 2341, 2342, 2358, 2359, 2360, 2361, 2375, 2406, 2422, 2434, 2445, 2495, 2496, 2497, 2498, 2499, 2500, 2501, 2516, 2557, 2568, 2575, 2584, 2605, 2623, 2646, 2648, 2660, 2675, 2688, 2691, 2692, 2710, 2713, 2714, 2810, 3144, 3165, 3174, 3199, 3682, 3743, 3851, 3853, 4043, 4049, 4058, 4091, 4099, 4103, 4105, 4116, 4119, 4151, 4159, 4160, 4182, 4183, 4194, 4220, 4221, 4273, 4274, 4275, 4463, 4472, 4567, 4599, 4657, 5519, 6881, 6897, 6933, 6951, 6965, 7098, 7191, 7275, 7328, 7369, 7535, 7716, 7717, 7744, 7766, 7769, 7770, 7863, 7864, 8300, 9113, 9185, 9307, 9364, 9413, 9446, 9481, 9525, 9588, 9678, 9775, 9843, 9895, 9903, 9931, 9952, 9999, 10013, 10014, 10028, 10032, 10051, 10056, 10071, 10076, 10086, 10107, 10116, 10123, 10144, 10149, 10209, 10213, 10226, 10239, 10243, 10256, 10275, 10280, 10311, 10322, 10327, 10351, 10367, 10404, 10432, 10467, 10496, 10560, 10561, 10678, 10688, 10699, 10717, 10731, 10737, 10770, 10791, 10798, 10857, 10869, 10881, 10895, 10911, 10939, 10953, 10958, 10964, 10965, 10987, 10997, 11026, 11031, 11048, 11059, 11071, 11104, 11124, 11211, 11234, 11235, 11258, 11315, 11396, 11417, 11418, 11436, 11437, 11467, 11468, 11493, 11526, 11577, 11605, 11669, 11687, 11698, 11699, 11700, 11701, 11706, 11710, 11784, 11837, 11859, 11860, 11873, 11887, 11944, 11970, 11996, 12053, 12064, 12065, 12066, 12067, 12072, 12076, 12142, 12174, 12222, 12291, 12397, 12458, 12504, 12553, 12596, 12647, 12697, 13236, 13248, 13294, 13295, 13296, 13325, 13467, 13553, 13563, 13656, 13663, 13670, 13677, 13685, 13692, 13946, 13947, 13948, 13952, 14014, 14017, 14018, 14128, 14132, 14133, 14507, 14597, 14617, 14828, 15685, 15792, 15814, 15835, 16016, 16017, 16018, 16019, 16221, 16223, 16473, 16476, 16487, 16514, 16516, 16529, 16558, 16561, 16568, 16592, 16595, 16633, 16661, 16692, 16693, 16735, 16738, 16798, 16829, 16841, 16917, 16956, 17003, 17004, 17007, 17008, 17018, 17051, 17083, 17221, 17222, 17270, 17396, 17397, 17451, 17453, 17483, 17497, 17533, 17535, 17553, 17626, 17628, 17645, 17671, 17674, 17699, 17702, 18355, 18357, 18358, 18368, 18370, 18371, 18393, 18414, 18416, 18429, 18435, 18501, 18504, 18505, 18529, 18531, 18532, 18560, 18562, 18563, 18599, 18601, 18602, 18620, 18668, 18670, 18671, 18702, 18719, 18733, 18751, 18769, 18792, 18795, 18802, 18812, 18813, 18821, 18830, 18831, 19257, 19259, 19272
- `crates/web/obscura-js/src/v8_flags.rs` : 7, 40, 43, 71
- `crates/web/obscura-js/src/write_stream.rs` : 23
- `crates/web/obscura-mcp/build.rs` : 41, 46, 51
- `crates/web/obscura-mcp/src/aphrody.rs` : 3
- `crates/web/obscura-mcp/src/http.rs` : 63, 65, 232, 236, 280, 367
- `crates/web/obscura-mcp/src/lib.rs` : 15, 16, 214, 224, 318, 321, 921, 956, 996, 1079, 1080, 1081, 1105, 1106, 1275, 1339, 1350, 1358, 1395, 1401, 1408, 1420, 1442, 1460, 1475, 1486, 1509, 1606, 1652, 1653, 1654, 1663, 1664, 1665, 1685, 1686, 1696, 1697, 1698, 1892, 1973, 1974, 1977, 2178, 2181, 2453, 2486, 2601
- `crates/web/obscura-net/src/client.rs` : 300, 304, 334, 409, 411, 422, 428, 437, 443, 451, 452, 614, 717, 758, 762, 776, 784, 797, 812, 814, 822, 852, 858, 863, 871, 885, 903, 916, 931, 944, 1116, 1134, 1194, 1195, 1209, 1213, 1224, 1238, 1248, 1263, 1267, 1277, 1287, 1307, 1372, 1512, 1540, 1561, 1729, 1759, 1762, 1818, 1842, 1849, 1883, 2180, 2244, 2250, 2252, 2265, 2284, 2292, 2299, 2307, 2309, 2323, 2358, 2365, 2384, 2401, 2421, 2431, 2445, 2525, 2543, 2599, 2612, 2672, 2713, 2740, 2770, 2789, 2895, 2909, 2921
- `crates/web/obscura-net/src/cookies.rs` : 259, 602
- `crates/web/obscura-net/src/encoding.rs` : 3
- `crates/web/obscura-net/src/lib.rs` : 20
- `crates/web/obscura-net/src/robots.rs` : 144, 158, 167
- `crates/web/obscura-net/src/wreq_client.rs` : 19, 94, 100, 105, 114, 129, 150, 209, 259, 267, 275, 284, 293, 378, 409, 412, 440, 454, 476, 491, 512, 569, 632, 779, 826
- `crates/web/obscura-render/src/bin/paint_file.rs` : 5, 6
- `crates/web/obscura-render/src/css.rs` : 12, 79, 6225, 6993, 7230, 7283, 7314, 7389, 7454, 7491, 7516, 7616, 7723, 7734, 7788, 7937, 8021, 8073, 8117, 8180, 8458, 8700, 8739, 8802, 8879, 8899, 8964, 9149, 9185, 9209, 9241, 9279, 9317, 9426, 9474
- `crates/web/obscura-render/src/dom.rs` : 14, 23, 519, 2224, 2392, 2644, 2686, 3069, 3267, 3542, 3543, 3642, 3675, 3696, 4133, 4230, 4520, 4555, 9001, 9109, 9280, 9305, 9389, 11312, 12537, 12631, 12640, 12787, 12880, 13311, 13384, 14164, 16907, 16999, 17156, 17358, 17369
- `crates/web/obscura-render/src/inline.rs` : 29, 2325, 2985, 2991, 3629, 3676, 3702, 3750, 3767, 3867, 4090, 4175, 4270, 4347, 4372, 4386, 4390, 4394, 4453, 4558, 4562, 4566, 4596, 4640, 4644, 4652, 4687, 4691, 4697, 4756, 4771, 4801, 4847, 4890, 4919, 4992
- `crates/web/obscura-render/src/lib.rs` : 1, 3, 134, 578, 1342, 1926, 1942, 1943, 1944, 1949, 1960, 1968, 1982, 1999, 2006, 2074, 2116, 2164, 2172
- `crates/web/obscura-render/src/paint.rs` : 14, 47, 98, 115, 116, 146, 147, 401, 420, 445, 580, 581, 582, 613, 634, 676, 682, 835, 841, 858, 861, 903, 998, 1027, 1054, 1065, 1083, 1137, 1138, 1204, 1229, 1246, 1259, 1273, 1277, 1332, 1379, 1730, 1741, 1756, 1772, 1801, 1828, 2445, 2448, 3029, 3071, 3116, 3151, 3152, 3297, 3301, 3305, 3306, 3307, 3308, 3309, 3383, 3388, 3419, 3420, 3421, 3422, 3423, 3481, 3496, 3502, 3504, 5093, 5094, 5095, 5097, 5099, 5108, 5109, 5110, 5114, 5115, 5116, 5119, 5167, 5172, 5226, 5228, 5251, 5279, 5361, 5384, 6072, 6099, 6488, 8742, 8743, 8796, 8799, 8800, 8801, 8802, 8803, 8888, 8919, 9979, 9991, 9992, 9994, 9997, 10031, 10033, 10036, 10040, 10406, 10407, 10410, 10952, 11777, 14425
- `crates/web/obscura-render/src/style.rs` : 4642, 10029
- `crates/web/obscura/examples/basic.rs` : 4, 8
- `crates/web/obscura/src/browser.rs` : 9, 10, 48
- `crates/web/obscura/src/cookie.rs` : 3
- `crates/web/obscura/src/lib.rs` : 1, 4, 27, 28
- `crates/web/obscura/src/page.rs` : 3, 4, 9, 127

**tests (52 fichiers)**
- `crates/web/obscura-browser/tests/binary_fetch_body.rs` : 7, 83
- `crates/web/obscura-browser/tests/input_accept.rs` : 3
- `crates/web/obscura-browser/tests/unhandled_rejection.rs` : 6, 42
- `crates/web/obscura-cdp/tests/accept_thread_survives_silent_connections.rs` : 17, 46
- `crates/web/obscura-cdp/tests/accessibility_names.rs` : 1
- `crates/web/obscura-cdp/tests/backspace_surrogate.rs` : 4
- `crates/web/obscura-cdp/tests/binding_called_session.rs` : 7, 80, 90, 102, 117, 123, 144, 145, 152
- `crates/web/obscura-cdp/tests/cdp_click_submit_parity.rs` : 1, 86
- `crates/web/obscura-cdp/tests/child_frame_tree.rs` : 6, 120, 177, 204
- `crates/web/obscura-cdp/tests/concurrent_connections_heavy_page.rs` : 20, 209
- `crates/web/obscura-cdp/tests/concurrent_navigations.rs` : 19, 114
- `crates/web/obscura-cdp/tests/concurrent_navigations_with_fetch.rs` : 4, 20, 213
- `crates/web/obscura-cdp/tests/concurrent_page_isolation.rs` : 21, 33
- `crates/web/obscura-cdp/tests/control_plane_unblocked.rs` : 9, 50
- `crates/web/obscura-cdp/tests/dynamic_script_onload_fires.rs` : 9, 177, 200
- `crates/web/obscura-cdp/tests/dynamic_stylesheet_onload_fires.rs` : 7, 85
- `crates/web/obscura-cdp/tests/execution_context_ownership.rs` : 1, 13
- `crates/web/obscura-cdp/tests/execution_context_pruned_on_navigation.rs` : 4, 16
- `crates/web/obscura-cdp/tests/form_submit_method_bypasses_listener.rs` : 8, 84, 115, 169, 184, 208, 213
- `crates/web/obscura-cdp/tests/iframe_event_dispatch.rs` : 8, 75
- `crates/web/obscura-cdp/tests/input_key_event_escaping.rs` : 9, 70, 129, 184
- `crates/web/obscura-cdp/tests/input_mouse_event_parity.rs` : 3, 101
- `crates/web/obscura-cdp/tests/input_mouse_label_activation.rs` : 3, 73
- `crates/web/obscura-cdp/tests/js_fetch_emits_network_events.rs` : 8, 124, 179
- `crates/web/obscura-cdp/tests/max_connections_cap.rs` : 8, 17, 101, 132
- `crates/web/obscura-cdp/tests/nodefilter_constants.rs` : 9, 66
- `crates/web/obscura-cdp/tests/page_frame_contract.rs` : 1, 99
- `crates/web/obscura-cdp/tests/runtime_by_value_undefined.rs` : 1
- `crates/web/obscura-cdp/tests/runtime_console_events.rs` : 1, 220
- `crates/web/obscura-cdp/tests/runtime_get_properties_objectid_escaping.rs` : 3, 15
- `crates/web/obscura-cdp/tests/scroll_event_on_assignment.rs` : 18, 86
- `crates/web/obscura-cdp/tests/structured_clone_crypto_parity.rs` : 15, 78
- `crates/web/obscura-cdp/tests/textarea_enter_selection.rs` : 1
- `crates/web/obscura-cdp/tests/treewalker_document_order.rs` : 1, 51
- `crates/web/obscura-cdp/tests/window_conformance_parity.rs` : 6, 69
- `crates/web/obscura-js/tests/multi_isolate_teardown.rs` : 1, 5, 6, 18, 19, 34, 35
- `crates/web/obscura-mcp/tests/cors_preflight.rs` : 29, 79
- `crates/web/obscura-mcp/tests/sse_stream_does_not_wedge.rs` : 33
- `crates/web/obscura-render/tests/layout_test.rs` : 4, 8, 9, 46, 47, 50, 428, 537, 850, 1674, 1732, 2302, 2303, 2534, 2535, 2536, 2608, 3709, 3710, 3711, 3712, 3774, 3849, 3910, 3965, 4080, 4271, 4278, 4283, 4285, 4305, 4453
- `crates/web/obscura-render/tests/text_decoration.rs` : 3, 4
- `crates/web/obscura/tests/attribute_injection.rs` : 7
- `crates/web/obscura/tests/child_frame_scripts.rs` : 8, 84, 87, 93, 95, 96, 329, 365
- `crates/web/obscura/tests/concurrent_isolate_teardown.rs` : 3, 15, 44, 70, 81, 96, 133
- `crates/web/obscura/tests/fetch_relative_url_resolution.rs` : 11, 65
- `crates/web/obscura/tests/image_shim.rs` : 9, 48, 81, 117
- `crates/web/obscura/tests/interception.rs` : 1, 13, 53, 121, 161, 219
- `crates/web/obscura/tests/select_semantics.rs` : 14, 48, 86
- `crates/web/obscura/tests/sequential_runtime_fetch.rs` : 3, 82
- `crates/web/obscura/tests/stealth_transport.rs` : 9, 68, 69
- `crates/web/obscura/tests/textarea_semantics.rs` : 16, 50, 90
- `crates/web/obscura/tests/xhr_binary_response.rs` : 18, 60
- `crates/web/web-bridge/tests/native_profiles.rs` : 43


### Bun: fichiers et lignes

**FFI, docs, fixtures, or parity references (63 fichiers)**
- `crates/ai/agent-home/src/sync.rs` : 16
- `crates/ai/app-server/build.rs` : 8, 29
- `crates/ai/embed/src/server.rs` : 5
- `crates/ai/mcp/src/dragonball_tools.rs` : 6
- `crates/ai/mcp/src/main.rs` : 408, 422, 2220, 2368, 2397, 4167
- `crates/ai/mcp/src/protocol.rs` : 18, 48, 313, 314
- `crates/ai/mcp/src/public_web_tools.rs` : 532, 533, 551, 552
- `crates/ai/models/src/paths.rs` : 186
- `crates/ai/prompts/src/unified_system_prompt.rs` : 72
- `crates/ai/rag-core/src/text.rs` : 181
- `crates/ai/rag/src/dragonball.rs` : 8
- `crates/ai/rag/src/shenron.rs` : 150, 338
- `crates/ai/skills-forge/src/lint.rs` : 12, 130, 132, 135, 289, 293, 299
- `crates/ai/skills-forge/src/skill.rs` : 10, 28, 41, 42, 56, 69, 114
- `crates/ai/summary/src/lib.rs` : 47
- `crates/ai/translate/src/translate.rs` : 360
- `crates/compat/bun-docs/src/lib.rs` : 2, 4, 5, 7, 9, 10, 12, 30, 32, 205, 237, 338, 340, 341, 342, 368, 370, 374, 393, 402, 424, 436, 455, 465, 494, 495, 552, 556, 562, 563, 567, 577, 578, 591, 592, 600, 601, 617, 645, 655, 669, 686, 710, 711, 716, 728, 729, 731, 740, 755, 766, 776, 787, 807, 821, 843, 858, 862, 876, 877, 884, 889, 901, 904, 905, 908, 911, 920
- `crates/compat/oxc-bridge/src/lib.rs` : 1
- `crates/google/google/src/lib.rs` : 4, 54
- `crates/google/google/src/search/network.rs` : 608, 610
- `crates/google/google/src/search/serp.rs` : 295, 297, 299, 303, 305, 306
- `crates/infra/aphrody-command/src/codex_provision.rs` : 8, 55
- `crates/infra/aphrody-command/src/commands.rs` : 456, 457, 458, 463, 475, 476, 478, 495, 529, 532, 542, 543, 848, 913, 917, 923, 962, 968
- `crates/infra/aphrody-command/src/discord_cmd.rs` : 15, 29
- `crates/infra/aphrody-command/src/docs_cmd.rs` : 47, 70
- `crates/infra/aphrody-command/src/git_cmd.rs` : 397, 408, 460, 482, 488, 494
- `crates/infra/aphrody-command/src/lib.rs` : 1044, 2204, 2255
- `crates/infra/aphrody-command/src/nl_tokens.rs` : 8, 24, 26, 61, 134, 138, 143
- `crates/infra/aphrody-command/src/ocr_shenron.rs` : 25, 168, 169, 177, 181, 182, 185, 189, 191, 216, 248, 258, 262, 268, 270, 454
- `crates/infra/aphrody-command/src/package_cmd.rs` : 59, 70, 97, 185, 269, 287, 288, 290, 292, 331, 377
- `crates/infra/aphrody-command/src/scan_cmd.rs` : 226, 346
- `crates/infra/aphrody-command/src/winclean_cmd.rs` : 11
- `crates/infra/git/src/awesome.rs` : 5, 21, 286
- `crates/infra/git/src/ingest.rs` : 45, 54, 55
- `crates/infra/infra/src/devenv.rs` : 11, 55, 63, 64, 70, 98, 114, 178, 195, 205
- `crates/infra/infra/src/main.rs` : 32, 50, 531, 596, 646, 650, 655, 884, 1084, 1673, 1684, 1694, 1698, 1702, 2129, 2130, 2238, 2248, 2253
- `crates/infra/infra/src/pipeline.rs` : 4, 36, 38, 48, 57, 73, 275, 276
- `crates/infra/ssh/src/lib.rs` : 2184, 2192
- `crates/interop/ffi/src/lib.rs` : 5, 63, 66, 179, 971
- `crates/interop/ffi/src/web/embed.rs` : 5
- `crates/interop/ffi/src/web/extract.rs` : 213
- `crates/interop/ffi/src/web/index.rs` : 7
- `crates/interop/ffi/src/web/jobs.rs` : 4
- `crates/interop/ffi/src/web/native_http.rs` : 1, 5
- `crates/interop/ffi/src/zerocopy.rs` : 2
- `crates/koharu/koharu-library/src/bin/koharu-sdk.rs` : 2
- `crates/os/kernel/comps/drive/xtask/src/main.rs` : 274
- `crates/os/kernel/core/src/client.rs` : 218
- `crates/os/kernel/core/src/lib.rs` : 7
- `crates/os/kernel/core/src/main.rs` : 102
- `crates/os/kernel/core/src/runtimes.rs` : 5, 15, 19, 21, 23, 54, 74, 75, 82, 92
- `crates/os/kernel/core/src/tests.rs` : 422, 425, 432, 460
- `crates/os/ostd/subsystem/src/lib.rs` : 4
- `crates/shell/web/src/lib.rs` : 5
- `crates/ui/app/build.rs` : 22
- `crates/ui/app/src/runtime.rs` : 5
- `crates/ui/app/src/studio.rs` : 381
- `crates/ui/m3-tokens/src/sheets.rs` : 16, 231, 350, 550
- `crates/ui/render/src/pipeline3d.rs` : 6
- `crates/ui/svg/src/glyph.rs` : 5
- `crates/ui/svg/src/lib.rs` : 21
- `crates/web/web-bridge/src/actors.rs` : 3
- `crates/web/web-service/src/lib.rs` : 7, 97

**tests (14 fichiers)**
- `crates/ai/config/src/profile_tests.rs` : 55
- `crates/ai/config/src/resolve_tests.rs` : 204
- `crates/ai/rag-core/tests/ts_parity_golden.rs` : 3, 99, 165, 204, 207, 234, 238
- `crates/compat/n2b-core/tests/proptest_source.rs` : 66
- `crates/compat/n2b-core/tests/rules_cli_commands.rs` : 28
- `crates/compat/n2b/tests/contract.rs` : 230, 260, 265, 278, 279, 280, 281
- `crates/infra/git/tests/awesome_black_box.rs` : 4, 6, 36, 38, 39, 78, 97, 99
- `crates/os/kernel/comps/drive/core/tests/ephemeral_bridge_test.rs` : 86, 101, 104
- `crates/os/kernel/comps/drive/core/tests/typescript_bridge_test.rs` : 11, 104, 109, 120, 123, 214, 219, 230, 233, 350, 355, 366, 369, 465, 470, 481, 484
- `crates/os/kernel/comps/drive/core/tests/typescript_search_bridge_test.rs` : 199, 204, 223, 226
- `crates/ui/bun/tests/icons_svg_parity.rs` : 3, 9, 19, 20, 66, 73
- `crates/ui/m3-tokens/tests/mcu_image_parity.rs` : 7, 47
- `crates/ui/m3-tokens/tests/mcu_parity.rs` : 5
- `crates/ui/m3-tokens/tests/sheets_golden.rs` : 8

**Node-to-Bun analysis/migration (59 fichiers)**
- `crates/compat/n2b-core/src/ai/mod.rs` : 16, 80, 83, 105, 111, 113, 114, 115, 116, 117, 118, 119, 120, 121, 123, 125, 126, 130, 131, 132, 133, 135, 138, 141, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 155, 163, 167, 170, 173, 179, 180, 185, 186, 187, 188, 190, 192, 193, 194, 196, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 212
- `crates/compat/n2b-core/src/audit.rs` : 292, 392
- `crates/compat/n2b-core/src/manifest.rs` : 291
- `crates/compat/n2b-core/src/report/mod.rs` : 26, 58, 425, 463, 464, 468, 473
- `crates/compat/n2b-core/src/report_card.rs` : 115
- `crates/compat/n2b-core/src/rules/bun_apis.rs` : 16, 91, 92, 94, 97, 174
- `crates/compat/n2b-core/src/rules/imports_ast.rs` : 20
- `crates/compat/n2b-core/src/rules/mod.rs` : 15
- `crates/compat/n2b-core/src/rules/node_imports.rs` : 25, 75, 78, 82, 138, 144, 157, 172, 173, 178, 179, 180, 181, 182, 183, 184, 187, 199, 200
- `crates/compat/n2b-core/src/run.rs` : 65
- `crates/compat/n2b-core/src/scanners/bunfig.rs` : 21, 22, 63, 99
- `crates/compat/n2b-core/src/scanners/cargo_toml.rs` : 15, 18, 56, 57, 60, 61, 62, 63, 222
- `crates/compat/n2b-core/src/scanners/docker_compose.rs` : 16, 25, 50, 51, 53, 62, 69, 103, 111
- `crates/compat/n2b-core/src/scanners/dockerfile.rs` : 31, 32, 39, 46, 54, 56
- `crates/compat/n2b-core/src/scanners/env_file.rs` : 16, 18, 19, 27, 31, 32, 36, 41, 45, 48, 122
- `crates/compat/n2b-core/src/scanners/husky.rs` : 16, 35, 36, 42, 43, 49, 50, 56, 57, 63, 64
- `crates/compat/n2b-core/src/scanners/js_config.rs` : 17, 19, 20, 21, 22, 74, 75, 78, 79, 82, 85, 87, 89
- `crates/compat/n2b-core/src/scanners/lockfile.rs` : 31
- `crates/compat/n2b-core/src/scanners/next_config.rs` : 21, 24, 28, 40, 86, 131, 199, 403
- `crates/compat/n2b-core/src/scanners/npmrc.rs` : 65, 71, 106, 111, 120
- `crates/compat/n2b-core/src/scanners/nvmrc.rs` : 18, 30
- `crates/compat/n2b-core/src/scanners/package_json.rs` : 40, 45, 46, 47, 48, 49, 53, 56, 57, 59, 60, 61, 62, 63, 65, 67, 68, 69, 70, 71, 73, 75, 76, 78, 79, 83, 95, 96, 97, 98, 110, 111, 112, 113, 120, 126, 132, 135, 140, 147, 153, 428, 429, 450, 451, 452, 453, 513, 518, 528, 536, 537, 540, 573, 574, 576, 577, 583, 585, 586, 589, 603, 610, 628, 650, 668, 669, 685, 697
- `crates/compat/n2b-core/src/scanners/pnpm_workspace.rs` : 15, 56
- `crates/compat/n2b-core/src/scanners/procfile.rs` : 16, 48
- `crates/compat/n2b-core/src/scanners/shebang.rs` : 35, 42
- `crates/compat/n2b-core/src/scanners/source.rs` : 16, 34
- `crates/compat/n2b-core/src/scanners/tauri_conf.rs` : 17, 35, 39, 51, 52
- `crates/compat/n2b-core/src/scanners/tsconfig.rs` : 19, 20, 21, 35, 37, 39, 44, 45, 46, 69, 82, 95, 109, 131, 143, 179, 193, 206, 220, 233, 246, 250, 251, 257, 261
- `crates/compat/n2b-core/src/scanners/turbo_json.rs` : 16, 33, 34, 37, 41, 46, 47, 48, 50, 61, 78, 79, 82
- `crates/compat/n2b-core/src/scanners/workflows.rs` : 45, 47, 51, 60, 62, 66
- `crates/compat/n2b-native/src/lib.rs` : 15, 87, 125, 131, 132, 138, 143, 195, 199, 201, 219, 224, 240, 245, 258, 262
- `crates/compat/n2b-registry/src/lib.rs` : 15
- `crates/compat/n2b-registry/src/registry.rs` : 51, 101, 133, 135, 140, 145, 147, 148, 154, 193, 194, 196, 198, 210, 211, 228, 234, 252, 259
- `crates/compat/n2b-registry/src/schema.rs` : 27, 61, 88, 109, 193, 215
- `crates/compat/n2b-types/src/schema.rs` : 2, 10, 14, 17, 20, 25, 33, 128, 134, 226
- `crates/compat/n2b-types/src/types.rs` : 57
- `crates/compat/n2b/src/analyze.rs` : 19, 236, 529
- `crates/compat/n2b/src/app_cmd.rs` : 15, 16, 20, 21, 22, 36, 38, 106, 122, 123, 146, 148, 151, 153, 164, 165, 166, 191, 192, 193, 194, 195, 207, 229, 239, 255, 281, 283, 284, 298, 335, 336, 339, 342, 357, 358, 365, 369, 391, 394, 408, 409, 411, 412, 413, 414, 415, 418, 421, 431, 437, 438, 439, 440, 441, 447, 449, 459, 464, 494, 495, 501, 502, 507, 508, 565, 585, 600, 655
- `crates/compat/n2b/src/bin_cmd.rs` : 37, 39, 41, 43, 45, 48, 99, 116, 135, 151, 168, 183
- `crates/compat/n2b/src/bin_cmd_gpu.rs` : 38, 56, 87, 93, 96, 99, 110, 113, 254, 255, 261
- `crates/compat/n2b/src/bin_cmd_templates.rs` : 31, 37, 58, 80, 86, 108, 116, 120, 123, 135, 141, 144, 147, 159, 162, 163, 171, 174, 192, 193, 201, 214, 217, 218, 219, 221, 226, 230, 232, 261, 264, 267, 272, 316, 319, 334, 336, 345, 353, 354, 362, 373, 375, 381, 433, 435, 444, 452, 485, 490, 492, 502, 513, 514, 518, 554, 564, 566, 567
- `crates/compat/n2b/src/bunpp_cmd.rs` : 15, 17, 23, 24, 27, 28, 29, 54, 61, 83, 97, 124, 136, 167, 173, 178, 179, 187, 188, 200, 225, 228, 233, 243, 252, 266, 315, 318, 325, 327, 328, 330, 342, 349, 358, 364, 378, 382, 390, 394, 396, 445, 448, 467, 475, 541, 549, 571, 595, 605, 608, 639, 662, 704, 720, 724, 741, 798, 801, 853, 860, 861
- `crates/compat/n2b/src/cli/args.rs` : 66, 68, 90, 91, 159, 165, 182, 183, 186, 193, 194, 195, 198, 199, 200, 207, 208, 211, 212, 213, 220, 228, 229, 252, 253, 276, 281, 290, 292, 295, 296, 375, 381, 505, 510, 511, 521, 535, 551, 573, 581, 589, 603, 607, 608, 615, 620, 622, 625, 627, 633, 724, 727, 740, 741
- `crates/compat/n2b/src/cli/dispatch.rs` : 242
- `crates/compat/n2b/src/commands/audit.rs` : 15, 33
- `crates/compat/n2b/src/commands/migrate.rs` : 18, 19, 21, 28, 112, 113, 114, 116, 120, 124, 125, 129, 131, 135, 136, 138, 139, 140, 142, 158, 161
- `crates/compat/n2b/src/commands/rules.rs` : 27, 29, 30, 31, 33, 34, 36, 37, 38, 39, 41, 42, 43, 44, 45, 46, 49, 57, 58, 59, 60, 61, 62, 63, 65, 66, 67, 68, 69, 70, 73, 74, 75, 76, 77, 78, 79, 80, 82, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 127, 128, 129, 130, 131, 132, 133, 134, 135, 147, 149, 150, 160, 162, 163, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 191, 196, 197, 198, 199, 200, 201, 227, 366, 367, 377, 378, 381, 382, 383, 384, 385, 386, 387, 392, 393
- `crates/compat/n2b/src/commands/wasm_spec/mod.rs` : 47, 103, 131, 134, 135, 136, 149, 199
- `crates/compat/n2b/src/commands/wasm_spec/parser.rs` : 97, 147, 148, 156, 168
- `crates/compat/n2b/src/linux_cmd.rs` : 15, 17, 18, 19, 20, 25, 26, 27, 28, 84, 113, 138, 150, 162, 172, 181, 183, 249, 252, 255, 269, 272, 275, 289, 292, 295, 310, 311, 312, 313, 316, 319, 330, 338, 340, 341, 350, 355, 356, 357, 358, 370, 389, 413, 414, 415, 420, 421, 422, 433, 436, 464, 467, 473, 488, 516, 517, 519, 545, 546, 548
- `crates/compat/n2b/src/patch.rs` : 102, 110, 112, 116, 118, 120, 123, 126, 132, 136, 163, 175, 181, 183, 186, 189, 201, 202, 203
- `crates/compat/n2b/src/rust_cmd.rs` : 271, 289, 678
- `crates/compat/n2b/src/schema_test.rs` : 29
- `crates/compat/n2b/src/subprocess/bun.rs` : 15, 24, 27, 28, 31, 34, 37, 45, 48, 53, 56, 66, 89, 92, 97, 100
- `crates/compat/n2b/src/subprocess/mod.rs` : 15
- `crates/compat/n2b/src/wasm_cmd.rs` : 15, 165, 234, 409, 442, 505, 508, 511, 529, 530, 533, 697, 724, 763, 766
- `crates/compat/n2b/src/win32_cmd.rs` : 15, 18, 20, 27, 28, 29, 30, 31, 95, 124, 170, 197, 210
- `crates/compat/n2b/src/win32_cmd_com.rs` : 134, 137, 140, 149, 152, 178
- `crates/compat/n2b/src/win32_cmd_templates.rs` : 31, 34, 37, 51, 52, 55, 58, 75, 76, 77, 78, 79, 80, 83, 86, 101, 102, 110, 112, 126, 149, 156, 157, 158, 159, 163, 248, 266, 286, 288, 293, 295, 301, 302, 303, 384, 407, 437, 439, 466, 467, 469, 499, 501, 513, 514, 519, 570, 573, 585

**runtime/tooling orchestration (11 fichiers)**
- `crates/compat/toolchains/src/discover.rs` : 69, 76, 93
- `crates/compat/toolchains/src/lib.rs` : 3, 6, 12, 21, 41, 77, 79, 83, 94, 104, 114, 345
- `crates/compat/toolchains/src/pin.rs` : 69, 102, 103, 110, 119, 147, 157, 158
- `crates/compat/toolchains/src/tests.rs` : 22, 28, 34, 40, 65, 70, 71, 72, 85, 86, 87
- `crates/discord/aphrody-discord-compiler/src/lib.rs` : 3, 5, 85, 135, 139, 142, 143, 148, 149, 155, 166, 167, 171, 176, 177, 178, 180, 187, 188, 264, 318, 319, 328, 394, 396, 605, 624
- `crates/infra/yolo/src/main.rs` : 337, 345, 351, 402, 435, 436, 437, 438, 851, 852, 1067, 1068, 1485
- `crates/infra/yolo/src/mapper/audit.rs` : 25, 33, 34
- `crates/infra/yolo/src/mapper/core.rs` : 82, 87, 89, 92, 120, 135
- `crates/infra/yolo/src/mapper/detect.rs` : 13, 14, 26, 27, 28, 31, 79, 84, 85, 94, 95, 103
- `crates/infra/yolo/src/mapper/watch.rs` : 13, 15
- `crates/infra/yolo/src/polyglot.rs` : 47, 48, 58, 59

**native Rust library exposed to Bun (6 fichiers)**
- `crates/ui/bun/src/icons/mod.rs` : 3, 4, 7, 11
- `crates/ui/bun/src/icons_ffi.rs` : 4, 6, 14, 62, 67, 87
- `crates/ui/bun/src/lib.rs` : 4, 5, 17, 18, 19, 20, 27, 31, 33, 39, 50, 66, 102, 111, 135, 154, 223, 237, 276, 281, 303, 305, 359, 401, 403, 457, 497, 499, 534, 537, 539, 567, 575, 576, 584, 585, 586, 597, 601, 604, 607, 627, 631, 644, 648, 666, 668, 684, 694, 706, 720
- `crates/ui/bun/src/render.rs` : 2, 5, 9, 15, 23, 58, 61, 65, 70, 76, 78, 80, 114, 122, 197, 201, 205, 215, 227, 242, 248, 251
- `crates/ui/bun/src/reproduce.rs` : 3, 9, 58, 63, 95, 108, 114, 115, 118, 119, 129, 130, 133, 134, 144
- `crates/ui/bun/src/svg.rs` : 3, 4, 236, 239, 244

## Obscura — architecture et usages observés

- Implémentation Rust locale sous `crates/web/obscura-*`: crates DOM, réseau/SSRF, browser, CDP, JS (deno_core/V8), rendu et façade `obscura`; packages Apache-2.0 marqués non publiables. `crates/web/obscura-js` a les options `stealth` et `render`, désactivées par défaut.
- Les sources Obscura utilisent `catch_unwind` pour certaines frontières JavaScript/natives. Préserver cette récupération exige une stratégie de panic compatible au niveau des artefacts construits. Ce scan ne détermine pas les profils effectifs du workspace Aphrody ; un override Cargo par package ne doit pas être supposé résoudre ce contrat.
- Consommateurs directs repérés : `crates/web/web-crawl` (requêtes + parsing DOM), `crates/web/web-engine`, `crates/web/web-service`, `crates/web/web-bridge`, `crates/web/web-extract`, `crates/interop/ffi` (fonctions natives HTTP/DOM), `crates/google/google` (recherche statique et browser), `crates/ai/agent-tools`, `crates/ai/mcp` (crawl et commandes browser). Le détail manifestes Cargo se trouve au tableau initial.
- Les 151 fichiers Rust comprennent le moteur, tests d’intégration, adaptateurs/consommateurs et références. Le total lexical comporte du bruit : identifiants de types/erreurs et commentaires.

## Bun — architecture et usages observés

- `crates/ui/bun` est un package natif `aphrody-bun`, bibliothèque `bun_rs` de type `rlib`, utilisée par `crates/interop/ffi` avec option GPU. Ses exports `extern "C"` comprennent version/ABI, recherche de bytes, couleur M3, compilation Sass, validation, SVG, icônes et rendu; les résultats alloués ont des fonctions de libération. `catch_unwind` encadre notamment Sass avant le retour par FFI.
- `crates/compat/n2b-native` fournit l’ABI N2B `bun:ffi`; les crates `n2b-*` analysent et migrent du code Node vers Bun, avec commandes de compilation et subprocess dédiés.
- `crates/compat/oxc-bridge` contient un pont natif Oxc ciblant le fork Bun. `crates/compat/bun-docs` indexe la documentation Bun.
- `crates/compat/toolchains` découvre l’exécutable Bun et les pins de versions à partir des fichiers de projet/environnement. `crates/infra/yolo` détecte et lance les gates Bun. `crates/discord/aphrody-discord-compiler` lance `bun build --compile` sur les cibles configurées. Ces usages sont de l’orchestration externe, pas une dépendance Cargo au runtime Bun.
- Les références aux fixtures/golden de Bun dans AI/RAG et M3 documentent la parité de données/sorties, pas une dépendance de runtime dans ces tests Rust.

## Incidences pour l’import Tauri dans Yolo

- Le checkout Yolo est sur `dev`, workspace resolver 3, et les paquets importés `aphrody-*` sont câblés par `[workspace.dependencies]` avec les clés upstream conservées (`tauri`, `tauri-build`, `tauri-plugin-*`, `wry`, `tao`). `yolo-desktop` utilise ces clés workspace.
- Le consumer Aphrody `crates/ui/app` et les adapters Tauri ne peuvent pas être supposés compilables sous le nom crate renommé par simple copie. Les chemins de manifestes et macros doivent préserver l’identifiant Rust `tauri`; les plugins qui calculent leur identifiant à partir de `CARGO_PKG_NAME` ont besoin du helper/normalisation planifié dans la migration.
- Les noms de packages de plugins sont également consommés comme clés de permissions ACL et identifiants de commandes, alors que `use tauri::...`, `tauri::Builder`, `tauri::command` et les clés JSON de configuration sont des API historiques à préserver. Les régressions prioritaires sont ACL/plugin identifiers, templates `cargo add`/manifestes, et cohérence des versions alpha.
- La nouvelle cible intègre les capacités Bun au runtime précompilé tout en permettant de conserver son graphe de build propre. Les consommateurs Aphrody doivent recevoir le SDK léger plutôt que recompiler le moteur.
- La nouvelle cible intègre Obscura au runtime producteur, avec migration progressive des consommateurs. La frontière native, la stratégie panic et la parité précèdent le retrait de toute implémentation existante.
- Ce rapport n’asserte aucune validation de compilation du checkout Aphrody ou Yolo.

## Limites et reproduction

Le scan couvre tous les `.rs` et `Cargo.toml` parcourus sous `aphrody/crates`, en ignorant uniquement les dossiers générés `target`, `.git` et `node_modules`. Il ne parcourt pas `apps/`, les scripts, docs, manifestes npm, configurations JSON externes, ni l’historique Git. Le motif Bun cherche Bun comme mot entier ainsi que les identifiants `bun_`/`bun-`; « bundle » seul est exclu. Tauri/Obscura utilisent une recherche insensible à la casse et peuvent ramasser une mention documentaire dans le code. La liste exhaustive de chemins/lignes est fournie pour permettre le tri des faux positifs.

Commandes de référence exécutées en lecture seule : parcours Python de `crates/**` pour les manifestes Cargo et les lignes `.rs`; les dépendances ont été lues statiquement depuis les manifestes. Aucun Cargo build/test, test Bun, modification du checkout Aphrody, commit ou push n’a été effectué.
