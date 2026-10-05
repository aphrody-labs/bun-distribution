// Copyright 2019-2022 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use std::{fmt::Display, str::FromStr};

use crate::{template::Template, utils::colors::*};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
#[derive(Default)]
pub enum PackageManager {
    #[default]
    Cargo,
    Bun,
}

impl Display for PackageManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PackageManager::Cargo => write!(f, "cargo"),
            PackageManager::Bun => write!(f, "bun"),
        }
    }
}

impl FromStr for PackageManager {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "cargo" => Ok(PackageManager::Cargo),
            "bun" => Ok(PackageManager::Bun),
            _ => Err(format!(
                "{YELLOW}{s}{RESET} is not a valid package manager. Valid package mangers are [{}]",
                PackageManager::ALL
                    .iter()
                    .map(|e| format!("{GREEN}{e}{RESET}"))
                    .collect::<Vec<_>>()
                    .join(", ")
            )),
        }
    }
}

impl<'a> PackageManager {
    pub const ALL: &'a [PackageManager] = &[PackageManager::Cargo, PackageManager::Bun];

    /// Node.js-compatible managers (Bun resolves and runs `package.json` the same way).
    pub const NODE: &'a [PackageManager] = &[PackageManager::Bun];
}
impl PackageManager {
    /// Returns templates without flavors
    pub const fn templates_no_flavors(&self) -> &[Template] {
        match self {
            PackageManager::Cargo => &[
                Template::Vanilla,
                Template::Yew,
                Template::Leptos,
                Template::Sycamore,
                Template::Dioxus,
            ],
            PackageManager::Bun => &[Template::Vanilla],
        }
    }

    pub const fn templates(&self) -> &[Template] {
        match self {
            PackageManager::Cargo => &[
                Template::Vanilla,
                Template::Yew,
                Template::Leptos,
                Template::Sycamore,
                Template::Dioxus,
            ],
            PackageManager::Bun => &[Template::Vanilla, Template::VanillaTs],
        }
    }

    pub const fn install_cmd(&self) -> Option<&str> {
        match self {
            PackageManager::Bun => Some("bun install"),
            PackageManager::Cargo => None,
        }
    }

    pub const fn run_cmd(&self) -> &str {
        match self {
            PackageManager::Cargo => "cargo",
            PackageManager::Bun => "bun run",
        }
    }

    pub const fn is_node(&self) -> bool {
        matches!(self, PackageManager::Bun)
    }
}
