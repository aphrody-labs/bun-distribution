// SPDX-License-Identifier: Apache-2.0
//! COSMIC desktop concepts adapted to the controller-first console, as renderer-agnostic models
//! shared by the console shell (Bevy) and play.aphrody.app (JSON over the platform service).
//!
//! COSMIC's panel, applets, launcher, notifications daemon, workspaces and settings app are
//! GPL-3.0 programs; Bun OS reimplements their *models* here (no COSMIC code is copied or linked):
//!
//! | COSMIC                                  | Bun OS model                                  |
//! |-----------------------------------------|-----------------------------------------------|
//! | cosmic-panel + cosmic-applets           | [`applets`]: quick-menu tiles and status items contributed by plugins |
//! | cosmic-launcher / pop-launcher          | [`launcher`]: one search over games, apps, settings and actions |
//! | cosmic-notifications (freedesktop spec) | [`notifications`]: toasts, history, actions, do-not-disturb |
//! | cosmic-workspaces                       | [`sessions`]: game sessions and streams as workspaces |
//! | cosmic-settings pages                   | [`settings`]: page registry with typed controls |
//!
//! The theme half of COSMIC (cosmic-theme containers) lives with the M3 owner:
//! `libm3::containers`. Labels are Fluent message keys of `locales/*/shell.ftl`; icons are Material
//! Symbols names. See `docs/bun-os/REUSE-M3-COSMIC-ARTCRAFT.md`.

pub mod applets;
pub mod launcher;
pub mod notifications;
pub mod sessions;
pub mod settings;
