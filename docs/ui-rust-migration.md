<!-- SPDX-License-Identifier: Apache-2.0 -->
# Migration de l’UI vers Rust

Inventaire exhaustif généré par `python3 scripts/audit/ui-rust-m3-inventory.py`. Les autres lots maintiennent leurs sections hors du bloc généré M3.

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
