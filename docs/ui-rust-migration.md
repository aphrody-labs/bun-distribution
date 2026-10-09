<!-- SPDX-License-Identifier: Apache-2.0 -->
# Migration de l’UI vers Rust

Les lots conservent leurs inventaires datés dans leurs sections. L’inventaire transversal courant est généré par `bun scripts/audit/ui/rust-migration.ts`, dans le bloc `generated uirust inventory` ci-dessous ; il inclut les sources actives, les fichiers retirés et les crates du fork Bun vérifiées. Le bloc M3 historique est généré par `python3 scripts/audit/ui-rust-m3-inventory.py`.

<!-- BEGIN GENERATED M3 INVENTORY -->

Fichiers inventoriés : **1193**. Chaque ligne représente un fichier source; l’état `à migrer` signifie qu’aucune parité Rust n’est revendiquée.

| Fichier | Surface | Rôle | Cible Rust | État |
|---|---|---|---|---|
| `m3/apps/example/app/api/health/route.ts` | `apps` | application surface | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/apps/example/app/counter.tsx` | `apps` | application surface | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/apps/example/app/error.tsx` | `apps` | application surface | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/apps/example/app/globals.css` | `apps` | application surface | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/apps/example/app/guestbook/actions.ts` | `apps` | application surface | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/apps/example/app/guestbook/page.tsx` | `apps` | application surface | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/apps/example/app/guestbook/sign-form.tsx` | `apps` | application surface | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/apps/example/app/layout.tsx` | `apps` | application surface | `crates/ui/m3/src/layout.rs` | à migrer |
| `m3/apps/example/app/not-found.tsx` | `apps` | application surface | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/apps/example/app/page.tsx` | `apps` | application surface | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/apps/example/app/people/[id]/loading.tsx` | `apps` | application surface | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/apps/example/app/people/[id]/page.tsx` | `apps` | application surface | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/apps/example/app/people/page.tsx` | `apps` | application surface | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/apps/example/app/people/people-table.tsx` | `apps` | application surface | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/apps/example/app/sitemap.ts` | `apps` | application surface | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/apps/example/bench/next-vs-m3.ts` | `apps` | application surface | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/apps/example/lib/guestbook.ts` | `apps` | application surface | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/apps/example/lib/people.ts` | `apps` | application surface | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/apps/example/m3.config.ts` | `apps` | application surface | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/apps/example/test/app.test.ts` | `apps` | application surface | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/backend.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/build.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/m3.config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/scripts/brand-theme.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/app-ui/showcase/m3.config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/scripts/browser-contract.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/scripts/inventory.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/scripts/shots.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/scripts/tauri.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/App.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/adaptive/dpad.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/adaptive/window.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/api/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/components/ui.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/env.d.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/index.html` | `packages` | document / template | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/inventory.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/main.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/pages/Adaptive.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/pages/Ai.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/pages/Brands.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/pages/Components.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/pages/Design.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/pages/Explorer.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/pages/Forms.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/app-ui/showcase/src/pages/Icons.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/app-ui/showcase/src/pages/Motion.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (motion contract)` | à migrer |
| `m3/packages/app-ui/showcase/src/pages/Next.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/pages/Overview.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/pages/Primitives.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/pages/Reader.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/pages/System.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/pages/Theme.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/app-ui/showcase/src/pages/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/router.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/shell/Shell.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/shell/nav.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/src/styles.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/test/build.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/test/contracts.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/test/host-contract.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/test/runtime-api.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/showcase/test-dom/dpad.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/CommandPalette.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/Settings/pages/AboutSettings.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/Settings/pages/AdvancedSettings.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/Settings/pages/AgentSettings.behavior.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/Settings/pages/AgentSettings.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/Settings/pages/AgentToolsSettings.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/Settings/pages/AppearanceSettings.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/Settings/pages/GeneralSettings.behavior.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/Settings/pages/GeneralSettings.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/Settings/pages/IndexerSettings.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/Settings/pages/KeyboardSettings.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/Settings/pages/LibrarySettings.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/Settings/pages/ModelsSettings.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/Settings/pages/PrivacySettings.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/Settings/pages/ServicesSettings.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/Settings/pages/SettingsLayout.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/layout.rs` | à migrer |
| `m3/packages/app-ui/src/Settings/pages/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/Shell.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/ShellLayout.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/layout.rs` | à migrer |
| `m3/packages/app-ui/src/TopBar/Context.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/TopBar/Item.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/TopBar/OverflowMenu.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/TopBar/Portal.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/TopBar/Section.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/TopBar/TopBar.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/TopBar/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/TopBar/useOverflowCalculation.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/app-parity.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/app.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/app.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/appearance.behavior.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/backend-contract.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/backend-inventory.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/brand-theme.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/app-ui/src/brand-theme.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/app-ui/src/brand-tokens.ts` | `packages` | framework source / tooling | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/app-ui/src/brand.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/browser-session-stream.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/browser-session-stream.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/codex-chat.behavior.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/codex-chat.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/codex-chat.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/codex-ui.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/command-actions.behavior.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/DndProvider.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/ErrorBoundary.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Inspector/Inspector.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Inspector/LocationMap.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Inspector/primitives/Divider.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Inspector/primitives/InfoRow.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Inspector/primitives/Section.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Inspector/primitives/TabContent.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Inspector/primitives/Tabs.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Inspector/primitives/Tag.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Inspector/primitives/Thumbnail.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Inspector/primitives/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Inspector/variants/FileInspector.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Inspector/variants/KnowledgeInspector.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Inspector/variants/LocationInspector.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Inspector/variants/MultiFileInspector.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Inspector/variants/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/JobManagerPopover.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/JobsScreen/JobRow.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/JobsScreen/index.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/components/CopyJobDetails.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/components/EmptyState.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/components/JobCard.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/components/JobList.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/components/JobProgressBar.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/components/JobStatusIndicator.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/components/SpeedGraph.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/hooks/JobsContext.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/hooks/useJobCount.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/hooks/useJobManager.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/hooks/useJobs.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/hooks/useJobsDesktop.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/renderers/FileCopyRenderer.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/renderers/GenericRenderer.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/renderers/index.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/JobManager/types.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Orb.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/AudioPlayer.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/ContentRenderer.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/Controller.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/DirectoryPreview.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/MeshViewer.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/QuickPreview.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/QuickPreviewFullscreen.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/QuickPreviewModal.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/QuickPreviewOverlay.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/SplatShimmerEffect.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/SubtitleSettingsMenu.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/Subtitles.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/Syncer.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/TextViewer.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/TimelineScrubber.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/VideoControls.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/VideoPlayer.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/mesh-orbit-controls.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/mesh-orbit-controls.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/prism-languages.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/prism-lazy.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/prism-manual.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/prism.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/srt.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/QuickPreview/useZoomPan.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Sources/SourceCard.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Sources/SourceDataRow.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Sources/SourcePathBar.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Sources/SourceStatusBadge.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Sources/SourceTypeIcon.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/AddGroupButton.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/AddGroupModal.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/CreateSpaceModal.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/DevicesGroup.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/GroupHeader.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/LocationsGroup.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/SourcesGroup.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/SpaceCustomizationPanel.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/SpaceGroup.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/SpaceItem.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/SpaceSwitcher.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/TagsGroup.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/VolumesGroup.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/dnd.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/hooks/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/hooks/spaceItemUtils.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/hooks/useSpaceItemActive.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/hooks/useSpaceItemContextMenu.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/hooks/useSpaceItemDropZones.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/hooks/useSpaces.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/hooks/useVolumeContextMenu.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SpacesSidebar/index.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SyncMonitor/SyncMonitorPopover.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SyncMonitor/components/ActivityFeed.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SyncMonitor/components/PeerList.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SyncMonitor/hooks/useSyncCount.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SyncMonitor/hooks/useSyncMonitor.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SyncMonitor/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SyncMonitor/types.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/SyncMonitor/utils.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/TabManager/TabBar.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/TabManager/TabDefaultsSync.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/TabManager/TabKeyboardHandler.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/TabManager/TabManagerContext.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/TabManager/TabNavigationSync.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/TabManager/TabView.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/TabManager/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/TabManager/route-title.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/TabManager/route-title.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/TabManager/tab-navigation.behavior.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/TabManager/useTabManager.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Tags/TagDot.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Tags/TagPill.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Tags/TagSelector.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/Tags/index.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/WrappedPopover.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/modals/CreateLibraryModal.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/modals/FileOperationModal.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/modals/PairingModal.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/modals/SyncSetupModal.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/overlays/DaemonDisconnectedOverlay.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/components/overlays/DaemonStartupOverlay.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/contexts/PlatformContext.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/app-ui/src/contexts/ServerContext.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/contexts/SpacedriveContext.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/contexts/WebContextMenuContext.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/desktop-navigation.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/desktop-surfaces.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/framework-utils.d.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/gemini-layout.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/layout.rs` | à migrer |
| `m3/packages/app-ui/src/generated/bun-catalog.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/history-panel.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/history.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/history.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/hooks/useAdapterIcons.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/app-ui/src/hooks/useAudioRecorder.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/hooks/useClipboard.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/hooks/useContextMenu.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/hooks/useDaemonStatus.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/hooks/useEvent.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/hooks/useJobDispatch.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/hooks/useKeybind.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/hooks/useKeybindMeta.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/hooks/useKeybindScope.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/hooks/useLibraries.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/hooks/useOpenWith.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/hooks/usePopover.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/hooks/useRefetchTagQueries.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/hooks/useTheme.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/app-ui/src/i18n.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/identity-bridge.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/identity-bridge.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/index.html` | `packages` | document / template | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/jan-ui-behavior.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/jan-ui-interaction.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/kit-bridge.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/kit-bridge.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/kit-surface.behavior.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/m3-env.d.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/menu-commands.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/menu-commands.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/models-hub-actions.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/models-hub-state.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/models-hub.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/models-hub.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/navigation-shell.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/onboarding.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/open-requests.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/open-requests.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/pet-behavior.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/pet-behavior.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/preferences.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/public-navigation.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/quickbar-input.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/app-ui/src/quickbar-input.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/app-ui/src/quickbar-suggest.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/quickbar-suggest.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/quickbar.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/rail-drawer.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/rail-drawer.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/router.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/admin/index.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/creator/index.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/ExplorerView.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/File/File.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/File/FileStack.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/File/Metadata.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/File/Thumb.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/File/ThumbstripScrubber.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/File/Title.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/File/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/KeyboardHandler.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/SearchToolbar.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/SelectionContext.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/SortMenu.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/TabNavigationGuard.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/TagAssignmentMode.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/ViewModeMenu.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/ViewSettings.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/ai-helpers.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/components/AddLocationModal.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/components/AddStorageModal.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/components/Breadcrumb.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/components/DragSelect/context.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/components/DragSelect/useDragSelection.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/components/DragSelect/utils.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/components/ExpandableSearchButton.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/components/FileSelectionAiBar.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/components/InlineNameEdit.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/components/PathBar.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/components/VirtualPathBar.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/components/VolumeSizeBar.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/context.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/explorer-ai-actions.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/explorer-ai-contract.behavior.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/hooks/useAskAphrody.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/hooks/useDeleteFiles.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/hooks/useDraggableFile.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/hooks/useEmptySpaceContextMenu.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/hooks/useExplorerFiles.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/hooks/useExplorerKeyboard.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/hooks/useFileContextMenu.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/hooks/useTypeaheadSearch.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/hooks/useVirtualListing.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/utils.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/ColumnView/Column.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/ColumnView/ColumnItem.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/ColumnView/ColumnView.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/ColumnView/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/DragSelect.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/EmptyView.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/GridView/FileCard.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/GridView/GridView.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/layout.rs` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/GridView/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/KnowledgeView.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/ListView/ListView.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/ListView/TableRow.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/ListView/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/ListView/useTable.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/ListView/useTable.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/MediaView/DateHeader.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/MediaView/MediaView.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/MediaView/MediaViewItem.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/MediaView/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/MediaView/utils.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/RecentsView/RecentsView.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/RecentsView/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/SearchView/SearchView.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/SearchView/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/SizeView/SizeCircle.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/SizeView/SizeView.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/explorer/views/SizeView/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/file-kinds/index.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/kit/KitSurface.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/kit/use-kit-visible.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/product/catalog.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/product/catalog.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/product/index.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/redundancy/index.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/settings/index.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/sources/Adapters.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/sources/SourceDetail.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/sources/index.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/studio/A2AStudio.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/studio/DriveStudio.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/studio/RuntimeStudio.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/studio/StudioHeader.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/studio/index.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/studio/navigation.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/routes/tag/index.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/runtime-studio.behavior.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/showcase-env.d.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/stores/aphrodyJobStore.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/stores/chat-store.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/stores/volumeIndexingStore.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/studio-bridge.behavior.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/studio-bridge.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/styles.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/system-presets.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/tauri-bridge.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/use-open-requests.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/util/keybinds/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/util/keybinds/listener.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/util/keybinds/platform.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/app-ui/src/util/keybinds/registry.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/util/keybinds/types.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/vite-env.d.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/windows/DemoWindow.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/windows/FloatingControls.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/src/windows/Spacedrop.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/test-preload.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/app-ui/undeclared-deps.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/assets/icons/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/assets/images/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/assets/scripts/generate.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/assets/sounds/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/assets/svgs/brands/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/assets/svgs/ext/Code/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/assets/svgs/ext/Extras/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/assets/svgs/ext/Extras/urls.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/assets/svgs/ext/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/assets/test/util.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/assets/types.d.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/assets/util/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/assets/util/mobile.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/assets/videos/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/canvas/index.d.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/canvas/index.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/canvas/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/canvas/native.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/canvas/scene-types.d.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/canvas/scripts/vendor-upstream.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/canvas/site.d.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/canvas/site.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/canvas/types.check.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/canvas/vendor/geometry.js` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/canvas/vendor/index.d.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/canvas/vendor/index.js` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/canvas/vendor/js-binding.js` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/canvas/vendor/load-image.js` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/canvas/vendor.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/eslint-plugin-m3/index.d.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/eslint-plugin-m3/index.js` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/eslint-plugin-m3/rules/helpers.js` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/eslint-plugin-m3/rules/no-hardcoded-color.js` | `packages` | framework source / tooling | `crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/eslint-plugin-m3/rules/no-mui-import.js` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/eslint-plugin-m3/rules/no-mui-prop-on-md.js` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/eslint-plugin-m3/rules/no-sx-prop.js` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/eslint-plugin-m3/rules/prefer-icon-token.js` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/eslint-plugin-m3/rules/require-icon-button-label.js` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/eslint-plugin-m3/rules/valid-color-role.js` | `packages` | framework source / tooling | `crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/eslint-plugin-m3/rules/valid-icon-name.js` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/eslint-plugin-m3/scripts/sync-symbol-names.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/eslint-plugin-m3/test/fixtures/bad.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/eslint-plugin-m3/test/fixtures/good.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/eslint-plugin-m3/test/run.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/identity/scripts/generate.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/identity/src/AphrodyAvatar.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/identity/src/AphrodyPet.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/identity/src/animations.generated.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (motion contract)` | à migrer |
| `m3/packages/identity/src/atlas.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/identity/src/brand.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/identity/src/compact.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/identity/src/env.d.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/identity/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/identity/src/pet.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/identity/src/pet.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/bin/m3.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/build.config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/client.d.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/qualification/check.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/boundaries.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/build.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/cache.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/cli.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/compile.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/dev.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/headers.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/host.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/image-size.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/image.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/link.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/navigation.server.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/navigation.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/plugin.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/prerender.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/runtime/client.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/runtime/matcher.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/runtime/metadata.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/runtime/registry.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/runtime/router-context.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/runtime/router.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/runtime/rsc.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/runtime/shared.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/runtime/ssr.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/runtime/store.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/scan.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/app/server.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/build.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/cli.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/data.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/i18n.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/lit.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/native.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/new.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/paths.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/plugin.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/react.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/server.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/showcase.html` | `packages` | document / template | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/tailwind.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/src/tokens.ts` | `packages` | framework source / tooling | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3/src/url-imports.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/app/compile.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/app/plugin.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/app/router.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/app/scan.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/build.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/cli.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/config.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/data.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/app/app.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/app/index.html` | `packages` | document / template | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/app/m3.config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/app/m3.plain.config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/app/main.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/app/plain.html` | `packages` | document / template | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/app-router/app/actions.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/app-router/app/api/hello/route.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/app-router/app/blog/[slug]/loading.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/app-router/app/blog/[slug]/page.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/app-router/app/counter.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/app-router/app/dash/page.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/app-router/app/form.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3/test/fixtures/app-router/app/layout.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/layout.rs` | à migrer |
| `m3/packages/m3/test/fixtures/app-router/app/not-found.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/app-router/app/page.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/app-router/app/robots.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/app-router/proxy.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/pages/about.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/pages/health.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/pages/index.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/pages/rpc/echo.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/pages/users/[id].tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/spa/index.html` | `packages` | document / template | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/fixtures/spa/main.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/helpers.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/i18n.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/native.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/plugin.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/proxy-boundary.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/server.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3/test/tailwind.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/build.config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/A2APeerInspector.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/A2ATaskTimeline.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/AgUiEventStream.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/ChatComposer.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/ConversationList.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/GeminiAccountMenu.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/GeminiPersonalContextEdit.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/GoogleSpotlightBar.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/InlineBranchCard.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/InlineWorkerCard.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/Markdown.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/McpAppCard.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/MemoryPanel.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/MessageBubble.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/ModelSelector.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/ModelUnavailable.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/TaskCreateForm.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-ai/src/TaskDetail.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/TaskList.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/TaskPriorityIcon.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/m3-ai/src/TaskRow.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/TaskStatusIcon.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/m3-ai/src/ToolCall.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/ag-ui.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/chatIcons.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/m3-ai/src/chatLabels.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/citations.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/internal.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/openaiChatStream.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/types.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/src/useOpenAIChat.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/test/ag-ui-a2a-bridge.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/test/ag-ui-registry-contract.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/test/ai.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/test/chat.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/test/google-gemini-benchmark.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-ai/test/production-contract.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/accordion.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/avatar.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/button.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/checkbox.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/collapsible.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/combobox.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/core.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/dialog.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/drawer.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/field.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/menu.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/navigation-menu.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/number-field.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/otp-field.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/popover.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/progress.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/radio.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/scroll-area.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/select.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/separator.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/slider.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/switch.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/tabs.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/toast.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/toggle.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/toolbar.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/css/tooltip.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/m3-baseui.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/accordion.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/alert-dialog.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/autocomplete.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/avatar.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/button.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/checkbox-group.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/checkbox.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/collapsible.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/combobox.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/context-menu.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/dialog.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/drawer.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/field.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/fieldset.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/form.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-baseui/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/input.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-baseui/src/menu.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/menubar.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/meter.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/navigation-menu.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/number-field.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/otp-field.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/part.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/popover.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/preview-card.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/progress.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/radio-group.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/radio.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/scroll-area.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/select.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/separator.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/slider.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/switch.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/tabs.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/toast.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/toggle-group.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/toggle.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/toolbar.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/src/tooltip.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/test/css.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/test/render.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-baseui/test/surface.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/bin/m3-bun.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/client.d.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/api.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/build.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/cli.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/compile.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/entry.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/icons.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/m3-bun/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/package.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/plugin.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/runtime.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/server.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/targets/cloudflare.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/targets/coolify.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/targets/docker.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/targets/fly.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/targets/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/targets/linux-image.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/targets/nginx.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/targets/systemd.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/targets/types.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/targets/vercel.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/targets/vscode.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/targets/windows.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/src/theme-css.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-bun/src/util.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/api.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/build.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/cli.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/compile.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/config.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/entry.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/fixtures/app/m3.config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/fixtures/app/src/api.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/fixtures/app/src/env.d.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/fixtures/app/src/index.html` | `packages` | document / template | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/fixtures/app/src/main.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/fixtures/app/src/styles.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/generated-paths.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/helpers.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/http-contract.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/icons.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/m3-bun/test/package.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/plugin.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/runtime-lifecycle.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/runtime.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/server.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/system.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/targets.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-bun/test/theme-css.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/button.input.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/button.output.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/checkbox.input.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/checkbox.output.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/dialog.input.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/dialog.output.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/icons-alias.input.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/icons-alias.output.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/icons.input.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/icons.output.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/jsx-strings.input.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/jsx-strings.output.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/layout.input.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/layout.output.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/layout.rs` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/nested-layout.input.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/nested-layout.output.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/layout.rs` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/return-todo.input.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/return-todo.output.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/slot-icons.input.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/slot-icons.output.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/textfield.input.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-codemods/__testfixtures__/textfield.output.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/lib/edits.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/lib/engine.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/lib/icon-names.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/m3-codemods/lib/imports.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/lib/jsx-helpers.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/lib/mapping.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/lib/tsx-scan.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/scripts/codemod.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/scripts/export-map-json.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/scripts/fixtures.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/scripts/run-fixtures.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/test/fixtures.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/test/public-api.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/transforms/button.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/transforms/fields.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/transforms/icons.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/m3-codemods/transforms/mui-imports.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-codemods/transforms/orchestrator.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-config/bun-build.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-config/cache-db.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-config/test/bun-build.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-config/test/cache-db.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-config/test/cache-integrity.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-config/test/dom.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-design/design-systems/material/tokens.css` | `packages` | styles / tokens | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-design/src/generated-behavior.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-design/src/generator.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-design/src/generator.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-design/src/handlers.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-design/src/handlers.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-design/src/hct.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-design/src/hct.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-design/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-design/src/native.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-design/src/node.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-design/src/parser.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-design/src/parser.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-design/src/prompts.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-design/src/server.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-design/src/types.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-explorer/build.config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-explorer/src/FileThumb.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-explorer/src/GoogleDriveListView.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-explorer/src/GridItem.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/layout.rs` | à migrer |
| `m3/packages/m3-explorer/src/RenameInput.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-explorer/src/TagPill.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-explorer/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-explorer/test/crawlable-ssr.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-explorer/test/explorer.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-explorer/test/file-thumb-dom.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-explorer/test/google-drive-list.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-explorer/test/production-contract.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-fonts/scripts/generate.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-fonts/scripts/subset.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-fonts/src/fonts-jp.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-fonts/src/fonts-symbols.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-fonts/src/fonts.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-fonts/src/fonts.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-fonts/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-forms/build.config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-forms/src/CheckboxField.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-forms/src/Form.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-forms/src/InputField.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-forms/src/RadioGroupField.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-forms/src/SelectField.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-forms/src/SwitchField.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-forms/src/TextAreaField.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-forms/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-forms/test/crawlable-ssr.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-forms/test/forms.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-forms/test/production-contract.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-front/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-front/src/register.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-front/src/theme-element.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-front/src/window-class.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-front/test/front.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-front/test/production-contract.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-icons/build.config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-icons/src/browser-lit.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-icons/src/browser.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-icons/src/codegen.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-icons/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-icons/src/lit.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-icons/src/plugin.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-icons/src/react.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-icons/test/browser.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-icons/test/icons.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/m3-mcp/src/catalog.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-mcp/src/catalog.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-mcp/src/tool-host.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-mcp/src/tools.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-mcp/test/catalog.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-mcp/test/tool-host.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-motion/build.config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-motion/src/components/M3Collapse.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-motion/src/components/M3ContainerTransform.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-motion/src/components/M3Fade.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-motion/src/components/M3FadeThrough.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-motion/src/components/M3ListStagger.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-motion/src/components/M3SharedAxis.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-motion/src/components/M3Transition.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-motion/src/easings.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-motion/src/hooks/useM3Animate.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-motion/src/hooks/useM3ReducedMotion.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (motion contract)` | à migrer |
| `m3/packages/m3-motion/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-motion/src/spring-interpolation.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-motion/src/springs.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-motion/test/m3-motion.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs (motion contract)` | à migrer |
| `m3/packages/m3-motion/test/production-contract.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-motion/test/spring-interpolation.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/bin/m3-next.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/build.config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/examples/app/app/api/health/route.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/examples/app/app/components/notifier.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/examples/app/app/components/page.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/examples/app/app/globals.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/examples/app/app/layout.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/layout.rs` | à migrer |
| `m3/packages/m3-next/examples/app/app/nav.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/examples/app/app/page.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/examples/app/app/theme/page.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/examples/app/app/theme-toggle.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-next/examples/app/next.config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/examples/app/proxy.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/examples/app/test/example.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/examples/tauri/app/about/page.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/examples/tauri/app/globals.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/examples/tauri/app/layout.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/layout.rs` | à migrer |
| `m3/packages/m3-next/examples/tauri/app/page.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/examples/tauri/app/theme-toggle.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-next/examples/tauri/next.config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/examples/tauri/test/example.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/m3.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/scripts/browser-check.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/scripts/bundle-report.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/scripts/yolo-example.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/src/client.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/src/constants.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/src/crawl.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/src/server.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/src/theme-proxy.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-next/test/config.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/test/cookie-contract.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/test/crawl.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/test/m3-next.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next/test/theme-proxy.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-next/test-dom/client.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/build.config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/cli.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/codemods/cli.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/codemods/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/codemods/jsx.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/codemods/mui.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/dependencies.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/layout.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/layout.rs` | à migrer |
| `m3/packages/m3-next-migrate/src/migrator.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/requirements.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/scaffolder.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/scanner.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/shims/dynamic.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/shims/font.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/shims/form.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-next-migrate/src/shims/headers.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/shims/image.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/shims/link.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/shims/metadata.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/shims/navigation.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/shims/provider.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/shims/server.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/shims/tauri-ipc.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/src/transform.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-next-migrate/test/cli-contract.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/test/codemods.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/test/migration-files.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/test/migrator.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/test/open-external.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/test/requirements.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/test/route-contract.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/test/scaffold-delegation.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/test/server-boundary.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-next-migrate/test/transform-boundary.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-next-migrate/test-dom/runtime-shims.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-os-themes/src/chromium.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-os-themes/src/cli.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-os-themes/src/color.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-os-themes/src/cosmic.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-os-themes/src/generate.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-os-themes/src/gnome.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-os-themes/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-os-themes/src/png.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-os-themes/src/types.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-os-themes/src/windows.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-os-themes/test/color-cache.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-os-themes/test/generate.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-os-themes/test/installer-integrity.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/build.config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Accordion.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/AlertDialog.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Avatar.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Badge.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Banner.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Button.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Card.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Checkbox.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/CircleButton.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/CircleButtonGroup.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/CircularProgress.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Collapsible.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/ContextMenu.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Dialog.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Divider.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Drawer.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Dropdown.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/DropdownMenu.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Field.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/FilterButton.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Icon.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/m3-primitives/src/InfoBanner.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Input.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-primitives/src/Layout.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/layout.rs` | à migrer |
| `m3/packages/m3-primitives/src/Loader.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Meter.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/NumberStepper.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/OptionList.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Popover.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/ProgressBar.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/RadioGroup.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Resizable.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/ScrollArea.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/SearchBar.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Select.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/SelectPill.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/SelectTriggerButton.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/ShinyButton.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/ShinyToggle.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Shortcut.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Slider.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/SpaceItem.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Switch.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/TabBar.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Tabs.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Toast.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/ToggleGroup.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Tooltip.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/Typography.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/base-ui.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/forms/Form.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-primitives/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/keys.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/src/utils.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/test/actions-display.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/test/base-ui-components.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/test/base-ui.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/test/crawlable-ssr.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/test/hydration.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/test/inputs.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs (forms)` | à migrer |
| `m3/packages/m3-primitives/test/overlays.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-primitives/test/production-contract.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/adapters/tanstack.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/adaptive/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/adaptive/use-window-size-class.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/build.config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/data/DataTable.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/data/VirtualList.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/data/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/generate.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/material-web-shims.d.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/state/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/state/use-text-field-state.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/test/adaptive.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/test/bundle-size.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/test/data.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/test/production-contract.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/test/tanstack-adapter.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/test/transitions.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/test/use-text-field-state.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/test/wrappers.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/transitions/Collapse.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/transitions/Fade.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/transitions/Grow.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/transitions/Slide.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/transitions/Zoom.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/transitions/create-transition.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/transitions/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/transitions/use-transition-state.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/alert.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/appbar.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/autocomplete.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/avatar.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/backdrop.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/badge.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/banner.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/breadcrumbs.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/button.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/buttongroup.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/canvas3d.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/card.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/card3d.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/carousel.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/charts.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/checkbox.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/chips.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/datepicker.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/dialog.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/divider.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/effects.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/elevation.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/expansion.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/fab.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/fabmenu.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/field.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/focus.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/globe3d.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/gridlist.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/layout.rs` | à migrer |
| `m3/packages/m3-react/wrappers/icon.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/m3-react/wrappers/iconbutton.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs (facade::icons)` | à migrer |
| `m3/packages/m3-react/wrappers/labs.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/layout.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/layout.rs` | à migrer |
| `m3/packages/m3-react/wrappers/link.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/list.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/loadingindicator.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/menu.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/mobilestepper.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/navigationrail.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/paginator.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/popover.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/progress.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/radio.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/rating.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/ripple.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/scheduler.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/search.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/select.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/sheet.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/skeleton.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/slider.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/snackbar.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/stepper.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/surface.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/switch.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/table.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/tabs.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/textfield.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/timepicker.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/toolbar.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/tooltip.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/tree.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/typography.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-react/wrappers/virtualscroll.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-reader/build.config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-reader/src/CaptionedReader.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-reader/src/CollectionReader.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-reader/src/MangaReader.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-reader/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-reader/src/reader-lifecycle.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-reader/src/use-focus-trap.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-reader/src/use-reader-core.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-reader/styles.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-reader/test/crawlable-ssr.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-reader/test/manga.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-reader/test/reader.test.tsx` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-reader/test/setup.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-tailwind/preset.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-tailwind/scripts/generate.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-tailwind/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-tailwind/src/spring.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-tailwind/test/preset.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-theme/build.config.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-theme/generate.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-theme/scripts/mcu-fixture.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-theme/scripts/mcu-image-fixture.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-theme/spaceui.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-theme/src/brand.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-theme/src/catalog.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-theme/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-theme/src/react.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-theme/src/tauri.tsx` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-theme/tailwind.css` | `packages` | styles / tokens | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-theme/test/brand.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-theme/test/fusion.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-theme/test/production-contract.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-theme/test/sheets.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/m3-theme/tokens.css` | `packages` | styles / tokens | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/build.ts` | `packages` | framework source / tooling | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/scripts/generate-expressive.ts` | `packages` | framework source / tooling | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/src/breakpoints.css` | `packages` | styles / tokens | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/src/breakpoints.ts` | `packages` | framework source / tooling | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/src/cli.ts` | `packages` | framework source / tooling | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/src/dynamic-color.ts` | `packages` | framework source / tooling | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/src/expressive.css` | `packages` | styles / tokens | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/src/expressive.ts` | `packages` | framework source / tooling | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/src/m3-tokens.css` | `packages` | styles / tokens | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/src/platform-contract.ts` | `packages` | framework source / tooling | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/src/theme-to-tokens.ts` | `packages` | framework source / tooling | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/test/a11y-contrast.test.ts` | `packages` | test / fixture | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/test/breakpoints.test.ts` | `packages` | test / fixture | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/test/contrast-level.test.ts` | `packages` | test / fixture | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/test/dynamic-color.test.ts` | `packages` | test / fixture | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/test/expressive.test.ts` | `packages` | test / fixture | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/test/m3-tokens-css.test.ts` | `packages` | test / fixture | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/test/production-contract.test.ts` | `packages` | test / fixture | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/test/scheme-variants.test.ts` | `packages` | test / fixture | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/m3-tokens/test/theme-to-tokens.test.ts` | `packages` | test / fixture | `crates/ui/m3-tokens + crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/material-design-icons/scripts/export-theme.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/theme.rs` | à migrer |
| `m3/packages/material-design-icons/scripts/svg-to-ico.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/material-design-icons/scripts/sync-catalogue.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/material-design-icons/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/material-design-icons/test/catalogue.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/scaffold/src/cli.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/scaffold/src/files.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/scaffold/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/scaffold/src/names.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/scaffold/src/pins.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/scaffold/src/png.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/scaffold/src/tauri.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/scaffold/src/templates/app.ts` | `packages` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/scaffold/src/templates/spa.ts` | `packages` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/scaffold/src/templates/web.ts` | `packages` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/scaffold/src/workspace.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/scaffold/test/scaffold.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/scaffold/test/writer-boundary.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/web-to-tauri/src/cli.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/web-to-tauri/src/drivers.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/web-to-tauri/src/generate.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/web-to-tauri/src/index.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/web-to-tauri/src/parity.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/web-to-tauri/src/plan.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/web-to-tauri/src/policy.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/web-to-tauri/src/probe.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/web-to-tauri/src/signals.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/web-to-tauri/src/types.ts` | `packages` | framework source / tooling | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/web-to-tauri/test/fixtures.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/web-to-tauri/test/generate.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/web-to-tauri/test/parity.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/web-to-tauri/test/plan.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/web-to-tauri/test/policy.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/web-to-tauri/test/probe.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/packages/web-to-tauri/test/signals.test.ts` | `packages` | test / fixture | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/base/runtime-env.d.ts` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/base/scripts/build-bin.ts` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/base/scripts/pack-deploy.ts` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/base/scripts/preload.ts` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/base/scripts/supervise.ts` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/base/src/app.ts` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/base/src/home.ts` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/base/src/server.ts` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/base/test/app.test.ts` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/elysia/src/alt/elysia.ts` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/hono/src/alt/hono.ts` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/react/src/home.ts` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/react/src/web/App.tsx` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/react/src/web/index.html` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/react/src/web/m3.ts` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/react/src/web/main.tsx` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/react/src/web/styles.css` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/react/test/react.test.ts` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/web/src/home.ts` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/web/src/web/index.html` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/web/src/web/main.ts` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/web/src/web/styles.css` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |
| `m3/templates/web/test/web.test.ts` | `templates` | template / scaffold | `crates/ui/m3/src/components.rs; host adapter TBD` | à migrer |

<!-- END GENERATED M3 INVENTORY -->
<!-- Généré par `python3 scripts/migration/ui-rust-inventory.py`; ne pas éditer ce tableau à la main. -->
# Inventaire de migration UI vers Rust

Inventaire exhaustif par extension (`.ts`, `.tsx`, `.js`, `.jsx`, `.html`, `.css`) pour les surfaces du lot `uirust-app`, généré depuis l’arbre de travail. Les rôles sont déduits des chemins et restent à confirmer lors de la qualification fonctionnelle.

Fichiers recensés : **286**. `crates/ui/m3` est absent de ce checkout; les consommateurs qui en dépendent restent bloqués jusqu’à réception du socle commun.

| Surface | Fichiers |
| --- | ---: |
| App web | 62 |
| App desktop | 4 |
| Tauri | 115 |
| Packages web | 105 |

| Fichier | Surface | Rôle déduit du chemin | Cible Rust | État |
| --- | --- | --- | --- | --- |
| `apps/web/build.ts` | App web | build frontend | m3/packages/app-ui/build.ts puis constructeur Rust/WASM | relai Bun; build Rust/WASM absent |
| `apps/web/server.ts` | App web | serveur HTTP | crates/web/site + crates/ai/app-server | logique HTTP Rust et tests présents; lanceur Bun encore actif |
| `apps/web/src/arcade/ArcadeGame.tsx` | App web | arcade/ArcadeGame | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/arcade/audio.ts` | App web | arcade/audio | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/arcade/avatar.ts` | App web | arcade/avatar | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/arcade/engine.test.ts` | App web | test ou fixture | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `apps/web/src/arcade/engine.ts` | App web | arcade/engine | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/benchmarks/BenchmarkSuite.tsx` | App web | benchmarks/BenchmarkSuite | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/components/ApiPlayground.tsx` | App web | components/ApiPlayground | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/components/M3Showcase.tsx` | App web | components/M3Showcase | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/components/MultiTargetBridge.tsx` | App web | components/MultiTargetBridge | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/core/codebase-scanner.test.ts` | App web | test ou fixture | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `apps/web/src/core/codebase-scanner.ts` | App web | core/codebase-scanner | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/core/platform.ts` | App web | core/platform | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/core/theme.ts` | App web | core/theme | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/core/types.ts` | App web | core/types | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/docs/DocsHub.tsx` | App web | docs/DocsHub | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/docs/docs-data.ts` | App web | docs/docs-data | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/env.d.ts` | App web | env.d | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/ffi/FFIExplorer.tsx` | App web | ffi/FFIExplorer | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/CommandPalette.tsx` | App web | os/CommandPalette | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/DesktopOS.tsx` | App web | os/DesktopOS | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/Dock.tsx` | App web | os/Dock | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/TopBar.tsx` | App web | os/TopBar | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/WindowFrame.tsx` | App web | os/WindowFrame | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/AlpinePackageManagerApp.tsx` | App web | os/apps/AlpinePackageManagerApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/AphrodyToolsApp.tsx` | App web | os/apps/AphrodyToolsApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/BunReplApp.tsx` | App web | os/apps/BunReplApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/BunshTerminalApp.tsx` | App web | os/apps/BunshTerminalApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/CodexStudioApp.tsx` | App web | os/apps/CodexStudioApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/DiagnosticsApp.tsx` | App web | os/apps/DiagnosticsApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/FilesApp.tsx` | App web | os/apps/FilesApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/KernelMonitorApp.tsx` | App web | os/apps/KernelMonitorApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/M3FusionStudioApp.tsx` | App web | os/apps/M3FusionStudioApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/ProcessesApp.tsx` | App web | os/apps/ProcessesApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/apps/SpacedriveVfsApp.tsx` | App web | os/apps/SpacedriveVfsApp | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/components/PetCompanion.tsx` | App web | os/components/PetCompanion | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/components/QuickAskBar.tsx` | App web | os/components/QuickAskBar | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/ffi-routes.ts` | App web | os/ffi-routes | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/os-router.ts` | App web | os/os-router | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/public-assets.ts` | App web | os/public-assets | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/server-extensions.ts` | App web | os/server-extensions | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/system-client.ts` | App web | os/system-client | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/system-metrics.ts` | App web | os/system-metrics | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/types.ts` | App web | os/types | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/wasm/apps.ts` | App web | os/wasm/apps | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/wasm/bun-api.ts` | App web | os/wasm/bun-api | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/wasm/bun-wasm.ts` | App web | os/wasm/bun-wasm | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/wasm/client.ts` | App web | os/wasm/client | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/wasm/fs-worker.ts` | App web | os/wasm/fs-worker | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/wasm/protocol.ts` | App web | os/wasm/protocol | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/wasm/repl-worker.ts` | App web | os/wasm/repl-worker | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/os/wasm/server-routes.ts` | App web | os/wasm/server-routes | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/styles/main.css` | App web | styles/main | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/templates/TemplatesExplorer.tsx` | App web | templates/TemplatesExplorer | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/templates/templates-data.ts` | App web | templates/templates-data | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/src/templates/templates-source.test.ts` | App web | test ou fixture | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `apps/web/src/templates/templates-source.ts` | App web | templates/templates-source | crates/ui/m3 en WASM + crates web Rust | socle M3 manquant; migration à démarrer |
| `apps/web/test/os-endpoints.test.ts` | App web | test ou fixture | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `apps/web/test/public-assets.test.ts` | App web | test ou fixture | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `apps/web/test/webos-extensions.test.ts` | App web | test ou fixture | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `apps/web/webos.ts` | App web | serveur WebOS | fork Bun, packages/bun-webos | transfert signalé par le code; reçu de destination absent |
| `crates/ui/app/examples/shell_e2e/frontend/index.html` | App desktop | fixture UI desktop | crates/ui/m3 + WASM ou hôte CEF | bundle app-ui React actif; remplacement Rust non qualifié |
| `crates/ui/app/ui-dist/app.css` | App desktop | assets UI desktop | crates/ui/m3 + WASM ou hôte CEF | bundle app-ui React actif; remplacement Rust non qualifié |
| `crates/ui/app/ui-dist/app.js` | App desktop | assets UI desktop | crates/ui/m3 + WASM ou hôte CEF | bundle app-ui React actif; remplacement Rust non qualifié |
| `crates/ui/app/ui-dist/index.html` | App desktop | assets UI desktop | crates/ui/m3 + WASM ou hôte CEF | bundle app-ui React actif; remplacement Rust non qualifié |
| `crates/tauri/aphrody-create-tauri-app/templates/_assets_/styles.css` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-dioxus/assets/styles.css` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-leptos/index.html` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-leptos/styles.css` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-sycamore/index.html` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-sycamore/styles.css` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-vanilla/src/index.html` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-vanilla/src/styles.css` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-vanilla-ts/build.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-vanilla-ts/index.html` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-vanilla-ts/src/styles.css` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-yew/index.html` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-create-tauri-app/templates/template-yew/styles.css` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/scripts/bundle.global.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/scripts/core.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/scripts/freeze_prototype.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/scripts/init.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/scripts/ipc-protocol.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/scripts/ipc.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/scripts/isolation.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/scripts/pattern.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/scripts/process-ipc-message-fn.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/src/event/init.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/src/path/init.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/src/webview/scripts/print.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/src/webview/scripts/zoom-hotkey.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/src/window/scripts/drag.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/test/cef-rollback/dist/index.html` | Tauri | test ou fixture Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/test/fixture/dist/index.html` | Tauri | test ou fixture Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/test/fixture/isolation/dist/index.html` | Tauri | test ou fixture Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/test/fixture/isolation/isolation-dist/index.html` | Tauri | test ou fixture Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri/test/fixture/isolation/isolation-dist/index.js` | Tauri | test ou fixture Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/app.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/core.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/dpi.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/event.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/global.d.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/image.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/menu/base.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/menu/checkMenuItem.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/menu/iconMenuItem.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/menu/menu.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/menu/menuItem.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/menu/predefinedMenuItem.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/menu/submenu.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/menu.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/mocks.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/path.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/tray.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/webview.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/webviewWindow.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-api/src/window.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-cli/src/dev/auto-reload.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-cli/templates/plugin/__example-api/tauri-app/index.html` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-cli/templates/plugin/__example-api/tauri-app/src/main.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-cli/templates/plugin/__example-api/tauri-app/src/style.css` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-cli/templates/plugin/__example-api/tauri-app/src/vite-env.d.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-cli/templates/plugin/__example-api/tauri-app/vite.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-cli/templates/plugin/__example-basic/vanilla/public/index.html` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-cli/templates/plugin/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-cli/templates/plugin/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-autostart/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-autostart/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-autostart/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-clipboard-manager/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-clipboard-manager/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-clipboard-manager/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-deep-link/.test-server/server.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-deep-link/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-deep-link/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-deep-link/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-dialog/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-dialog/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-dialog/guest-js/init.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-dialog/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-dialog/src/init-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-fs/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-fs/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-fs/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-global-shortcut/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-global-shortcut/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-global-shortcut/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-log/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-log/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-log/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-notification/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-notification/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-notification/guest-js/init.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-notification/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-notification/src/init-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-opener/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-opener/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-opener/guest-js/init.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-opener/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-opener/src/init-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-os/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-os/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-os/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-os/src/init.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-process/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-process/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-process/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-store/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-store/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-store/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-updater/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-updater/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-updater/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-window-state/api-iife.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-window-state/guest-js/index.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-plugin-window-state/rollup.config.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-runtime/src/scripts/toggle-devtools.js` | Tauri | script injecté dans la webview | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/aphrody-tauri-utils/src/pattern/isolation.js` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `crates/tauri/build-js.ts` | Tauri | API ou outillage générique Tauri | fork Bun (intégration Tauri générique) | transfert/qualification requis; hors propriétaire Aphrody |
| `packages/web/agent-browser/src/cdp.ts` | Packages web | agent-browser/src/cdp | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/cli.ts` | Packages web | agent-browser/src/cli | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/client.ts` | Packages web | agent-browser/src/client | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/config.ts` | Packages web | agent-browser/src/config | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/engine.ts` | Packages web | agent-browser/src/engine | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/index.ts` | Packages web | agent-browser/src/index | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/runtime.ts` | Packages web | agent-browser/src/runtime | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/service.ts` | Packages web | agent-browser/src/service | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/tauri.ts` | Packages web | agent-browser/src/tauri | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/test-preload.ts` | Packages web | agent-browser/src/test-preload | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/src/types.ts` | Packages web | agent-browser/src/types | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/test/agent-browser.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/agent-browser/test/cdp.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/agent-browser/test/engine-lifecycle.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/agent-browser/test/runtime.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/agent-browser/test/server.ts` | Packages web | test ou fixture de package | crates/web/aphrody-web + aphrody-app | moteur natif consommé; client TypeScript à migrer |
| `packages/web/agent-browser/test/service-native.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/agent-browser/test/service.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/agent-browser/test/sync-client.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/agent-browser/test/tauri.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/aphrody-web-test/src/cdp.ts` | Packages web | aphrody-web-test/src/cdp | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/config.ts` | Packages web | aphrody-web-test/src/config | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/diagnostics.ts` | Packages web | aphrody-web-test/src/diagnostics | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/expect.ts` | Packages web | aphrody-web-test/src/expect | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/index.ts` | Packages web | aphrody-web-test/src/index | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/locator.ts` | Packages web | aphrody-web-test/src/locator | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/next/index.ts` | Packages web | aphrody-web-test/src/next/index | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/page.ts` | Packages web | aphrody-web-test/src/page | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/runner.ts` | Packages web | aphrody-web-test/src/runner | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/selectors.ts` | Packages web | aphrody-web-test/src/selectors | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/sites/aphrody-ui.ts` | Packages web | aphrody-web-test/src/sites/aphrody-ui | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/sites/index.ts` | Packages web | aphrody-web-test/src/sites/index | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/src/sites/rosegriffon.ts` | Packages web | aphrody-web-test/src/sites/rosegriffon | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/test/locator.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/aphrody-web-test/test/next-instant.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/aphrody-web-test/test/setup.ts` | Packages web | test ou fixture de package | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/aphrody-web-test/test/sites.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/fuzzy/scripts/gen-fixtures.ts` | Packages web | fuzzy/scripts/gen-fixtures | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/fuzzy/src/index.ts` | Packages web | fuzzy/src/index | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/fuzzy/test/parity.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/qr/scripts/gen-fixtures.ts` | Packages web | qr/scripts/gen-fixtures | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/qr/src/index.ts` | Packages web | qr/src/index | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/qr/test/parity.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/timeline/src/crawl.ts` | Packages web | timeline/src/crawl | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/timeline/src/graphql.ts` | Packages web | timeline/src/graphql | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/timeline/src/index.ts` | Packages web | timeline/src/index | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/timeline/src/model.ts` | Packages web | timeline/src/model | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/timeline/src/pipeline.ts` | Packages web | timeline/src/pipeline | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/timeline/src/retrieval.ts` | Packages web | timeline/src/retrieval | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/timeline/src/server.ts` | Packages web | timeline/src/server | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/timeline/src/storage.ts` | Packages web | timeline/src/storage | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/timeline/src/training.ts` | Packages web | timeline/src/training | crate du domaine consommant M3 Rust, ou test Rust | migration à planifier par fonction |
| `packages/web/timeline/test/timeline.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/x/examples/06-stealth-cloudflare.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/08-massive-crawl.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/09-ai-extraction.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/10-massive-google-audit.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/crawl-chromium-developers.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/design-discovery.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/ecommerce-price-monitor.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/massive-google-map.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/reddit-json-crawler.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/showcase/hn-1000-crawler.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/wikipedia-infobox-extractor.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/x-batch.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/examples/xcom-scraper.ts` | Packages web | exemple de package | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/function-tools.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/x/index.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/x/ingest.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/x/purge-tweets.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/x/src/algo.ts` | Packages web | x/src/algo | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/batch.ts` | Packages web | x/src/batch | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/config/catalog.ts` | Packages web | x/src/config/catalog | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/config/query-ids.ts` | Packages web | x/src/config/query-ids | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/config/radar-surface.ts` | Packages web | x/src/config/radar-surface | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/config/x-pro-surface.ts` | Packages web | x/src/config/x-pro-surface | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/config/x-surface.ts` | Packages web | x/src/config/x-surface | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/core/client.ts` | Packages web | x/src/core/client | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/core/error.ts` | Packages web | x/src/core/error | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/core/features.ts` | Packages web | x/src/core/features | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/core/local.ts` | Packages web | x/src/core/local | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/core/parse.ts` | Packages web | x/src/core/parse | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/core/schemas.ts` | Packages web | x/src/core/schemas | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/core/session.ts` | Packages web | x/src/core/session | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/db/archive.ts` | Packages web | x/src/db/archive | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/db/ingest.ts` | Packages web | x/src/db/ingest | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/db/store.ts` | Packages web | x/src/db/store | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/index.ts` | Packages web | x/src/index | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/coverage.ts` | Packages web | x/src/services/coverage | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/crawler.ts` | Packages web | x/src/services/crawler | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/cron.ts` | Packages web | x/src/services/cron | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/media.ts` | Packages web | x/src/services/media | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/news.ts` | Packages web | x/src/services/news | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/premium.ts` | Packages web | x/src/services/premium | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/purge-engine.ts` | Packages web | x/src/services/purge-engine | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/purge-tweets.ts` | Packages web | x/src/services/purge-tweets | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/radar.ts` | Packages web | x/src/services/radar | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/unfollow.ts` | Packages web | x/src/services/unfollow | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/services/x-pro-deck.ts` | Packages web | x/src/services/x-pro-deck | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/tools/bundle-catalog.ts` | Packages web | x/src/tools/bundle-catalog | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/tools/function-tools.ts` | Packages web | x/src/tools/function-tools | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/src/tools/web-recon.ts` | Packages web | x/src/tools/web-recon | crates/web/x (aphrody-x) | façade Rust déjà déclarée; tests/parité à qualifier |
| `packages/web/x/unfollow.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/x/web-recon.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |
| `packages/web/x/x-native.test.ts` | Packages web | test ou fixture de package | tests Rust du propriétaire de la fonctionnalité | tests Bun seulement; parité Rust à ajouter |

L’état « migration à planifier » ne signifie pas que le comportement est qualifié. Aucun fichier source n’est supprimé tant que sa parité de routes, interactions, sécurité et accessibilité n’est pas prouvée dans sa cible Rust.

<!-- BEGIN uirust-site inventory -->
## Lot uirust-site : site et serveurs

L'inventaire global est au-dessus; ce bloc détaille les surfaces de ce lot.
Les états décrivent le code constaté et ne valent pas preuve de parité.

| Fichier | Rôle | Cible Rust | État |
| --- | --- | --- | --- |
| `crates/web/site/assets/site.css` | Styles du site Rust | crates/ui/m3 (tokens/styles); servi par crates/web/site | Le serveur Axum existe; rendu/actifs et parité UI restent à qualifier |
| `apps/web/server.ts` | Lanceur HTTP de l'app web | crates/ai/app-server + crates/web/site (Axum) | Déjà un lanceur du serveur Rust; scripts web:dev/start invoquent encore Bun |
| `apps/web/webos.ts` | Relais du serveur WebOS du fork Bun | Fork Bun: packages/bun-webos (propriétaire déclaré dans la source) | Délègue à @aphrody/bun-webos; SHA mentionné dans la source, reçu de transfert absent |
| `apps/web/src/os/ffi-routes.ts` | Routes API FFI | Contrat Axum à définir; préserver le propriétaire runtime/FFI du fork Bun | Handler TS encore présent; parité Axum et retrait non qualifiés |
| `apps/web/src/os/os-router.ts` | Routes OS de démonstration | Contrat Axum à définir après retrait/qualification des simulations WebOS | Handlers simulés seulement; ne pas les publier comme capacités OS réelles |
| `apps/web/src/os/server-extensions.ts` | Composition des routes WebOS/FFI | Contrat Axum à définir; préserver le propriétaire runtime/FFI du fork Bun | Handler TS encore présent; parité Axum et retrait non qualifiés |
| `apps/web/src/os/wasm/server-routes.ts` | Routes bridge fetch/TCP WebOS | Contrat Axum à définir après retrait/qualification des simulations WebOS | Handler TS encore présent; parité Axum et retrait non qualifiés |

<!-- END uirust-site inventory -->

<!-- BEGIN generated uirust inventory -->
## Generated file inventory

Regenerate: `bun scripts/audit/ui/rust-migration.ts`; validate reproducibility: append `--check`. Git-tracked and unignored new source files are enumerated under `apps/web`, `crates/ui`, `crates/tauri`, `crates/web/site`, `crates/web/webos-wasm`, `m3`, `packages/web`; caches and node_modules are excluded. Generated tracked ui-dist files remain explicit artifact rows.

Current files: **1446**. Retired TS/TSX/JS/HTML/CSS files: **62**, from **65** checkpointed apps/web files at `6f7b0805f9afb0c92dcb18c091960cdb373345dc`. Retired files had no active consumer in the native site launcher or canonical build. Their deletion does not establish Rust frontend parity.

Active app-ui, M3 showcase and Bun WebOS remain TypeScript. Native Rust owns the site HTTP routes and catalogs; the canonical app consumer/build and native public routes are qualified. Rust-only component, rendering and desktop parity remains open. `crates/ui/m3` exists; consult its separate owner's gates. No competing framework is created.

## Actual Bun Rust owners

Configured fork HEAD: `dee10d5d0e483ff2561895167c1c13c3f1c818e6`. Locally verified origin/main ref: `ffcc61c49d5b5ef3dfd9aa5503eb3d9a4c0a9a2f` (tracking-ref observation, not a remote fetch or a new dependency integration). Use this exact rev only after downstream qualification; no Git dependency was added by this inventory.

Fork toolchain is nightly-2026-09-15 and edition 2024. Direct consumption must qualify the allocator API and generic experimental/nightly feature gates. CSS, HTTP and bundler/JSC boundaries require their own build/link checks against the native Bun engine; manifest existence does not qualify standalone reuse. No native engine build runs in this inventory.

| Crate | Actual owner manifest | State |
| --- | --- | --- |
| bun_core | src/bun_core/Cargo.toml | verified manifest; downstream integration pending |
| bun_sys | src/sys/Cargo.toml | verified manifest; downstream integration pending |
| bun_paths | src/paths/Cargo.toml | verified manifest; downstream integration pending |
| bun_collections | src/collections/Cargo.toml | verified manifest; downstream integration pending |
| bun_alloc | src/bun_alloc/Cargo.toml | verified manifest; downstream integration pending |
| bun_threading | src/threading/Cargo.toml | verified manifest; downstream integration pending |
| bun_css | src/css/Cargo.toml | verified manifest; downstream integration pending |
| bun_parsers | src/parsers/Cargo.toml | verified manifest; downstream integration pending |
| bun_js_parser | src/js_parser/Cargo.toml | verified manifest; downstream integration pending |
| bun_js_printer | src/js_printer/Cargo.toml | verified manifest; downstream integration pending |
| bun_bundler | src/bundler/Cargo.toml | verified manifest; downstream integration pending |
| bun_http | src/http/Cargo.toml | verified manifest; downstream integration pending |
| bun_sourcemap | src/sourcemap/Cargo.toml | verified manifest; downstream integration pending |
| bun_semver | src/semver/Cargo.toml | verified manifest; downstream integration pending |

## Per-file state

| File | Surface | Role | Target Rust owner | State |
| --- | --- | --- | --- | --- |
| apps/web/build.ts | retired app | build / tooling | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/server.ts | retired app | HTTP server / launcher | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/arcade/ArcadeGame.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/arcade/audio.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/arcade/avatar.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/arcade/engine.test.ts | retired app | test / fixture | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/arcade/engine.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/benchmarks/BenchmarkSuite.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/components/ApiPlayground.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/components/M3Showcase.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/components/MultiTargetBridge.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/core/codebase-scanner.test.ts | retired app | test / fixture | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/core/codebase-scanner.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/core/platform.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/core/theme.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/core/types.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/docs/DocsHub.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/docs/docs-data.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/env.d.ts | retired app | type contract | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/ffi/FFIExplorer.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/CommandPalette.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/DesktopOS.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/Dock.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/TopBar.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/WindowFrame.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/apps/AlpinePackageManagerApp.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/apps/AphrodyToolsApp.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/apps/BunReplApp.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/apps/BunshTerminalApp.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/apps/CodexStudioApp.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/apps/DiagnosticsApp.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/apps/FilesApp.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/apps/KernelMonitorApp.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/apps/M3FusionStudioApp.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/apps/ProcessesApp.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/apps/SpacedriveVfsApp.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/components/PetCompanion.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/components/QuickAskBar.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/ffi-routes.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/os-router.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/public-assets.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/server-extensions.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/system-client.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/system-metrics.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/types.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/wasm/apps.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/wasm/bun-api.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/wasm/bun-wasm.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/wasm/client.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/wasm/fs-worker.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/wasm/protocol.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/wasm/repl-worker.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/os/wasm/server-routes.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/styles/main.css | retired app | styles / tokens | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/templates/TemplatesExplorer.tsx | retired app | component / view | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/templates/templates-data.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/templates/templates-source.test.ts | retired app | test / fixture | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/src/templates/templates-source.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/test/os-endpoints.test.ts | retired app | test / fixture | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/test/public-assets.test.ts | retired app | test / fixture | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/test/webos-extensions.test.ts | retired app | test / fixture | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| apps/web/webos.ts | retired app | module / behavior | crates/web/site + canonical m3/packages/app-ui; WebOS fork owner | removed unused legacy source; NOT Rust frontend parity |
| crates/tauri/aphrody-create-tauri-app/templates/_assets_/styles.css | desktop / Tauri / renderer | styles / tokens | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-create-tauri-app/templates/template-dioxus/assets/styles.css | desktop / Tauri / renderer | styles / tokens | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-create-tauri-app/templates/template-leptos/index.html | desktop / Tauri / renderer | HTML document | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-create-tauri-app/templates/template-leptos/styles.css | desktop / Tauri / renderer | styles / tokens | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-create-tauri-app/templates/template-sycamore/index.html | desktop / Tauri / renderer | HTML document | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-create-tauri-app/templates/template-sycamore/styles.css | desktop / Tauri / renderer | styles / tokens | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-create-tauri-app/templates/template-vanilla-ts/build.ts | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-create-tauri-app/templates/template-vanilla-ts/index.html | desktop / Tauri / renderer | HTML document | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-create-tauri-app/templates/template-vanilla-ts/src/styles.css | desktop / Tauri / renderer | styles / tokens | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-create-tauri-app/templates/template-vanilla/src/index.html | desktop / Tauri / renderer | HTML document | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-create-tauri-app/templates/template-vanilla/src/styles.css | desktop / Tauri / renderer | styles / tokens | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-create-tauri-app/templates/template-yew/index.html | desktop / Tauri / renderer | HTML document | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-create-tauri-app/templates/template-yew/styles.css | desktop / Tauri / renderer | styles / tokens | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/app.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/core.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/dpi.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/event.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/global.d.ts | desktop / Tauri / renderer | type contract | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/image.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/index.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/menu.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/menu/base.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/menu/checkMenuItem.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/menu/iconMenuItem.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/menu/menu.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/menu/menuItem.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/menu/predefinedMenuItem.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/menu/submenu.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/mocks.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/path.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/tray.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/webview.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/webviewWindow.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-api/src/window.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-cli/src/dev/auto-reload.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-cli/templates/plugin/__example-api/tauri-app/index.html | desktop / Tauri / renderer | HTML document | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-cli/templates/plugin/__example-api/tauri-app/src/main.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-cli/templates/plugin/__example-api/tauri-app/src/style.css | desktop / Tauri / renderer | styles / tokens | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-cli/templates/plugin/__example-api/tauri-app/src/vite-env.d.ts | desktop / Tauri / renderer | type contract | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-cli/templates/plugin/__example-api/tauri-app/vite.config.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-cli/templates/plugin/__example-basic/vanilla/public/index.html | desktop / Tauri / renderer | HTML document | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-cli/templates/plugin/guest-js/index.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-cli/templates/plugin/rollup.config.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-autostart/api-iife.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-autostart/guest-js/index.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-autostart/rollup.config.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-clipboard-manager/api-iife.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-clipboard-manager/guest-js/index.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-clipboard-manager/rollup.config.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-deep-link/.test-server/server.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-deep-link/api-iife.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-deep-link/guest-js/index.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-deep-link/rollup.config.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-dialog/api-iife.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-dialog/guest-js/index.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-dialog/guest-js/init.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-dialog/rollup.config.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-dialog/src/init-iife.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-fs/api-iife.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-fs/guest-js/index.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-fs/rollup.config.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-global-shortcut/api-iife.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-global-shortcut/guest-js/index.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-global-shortcut/rollup.config.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-log/api-iife.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-log/guest-js/index.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-log/rollup.config.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-notification/api-iife.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-notification/guest-js/index.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-notification/guest-js/init.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-notification/rollup.config.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-notification/src/init-iife.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-opener/api-iife.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-opener/guest-js/index.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-opener/guest-js/init.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-opener/rollup.config.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-opener/src/init-iife.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-os/api-iife.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-os/guest-js/index.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-os/rollup.config.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-os/src/init.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-process/api-iife.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-process/guest-js/index.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-process/rollup.config.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-store/api-iife.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-store/guest-js/index.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-store/rollup.config.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-updater/api-iife.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-updater/guest-js/index.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-updater/rollup.config.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-window-state/api-iife.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-window-state/guest-js/index.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-plugin-window-state/rollup.config.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-runtime/src/scripts/toggle-devtools.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri-utils/src/pattern/isolation.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri/scripts/bundle.global.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri/scripts/core.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri/scripts/freeze_prototype.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri/scripts/init.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri/scripts/ipc-protocol.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri/scripts/ipc.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri/scripts/isolation.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri/scripts/pattern.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri/scripts/process-ipc-message-fn.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri/src/event/init.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri/src/path/init.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri/src/webview/scripts/print.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri/src/webview/scripts/zoom-hotkey.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri/src/window/scripts/drag.js | desktop / Tauri / renderer | build / tooling | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri/test/cef-rollback/dist/index.html | desktop / Tauri / renderer | test / fixture | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri/test/fixture/dist/index.html | desktop / Tauri / renderer | test / fixture | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri/test/fixture/isolation/dist/index.html | desktop / Tauri / renderer | test / fixture | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri/test/fixture/isolation/isolation-dist/index.html | desktop / Tauri / renderer | test / fixture | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/aphrody-tauri/test/fixture/isolation/isolation-dist/index.js | desktop / Tauri / renderer | test / fixture | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/tauri/build-js.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/ui/app/examples/shell_e2e/frontend/index.html | desktop / Tauri / renderer | HTML document | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/ui/app/ui-dist/app.css | desktop artifact | styles / tokens | crates/ui/app + crates/ui/m3 + crates/web/webos-wasm | generated active TS frontend artifact; Rust migration pending |
| crates/ui/app/ui-dist/app.js | desktop artifact | module / behavior | crates/ui/app + crates/ui/m3 + crates/web/webos-wasm | generated active TS frontend artifact; Rust migration pending |
| crates/ui/app/ui-dist/index.html | desktop artifact | HTML document | crates/ui/app + crates/ui/m3 + crates/web/webos-wasm | generated active TS frontend artifact; Rust migration pending |
| crates/ui/bun/bindings/M3CssRequest.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/ui/tauri-plugin-mcp-bridge/guest-js/index.ts | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| crates/ui/tauri-plugin-mcp-bridge/src/bridge.js | desktop / Tauri / renderer | module / behavior | crates/ui/app + crates/ui/m3 + existing crates/tauri owner | JS/TS/HTML/CSS bridge or asset; Rust-only parity pending |
| m3/apps/example/app/api/health/route.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/apps/example/app/counter.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/apps/example/app/error.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/apps/example/app/globals.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/apps/example/app/guestbook/actions.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/apps/example/app/guestbook/page.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/apps/example/app/guestbook/sign-form.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/apps/example/app/layout.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/apps/example/app/not-found.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/apps/example/app/page.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/apps/example/app/people/[id]/loading.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/apps/example/app/people/[id]/page.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/apps/example/app/people/page.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/apps/example/app/people/people-table.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/apps/example/app/sitemap.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/apps/example/bench/next-vs-m3.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/apps/example/lib/guestbook.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/apps/example/lib/people.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/apps/example/m3.config.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/apps/example/test/app.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/app-ui/backend.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/build.ts | canonical app | build / tooling | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/m3.config.ts | canonical app | build / tooling | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/scripts/brand-theme.ts | canonical app | build / tooling | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/m3.config.ts | M3 showcase | build / tooling | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/scripts/browser-contract.ts | M3 showcase | build / tooling | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/scripts/inventory.ts | M3 showcase | build / tooling | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/scripts/shots.ts | M3 showcase | build / tooling | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/scripts/tauri.ts | M3 showcase | build / tooling | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/App.tsx | M3 showcase | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/adaptive/dpad.ts | M3 showcase | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/adaptive/window.ts | M3 showcase | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/api/index.ts | M3 showcase | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/components/ui.tsx | M3 showcase | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/env.d.ts | M3 showcase | type contract | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/index.html | M3 showcase | HTML document | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/inventory.ts | M3 showcase | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/main.tsx | M3 showcase | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/pages/Adaptive.tsx | M3 showcase | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/pages/Ai.tsx | M3 showcase | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/pages/Brands.tsx | M3 showcase | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/pages/Components.tsx | M3 showcase | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/pages/Design.tsx | M3 showcase | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/pages/Explorer.tsx | M3 showcase | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/pages/Forms.tsx | M3 showcase | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/pages/Icons.tsx | M3 showcase | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/pages/Motion.tsx | M3 showcase | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/pages/Next.tsx | M3 showcase | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/pages/Overview.tsx | M3 showcase | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/pages/Primitives.tsx | M3 showcase | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/pages/Reader.tsx | M3 showcase | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/pages/System.tsx | M3 showcase | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/pages/Theme.tsx | M3 showcase | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/pages/index.ts | M3 showcase | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/router.ts | M3 showcase | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/shell/Shell.tsx | M3 showcase | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/shell/nav.ts | M3 showcase | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/src/styles.css | M3 showcase | styles / tokens | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/test-dom/dpad.test.ts | M3 showcase | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/test/build.test.ts | M3 showcase | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/test/contracts.test.ts | M3 showcase | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/test/host-contract.test.ts | M3 showcase | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/showcase/test/runtime-api.test.ts | M3 showcase | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/site.ts | canonical app | HTTP server / launcher | crates/web/site (HTTP implemented); native CLI entry pending | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/CommandPalette.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/Settings/pages/AboutSettings.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/Settings/pages/AdvancedSettings.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/Settings/pages/AgentSettings.behavior.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/Settings/pages/AgentSettings.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/Settings/pages/AgentToolsSettings.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/Settings/pages/AppearanceSettings.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/Settings/pages/GeneralSettings.behavior.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/Settings/pages/GeneralSettings.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/Settings/pages/IndexerSettings.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/Settings/pages/KeyboardSettings.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/Settings/pages/LibrarySettings.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/Settings/pages/ModelsSettings.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/Settings/pages/PrivacySettings.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/Settings/pages/ServicesSettings.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/Settings/pages/SettingsLayout.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/Settings/pages/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/Shell.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/ShellLayout.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/TopBar/Context.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/TopBar/Item.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/TopBar/OverflowMenu.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/TopBar/Portal.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/TopBar/Section.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/TopBar/TopBar.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/TopBar/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/TopBar/useOverflowCalculation.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/app-parity.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/app.css | canonical app | styles / tokens | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/app.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/appearance.behavior.test.tsx | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/backend-contract.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/backend-inventory.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/brand-theme.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/brand-theme.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/brand-tokens.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/brand.css | canonical app | styles / tokens | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/browser-session-stream.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/browser-session-stream.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/codex-chat.behavior.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/codex-chat.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/codex-chat.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/codex-ui.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/command-actions.behavior.test.tsx | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/DndProvider.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/ErrorBoundary.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Inspector/Inspector.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Inspector/LocationMap.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Inspector/primitives/Divider.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Inspector/primitives/InfoRow.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Inspector/primitives/Section.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Inspector/primitives/TabContent.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Inspector/primitives/Tabs.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Inspector/primitives/Tag.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Inspector/primitives/Thumbnail.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Inspector/primitives/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Inspector/variants/FileInspector.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Inspector/variants/KnowledgeInspector.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Inspector/variants/LocationInspector.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Inspector/variants/MultiFileInspector.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Inspector/variants/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/JobManagerPopover.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/JobsScreen/JobRow.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/JobsScreen/index.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/components/CopyJobDetails.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/components/EmptyState.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/components/JobCard.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/components/JobList.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/components/JobProgressBar.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/components/JobStatusIndicator.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/components/SpeedGraph.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/hooks/JobsContext.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/hooks/useJobCount.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/hooks/useJobManager.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/hooks/useJobs.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/hooks/useJobsDesktop.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/renderers/FileCopyRenderer.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/renderers/GenericRenderer.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/renderers/index.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/JobManager/types.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Orb.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/AudioPlayer.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/ContentRenderer.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/Controller.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/DirectoryPreview.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/MeshViewer.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/QuickPreview.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/QuickPreviewFullscreen.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/QuickPreviewModal.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/QuickPreviewOverlay.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/SplatShimmerEffect.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/SubtitleSettingsMenu.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/Subtitles.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/Syncer.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/TextViewer.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/TimelineScrubber.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/VideoControls.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/VideoPlayer.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/mesh-orbit-controls.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/mesh-orbit-controls.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/prism-languages.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/prism-lazy.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/prism-manual.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/prism.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/srt.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/QuickPreview/useZoomPan.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Sources/SourceCard.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Sources/SourceDataRow.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Sources/SourcePathBar.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Sources/SourceStatusBadge.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Sources/SourceTypeIcon.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/AddGroupButton.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/AddGroupModal.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/CreateSpaceModal.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/DevicesGroup.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/GroupHeader.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/LocationsGroup.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/SourcesGroup.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/SpaceCustomizationPanel.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/SpaceGroup.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/SpaceItem.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/SpaceSwitcher.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/TagsGroup.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/VolumesGroup.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/dnd.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/hooks/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/hooks/spaceItemUtils.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/hooks/useSpaceItemActive.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/hooks/useSpaceItemContextMenu.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/hooks/useSpaceItemDropZones.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/hooks/useSpaces.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/hooks/useVolumeContextMenu.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SpacesSidebar/index.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SyncMonitor/SyncMonitorPopover.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SyncMonitor/components/ActivityFeed.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SyncMonitor/components/PeerList.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SyncMonitor/hooks/useSyncCount.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SyncMonitor/hooks/useSyncMonitor.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SyncMonitor/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SyncMonitor/types.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/SyncMonitor/utils.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/TabManager/TabBar.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/TabManager/TabDefaultsSync.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/TabManager/TabKeyboardHandler.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/TabManager/TabManagerContext.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/TabManager/TabNavigationSync.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/TabManager/TabView.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/TabManager/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/TabManager/route-title.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/TabManager/route-title.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/TabManager/tab-navigation.behavior.test.tsx | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/TabManager/useTabManager.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Tags/TagDot.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Tags/TagPill.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Tags/TagSelector.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/Tags/index.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/WrappedPopover.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/modals/CreateLibraryModal.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/modals/FileOperationModal.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/modals/PairingModal.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/modals/SyncSetupModal.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/overlays/DaemonDisconnectedOverlay.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/components/overlays/DaemonStartupOverlay.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/contexts/PlatformContext.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/contexts/ServerContext.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/contexts/SpacedriveContext.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/contexts/WebContextMenuContext.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/desktop-navigation.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/desktop-surfaces.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/framework-utils.d.ts | canonical app | type contract | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/gemini-layout.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/generated/bun-catalog.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/history-panel.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/history.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/history.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/hooks/useAdapterIcons.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/hooks/useAudioRecorder.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/hooks/useClipboard.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/hooks/useContextMenu.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/hooks/useDaemonStatus.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/hooks/useEvent.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/hooks/useJobDispatch.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/hooks/useKeybind.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/hooks/useKeybindMeta.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/hooks/useKeybindScope.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/hooks/useLibraries.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/hooks/useOpenWith.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/hooks/usePopover.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/hooks/useRefetchTagQueries.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/hooks/useTheme.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/i18n.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/identity-bridge.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/identity-bridge.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/index.html | canonical app | HTML document | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/jan-ui-behavior.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/jan-ui-interaction.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/kit-bridge.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/kit-bridge.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/kit-surface.behavior.test.tsx | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/m3-env.d.ts | canonical app | type contract | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/menu-commands.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/menu-commands.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/models-hub-actions.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/models-hub-state.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/models-hub.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/models-hub.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/navigation-shell.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/onboarding.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/open-requests.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/open-requests.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/pet-behavior.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/pet-behavior.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/preferences.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/public-navigation.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/quickbar-input.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/quickbar-input.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/quickbar-suggest.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/quickbar-suggest.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/quickbar.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/rail-drawer.test.tsx | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/rail-drawer.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/router.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/admin/index.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/creator/index.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/ExplorerView.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/File/File.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/File/FileStack.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/File/Metadata.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/File/Thumb.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/File/ThumbstripScrubber.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/File/Title.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/File/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/KeyboardHandler.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/SearchToolbar.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/SelectionContext.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/SortMenu.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/TabNavigationGuard.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/TagAssignmentMode.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/ViewModeMenu.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/ViewSettings.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/ai-helpers.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/components/AddLocationModal.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/components/AddStorageModal.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/components/Breadcrumb.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/components/DragSelect/context.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/components/DragSelect/useDragSelection.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/components/DragSelect/utils.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/components/ExpandableSearchButton.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/components/FileSelectionAiBar.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/components/InlineNameEdit.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/components/PathBar.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/components/VirtualPathBar.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/components/VolumeSizeBar.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/context.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/explorer-ai-actions.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/explorer-ai-contract.behavior.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/hooks/useAskAphrody.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/hooks/useDeleteFiles.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/hooks/useDraggableFile.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/hooks/useEmptySpaceContextMenu.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/hooks/useExplorerFiles.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/hooks/useExplorerKeyboard.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/hooks/useFileContextMenu.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/hooks/useTypeaheadSearch.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/hooks/useVirtualListing.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/utils.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/ColumnView/Column.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/ColumnView/ColumnItem.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/ColumnView/ColumnView.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/ColumnView/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/DragSelect.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/EmptyView.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/GridView/FileCard.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/GridView/GridView.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/GridView/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/KnowledgeView.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/ListView/ListView.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/ListView/TableRow.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/ListView/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/ListView/useTable.test.tsx | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/ListView/useTable.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/MediaView/DateHeader.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/MediaView/MediaView.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/MediaView/MediaViewItem.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/MediaView/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/MediaView/utils.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/RecentsView/RecentsView.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/RecentsView/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/SearchView/SearchView.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/SearchView/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/SizeView/SizeCircle.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/SizeView/SizeView.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/explorer/views/SizeView/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/file-kinds/index.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/kit/KitSurface.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/kit/use-kit-visible.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/product/catalog.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/product/catalog.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/product/index.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/redundancy/index.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/settings/index.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/sources/Adapters.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/sources/SourceDetail.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/sources/index.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/studio/A2AStudio.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/studio/DriveStudio.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/studio/RuntimeStudio.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/studio/StudioHeader.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/studio/index.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/studio/navigation.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/routes/tag/index.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/runtime-studio.behavior.test.tsx | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/showcase-env.d.ts | canonical app | type contract | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/site-launcher.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/stores/aphrodyJobStore.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/stores/chat-store.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/stores/volumeIndexingStore.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/studio-bridge.behavior.test.ts | canonical app | test / fixture | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/studio-bridge.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/styles.css | canonical app | styles / tokens | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/system-presets.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/tauri-bridge.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/use-open-requests.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/util/keybinds/index.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/util/keybinds/listener.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/util/keybinds/platform.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/util/keybinds/registry.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/util/keybinds/types.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/vite-env.d.ts | canonical app | type contract | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/windows/DemoWindow.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/windows/FloatingControls.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/src/windows/Spacedrop.tsx | canonical app | component / view | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/test-preload.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/undeclared-deps.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/app-ui/webos.ts | canonical app | module / behavior | crates/ui/m3 + crates/ui/app + crates/web/webos-wasm | active TS frontend / tooling; Rust frontend parity pending |
| m3/packages/assets/icons/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/assets/images/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/assets/scripts/generate.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/assets/sounds/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/assets/svgs/brands/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/assets/svgs/ext/Code/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/assets/svgs/ext/Extras/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/assets/svgs/ext/Extras/urls.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/assets/svgs/ext/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/assets/test/util.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/assets/types.d.ts | M3 framework / example / template | type contract | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/assets/util/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/assets/util/mobile.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/assets/videos/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/canvas/index.d.ts | M3 framework / example / template | type contract | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/canvas/index.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/canvas/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/canvas/native.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/canvas/scene-types.d.ts | M3 framework / example / template | type contract | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/canvas/scripts/vendor-upstream.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/canvas/site.d.ts | M3 framework / example / template | type contract | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/canvas/site.ts | M3 framework / example / template | HTTP server / launcher | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/canvas/types.check.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/canvas/vendor.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/canvas/vendor/geometry.js | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/canvas/vendor/index.d.ts | M3 framework / example / template | type contract | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/canvas/vendor/index.js | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/canvas/vendor/js-binding.js | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/canvas/vendor/load-image.js | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/eslint-plugin-m3/index.d.ts | M3 framework / example / template | type contract | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/eslint-plugin-m3/index.js | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/eslint-plugin-m3/rules/helpers.js | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/eslint-plugin-m3/rules/no-hardcoded-color.js | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/eslint-plugin-m3/rules/no-mui-import.js | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/eslint-plugin-m3/rules/no-mui-prop-on-md.js | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/eslint-plugin-m3/rules/no-sx-prop.js | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/eslint-plugin-m3/rules/prefer-icon-token.js | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/eslint-plugin-m3/rules/require-icon-button-label.js | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/eslint-plugin-m3/rules/valid-color-role.js | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/eslint-plugin-m3/rules/valid-icon-name.js | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/eslint-plugin-m3/scripts/sync-symbol-names.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/eslint-plugin-m3/test/fixtures/bad.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/eslint-plugin-m3/test/fixtures/good.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/eslint-plugin-m3/test/run.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/identity/scripts/generate.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/identity/src/AphrodyAvatar.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/identity/src/AphrodyPet.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/identity/src/animations.generated.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/identity/src/atlas.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/identity/src/brand.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/identity/src/compact.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/identity/src/env.d.ts | M3 framework / example / template | type contract | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/identity/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/identity/src/pet.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/identity/src/pet.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/build.config.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/A2APeerInspector.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/A2ATaskTimeline.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/AgUiEventStream.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/ChatComposer.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/ConversationList.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/GeminiAccountMenu.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/GeminiPersonalContextEdit.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/GoogleSpotlightBar.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/InlineBranchCard.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/InlineWorkerCard.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/Markdown.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/McpAppCard.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/MemoryPanel.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/MessageBubble.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/ModelSelector.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/ModelUnavailable.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/TaskCreateForm.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/TaskDetail.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/TaskList.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/TaskPriorityIcon.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/TaskRow.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/TaskStatusIcon.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/ToolCall.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/ag-ui.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/chatIcons.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/chatLabels.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/citations.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/internal.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/openaiChatStream.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/types.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/src/useOpenAIChat.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/test/ag-ui-a2a-bridge.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/test/ag-ui-registry-contract.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/test/ai.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/test/chat.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/test/google-gemini-benchmark.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-ai/test/production-contract.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/accordion.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/avatar.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/button.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/checkbox.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/collapsible.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/combobox.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/core.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/dialog.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/drawer.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/field.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/menu.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/navigation-menu.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/number-field.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/otp-field.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/popover.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/progress.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/radio.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/scroll-area.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/select.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/separator.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/slider.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/switch.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/tabs.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/toast.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/toggle.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/toolbar.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/css/tooltip.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/m3-baseui.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/accordion.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/alert-dialog.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/autocomplete.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/avatar.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/button.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/checkbox-group.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/checkbox.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/collapsible.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/combobox.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/context-menu.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/dialog.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/drawer.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/field.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/fieldset.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/form.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/input.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/menu.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/menubar.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/meter.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/navigation-menu.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/number-field.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/otp-field.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/part.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/popover.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/preview-card.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/progress.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/radio-group.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/radio.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/scroll-area.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/select.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/separator.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/slider.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/switch.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/tabs.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/toast.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/toggle-group.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/toggle.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/toolbar.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/src/tooltip.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/test/css.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/test/render.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-baseui/test/surface.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/bin/m3-bun.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/client.d.ts | M3 framework / example / template | type contract | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/api.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/build.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/cli.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/compile.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/config.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/entry.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/icons.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/package.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/plugin.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/runtime.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/server.ts | M3 framework / example / template | HTTP server / launcher | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/targets/cloudflare.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/targets/coolify.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/targets/docker.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/targets/fly.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/targets/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/targets/linux-image.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/targets/nginx.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/targets/systemd.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/targets/types.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/targets/vercel.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/targets/vscode.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/targets/windows.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/theme-css.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/src/util.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/api.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/build.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/cli.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/compile.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/config.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/entry.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/fixtures/app/m3.config.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/fixtures/app/src/api.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/fixtures/app/src/env.d.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/fixtures/app/src/index.html | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/fixtures/app/src/main.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/fixtures/app/src/styles.css | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/generated-paths.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/helpers.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/http-contract.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/icons.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/package.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/plugin.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/runtime-lifecycle.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/runtime.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/server.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/system.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/targets.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-bun/test/theme-css.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/button.input.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/button.output.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/checkbox.input.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/checkbox.output.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/dialog.input.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/dialog.output.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/icons-alias.input.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/icons-alias.output.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/icons.input.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/icons.output.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/jsx-strings.input.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/jsx-strings.output.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/layout.input.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/layout.output.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/nested-layout.input.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/nested-layout.output.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/return-todo.input.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/return-todo.output.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/slot-icons.input.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/slot-icons.output.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/textfield.input.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/__testfixtures__/textfield.output.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/lib/edits.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/lib/engine.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/lib/icon-names.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/lib/imports.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/lib/jsx-helpers.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/lib/mapping.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/lib/tsx-scan.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/scripts/codemod.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/scripts/export-map-json.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/scripts/fixtures.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/scripts/run-fixtures.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/test/fixtures.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/test/public-api.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/transforms/button.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/transforms/fields.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/transforms/icons.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/transforms/mui-imports.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-codemods/transforms/orchestrator.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-config/bun-build.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-config/cache-db.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-config/test/bun-build.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-config/test/cache-db.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-config/test/cache-integrity.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-config/test/dom.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-design/design-systems/material/tokens.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-design/src/generated-behavior.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-design/src/generator.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-design/src/generator.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-design/src/handlers.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-design/src/handlers.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-design/src/hct.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-design/src/hct.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-design/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-design/src/native.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-design/src/node.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-design/src/parser.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-design/src/parser.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-design/src/prompts.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-design/src/server.ts | M3 framework / example / template | HTTP server / launcher | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-design/src/types.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-explorer/build.config.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-explorer/src/FileThumb.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-explorer/src/GoogleDriveListView.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-explorer/src/GridItem.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-explorer/src/RenameInput.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-explorer/src/TagPill.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-explorer/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-explorer/test/crawlable-ssr.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-explorer/test/explorer.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-explorer/test/file-thumb-dom.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-explorer/test/google-drive-list.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-explorer/test/production-contract.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-fonts/scripts/generate.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-fonts/scripts/subset.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-fonts/src/fonts-jp.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-fonts/src/fonts-symbols.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-fonts/src/fonts.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-fonts/src/fonts.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-fonts/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-forms/build.config.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-forms/src/CheckboxField.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-forms/src/Form.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-forms/src/InputField.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-forms/src/RadioGroupField.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-forms/src/SelectField.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-forms/src/SwitchField.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-forms/src/TextAreaField.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-forms/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-forms/test/crawlable-ssr.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-forms/test/forms.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-forms/test/production-contract.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-front/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-front/src/register.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-front/src/theme-element.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-front/src/window-class.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-front/test/front.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-front/test/production-contract.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-icons/build.config.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-icons/src/browser-lit.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-icons/src/browser.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-icons/src/codegen.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-icons/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-icons/src/lit.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-icons/src/plugin.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-icons/src/react.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-icons/test/browser.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-icons/test/icons.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-mcp/src/catalog.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-mcp/src/catalog.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-mcp/src/tool-host.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-mcp/src/tools.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-mcp/test/catalog.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-mcp/test/tool-host.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-motion/build.config.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-motion/src/components/M3Collapse.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-motion/src/components/M3ContainerTransform.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-motion/src/components/M3Fade.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-motion/src/components/M3FadeThrough.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-motion/src/components/M3ListStagger.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-motion/src/components/M3SharedAxis.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-motion/src/components/M3Transition.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-motion/src/easings.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-motion/src/hooks/useM3Animate.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-motion/src/hooks/useM3ReducedMotion.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-motion/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-motion/src/spring-interpolation.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-motion/src/springs.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-motion/test/m3-motion.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-motion/test/production-contract.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-motion/test/spring-interpolation.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/build.config.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/cli.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/codemods/cli.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/codemods/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/codemods/jsx.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/codemods/mui.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/dependencies.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/layout.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/migrator.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/requirements.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/scaffolder.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/scanner.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/shims/dynamic.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/shims/font.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/shims/form.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/shims/headers.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/shims/image.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/shims/link.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/shims/metadata.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/shims/navigation.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/shims/provider.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/shims/server.ts | M3 framework / example / template | HTTP server / launcher | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/shims/tauri-ipc.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/src/transform.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/test-dom/runtime-shims.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/test/cli-contract.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/test/codemods.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/test/migration-files.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/test/migrator.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/test/open-external.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/test/requirements.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/test/route-contract.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/test/scaffold-delegation.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/test/server-boundary.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next-migrate/test/transform-boundary.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/bin/m3-next.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/build.config.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/examples/app/app/api/health/route.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/examples/app/app/components/notifier.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/examples/app/app/components/page.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/examples/app/app/globals.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/examples/app/app/layout.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/examples/app/app/nav.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/examples/app/app/page.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/examples/app/app/theme-toggle.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/examples/app/app/theme/page.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/examples/app/next.config.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/examples/app/proxy.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/examples/app/test/example.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/examples/tauri/app/about/page.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/examples/tauri/app/globals.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/examples/tauri/app/layout.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/examples/tauri/app/page.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/examples/tauri/app/theme-toggle.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/examples/tauri/next.config.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/examples/tauri/test/example.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/m3.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/scripts/browser-check.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/scripts/bundle-report.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/scripts/yolo-example.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/src/client.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/src/constants.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/src/crawl.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/src/server.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/src/theme-proxy.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/test-dom/client.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/test/config.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/test/cookie-contract.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/test/crawl.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/test/m3-next.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-next/test/theme-proxy.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-os-themes/src/chromium.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-os-themes/src/cli.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-os-themes/src/color.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-os-themes/src/cosmic.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-os-themes/src/generate.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-os-themes/src/gnome.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-os-themes/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-os-themes/src/png.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-os-themes/src/types.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-os-themes/src/windows.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-os-themes/test/color-cache.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-os-themes/test/generate.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-os-themes/test/installer-integrity.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/build.config.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Accordion.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/AlertDialog.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Avatar.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Badge.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Banner.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Button.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Card.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Checkbox.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/CircleButton.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/CircleButtonGroup.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/CircularProgress.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Collapsible.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/ContextMenu.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Dialog.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Divider.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Drawer.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Dropdown.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/DropdownMenu.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Field.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/FilterButton.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Icon.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/InfoBanner.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Input.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Layout.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Loader.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Meter.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/NumberStepper.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/OptionList.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Popover.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/ProgressBar.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/RadioGroup.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Resizable.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/ScrollArea.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/SearchBar.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Select.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/SelectPill.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/SelectTriggerButton.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/ShinyButton.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/ShinyToggle.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Shortcut.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Slider.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/SpaceItem.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Switch.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/TabBar.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Tabs.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Toast.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/ToggleGroup.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Tooltip.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/Typography.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/base-ui.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/forms/Form.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/keys.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/src/utils.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/test/actions-display.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/test/base-ui-components.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/test/base-ui.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/test/crawlable-ssr.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/test/hydration.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/test/inputs.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/test/overlays.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-primitives/test/production-contract.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/adapters/tanstack.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/adaptive/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/adaptive/use-window-size-class.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/build.config.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/data/DataTable.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/data/VirtualList.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/data/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/generate.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/material-web-shims.d.ts | M3 framework / example / template | type contract | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/state/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/state/use-text-field-state.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/test/adaptive.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/test/bundle-size.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/test/data.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/test/production-contract.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/test/tanstack-adapter.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/test/transitions.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/test/use-text-field-state.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/test/wrappers.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/transitions/Collapse.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/transitions/Fade.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/transitions/Grow.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/transitions/Slide.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/transitions/Zoom.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/transitions/create-transition.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/transitions/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/transitions/use-transition-state.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/alert.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/appbar.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/autocomplete.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/avatar.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/backdrop.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/badge.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/banner.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/breadcrumbs.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/button.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/buttongroup.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/canvas3d.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/card.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/card3d.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/carousel.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/charts.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/checkbox.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/chips.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/datepicker.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/dialog.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/divider.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/effects.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/elevation.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/expansion.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/fab.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/fabmenu.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/field.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/focus.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/globe3d.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/gridlist.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/icon.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/iconbutton.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/labs.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/layout.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/link.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/list.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/loadingindicator.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/menu.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/mobilestepper.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/navigationrail.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/paginator.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/popover.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/progress.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/radio.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/rating.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/ripple.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/scheduler.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/search.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/select.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/sheet.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/skeleton.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/slider.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/snackbar.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/stepper.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/surface.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/switch.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/table.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/tabs.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/textfield.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/timepicker.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/toolbar.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/tooltip.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/tree.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/typography.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-react/wrappers/virtualscroll.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-reader/build.config.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-reader/src/CaptionedReader.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-reader/src/CollectionReader.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-reader/src/MangaReader.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-reader/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-reader/src/reader-lifecycle.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-reader/src/use-focus-trap.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-reader/src/use-reader-core.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-reader/styles.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-reader/test/crawlable-ssr.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-reader/test/manga.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-reader/test/reader.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-reader/test/setup.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tailwind/preset.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tailwind/scripts/generate.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tailwind/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tailwind/src/spring.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tailwind/test/preset.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-theme/build.config.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-theme/generate.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-theme/scripts/mcu-fixture.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-theme/scripts/mcu-image-fixture.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-theme/spaceui.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-theme/src/brand.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-theme/src/catalog.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-theme/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-theme/src/react.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-theme/src/tauri.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-theme/tailwind.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-theme/test/brand.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-theme/test/fusion.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-theme/test/production-contract.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-theme/test/sheets.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-theme/tokens.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/build.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/scripts/generate-expressive.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/src/breakpoints.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/src/breakpoints.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/src/cli.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/src/dynamic-color.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/src/expressive.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/src/expressive.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/src/m3-tokens.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/src/platform-contract.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/src/theme-to-tokens.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/test/a11y-contrast.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/test/breakpoints.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/test/contrast-level.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/test/dynamic-color.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/test/expressive.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/test/m3-tokens-css.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/test/production-contract.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/test/scheme-variants.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3-tokens/test/theme-to-tokens.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/bin/m3.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/build.config.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/client.d.ts | M3 framework / example / template | type contract | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/qualification/check.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/boundaries.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/build.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/cache.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/cli.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/compile.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/dev.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/headers.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/host.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/image-size.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/image.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/link.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/navigation.server.ts | M3 framework / example / template | HTTP server / launcher | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/navigation.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/plugin.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/prerender.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/runtime/client.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/runtime/matcher.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/runtime/metadata.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/runtime/registry.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/runtime/router-context.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/runtime/router.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/runtime/rsc.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/runtime/shared.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/runtime/ssr.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/runtime/store.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/scan.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/app/server.ts | M3 framework / example / template | HTTP server / launcher | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/build.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/cli.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/config.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/data.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/i18n.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/lit.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/native.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/new.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/paths.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/plugin.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/react.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/server.ts | M3 framework / example / template | HTTP server / launcher | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/showcase.html | M3 framework / example / template | HTML document | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/tailwind.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/tokens.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/src/url-imports.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/app/compile.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/app/plugin.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/app/router.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/app/scan.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/build.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/cli.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/config.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/data.test.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/app-router/app/actions.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/app-router/app/api/hello/route.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/app-router/app/blog/[slug]/loading.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/app-router/app/blog/[slug]/page.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/app-router/app/counter.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/app-router/app/dash/page.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/app-router/app/form.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/app-router/app/layout.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/app-router/app/not-found.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/app-router/app/page.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/app-router/app/robots.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/app-router/proxy.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/app/app.css | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/app/index.html | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/app/m3.config.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/app/m3.plain.config.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/app/main.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/app/plain.html | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/pages/about.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/pages/health.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/pages/index.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/pages/rpc/echo.tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/pages/users/[id].tsx | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/spa/index.html | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/fixtures/spa/main.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/helpers.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/i18n.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/native.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/plugin.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/proxy-boundary.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/server.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/m3/test/tailwind.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/material-design-icons/scripts/export-theme.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/material-design-icons/scripts/svg-to-ico.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/material-design-icons/scripts/sync-catalogue.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/material-design-icons/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/material-design-icons/test/catalogue.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/scaffold/src/cli.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/scaffold/src/files.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/scaffold/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/scaffold/src/names.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/scaffold/src/pins.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/scaffold/src/png.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/scaffold/src/tauri.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/scaffold/src/templates/app.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/scaffold/src/templates/spa.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/scaffold/src/templates/web.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/scaffold/src/workspace.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/scaffold/test/scaffold.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/scaffold/test/writer-boundary.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/web-to-tauri/src/cli.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/web-to-tauri/src/drivers.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/web-to-tauri/src/generate.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/web-to-tauri/src/index.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/web-to-tauri/src/parity.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/web-to-tauri/src/plan.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/web-to-tauri/src/policy.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/web-to-tauri/src/probe.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/web-to-tauri/src/signals.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/web-to-tauri/src/types.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/web-to-tauri/test/fixtures.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/web-to-tauri/test/generate.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/web-to-tauri/test/parity.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/web-to-tauri/test/plan.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/web-to-tauri/test/policy.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/web-to-tauri/test/probe.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/packages/web-to-tauri/test/signals.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/bench/fixtures/index.html | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/bench/fixtures/main.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/bench/fixtures/server.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/bench/fixtures/themes-probe.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/bench/lib.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/bench/lib.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/bench/run.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/bench/workspace.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/build.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/build.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/bundle-size.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/check-assets.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/check-assets.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/check-exports.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/check-exports.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/check-links.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/check-links.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/fonts-sync.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/lib/workspace.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/native.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/native.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/yolo.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/scripts/yolo.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/base/runtime-env.d.ts | M3 framework / example / template | type contract | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/base/scripts/build-bin.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/base/scripts/pack-deploy.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/base/scripts/preload.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/base/scripts/supervise.ts | M3 framework / example / template | build / tooling | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/base/src/app.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/base/src/home.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/base/src/server.ts | M3 framework / example / template | HTTP server / launcher | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/base/test/app.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/elysia/src/alt/elysia.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/hono/src/alt/hono.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/react/src/home.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/react/src/web/App.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/react/src/web/index.html | M3 framework / example / template | HTML document | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/react/src/web/m3.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/react/src/web/main.tsx | M3 framework / example / template | component / view | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/react/src/web/styles.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/react/test/react.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/web/src/home.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/web/src/web/index.html | M3 framework / example / template | HTML document | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/web/src/web/main.ts | M3 framework / example / template | module / behavior | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/web/src/web/styles.css | M3 framework / example / template | styles / tokens | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| m3/templates/web/test/web.test.ts | M3 framework / example / template | test / fixture | crates/ui/m3 (lot uirust-m3) + crates/ui/{m3-tokens,taffy,render,softraster,svg,sprite-sheet} | TS source; Rust component parity pending |
| packages/web/agent-browser/src/cdp.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/agent-browser/src/cli.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/agent-browser/src/client.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/agent-browser/src/config.ts | web capability | build / tooling | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/agent-browser/src/engine.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/agent-browser/src/index.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/agent-browser/src/runtime.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/agent-browser/src/service.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/agent-browser/src/tauri.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/agent-browser/src/test-preload.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/agent-browser/src/types.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/agent-browser/test/agent-browser.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/agent-browser/test/cdp.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/agent-browser/test/engine-lifecycle.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/agent-browser/test/runtime.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/agent-browser/test/server.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/agent-browser/test/service-native.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/agent-browser/test/service.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/agent-browser/test/sync-client.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/agent-browser/test/tauri.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/aphrody-web-test/src/cdp.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/aphrody-web-test/src/config.ts | web capability | build / tooling | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/aphrody-web-test/src/diagnostics.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/aphrody-web-test/src/expect.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/aphrody-web-test/src/index.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/aphrody-web-test/src/locator.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/aphrody-web-test/src/next/index.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/aphrody-web-test/src/page.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/aphrody-web-test/src/runner.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/aphrody-web-test/src/selectors.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/aphrody-web-test/src/sites/aphrody-ui.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/aphrody-web-test/src/sites/index.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/aphrody-web-test/src/sites/rosegriffon.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/aphrody-web-test/test/locator.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/aphrody-web-test/test/next-instant.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/aphrody-web-test/test/setup.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/aphrody-web-test/test/sites.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/fuzzy/scripts/gen-fixtures.ts | web capability | build / tooling | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/fuzzy/src/index.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/fuzzy/test/parity.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/qr/scripts/gen-fixtures.ts | web capability | build / tooling | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/qr/src/index.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/qr/test/parity.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/timeline/src/crawl.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/timeline/src/graphql.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/timeline/src/index.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/timeline/src/model.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/timeline/src/pipeline.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/timeline/src/retrieval.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/timeline/src/server.ts | web capability | HTTP server / launcher | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/timeline/src/storage.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/timeline/src/training.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/timeline/test/timeline.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/examples/06-stealth-cloudflare.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/examples/08-massive-crawl.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/examples/09-ai-extraction.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/examples/10-massive-google-audit.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/examples/crawl-chromium-developers.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/examples/design-discovery.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/examples/ecommerce-price-monitor.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/examples/massive-google-map.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/examples/reddit-json-crawler.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/examples/showcase/hn-1000-crawler.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/examples/wikipedia-infobox-extractor.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/examples/x-batch.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/examples/xcom-scraper.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/function-tools.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/index.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/ingest.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/purge-tweets.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/algo.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/batch.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/config/catalog.ts | web capability | build / tooling | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/config/query-ids.ts | web capability | build / tooling | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/config/radar-surface.ts | web capability | build / tooling | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/config/x-pro-surface.ts | web capability | build / tooling | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/config/x-surface.ts | web capability | build / tooling | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/core/client.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/core/error.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/core/features.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/core/local.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/core/parse.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/core/schemas.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/core/session.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/db/archive.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/db/ingest.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/db/store.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/index.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/services/coverage.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/services/crawler.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/services/cron.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/services/media.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/services/news.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/services/premium.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/services/purge-engine.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/services/purge-tweets.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/services/radar.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/services/unfollow.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/services/x-pro-deck.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/tools/bundle-catalog.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/tools/function-tools.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/src/tools/web-recon.ts | web capability | module / behavior | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/unfollow.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/web-recon.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
| packages/web/x/x-native.test.ts | web capability | test / fixture | crates/web/{web-engine,obscura-*,webos-wasm} existing capability owner | TS capability / tests; file-level Rust parity pending |
<!-- END generated uirust inventory -->
