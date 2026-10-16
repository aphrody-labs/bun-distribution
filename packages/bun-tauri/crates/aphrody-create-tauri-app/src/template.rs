// Copyright 2019-2022 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use std::{collections::HashMap, fmt::Display, fs, io::Write, path, str::FromStr};

use anyhow::Context;
use rust_embed::Embed;

use crate::{
    args::TauriVersion,
    manifest::Manifest,
    package_manager::PackageManager,
    utils::{self, colors::*, lte},
};

const CTA_MANIFEST_FILENAME: &str = ".manifest";

#[derive(Embed)]
#[folder = "templates"]
#[allow(non_camel_case_types)]
struct EMBEDDED_TEMPLATES;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum Flavor {
    JavaScript,
    TypeScript,
}

impl Display for Flavor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Flavor::JavaScript => write!(f, "JavaScript"),
            Flavor::TypeScript => write!(f, "TypeScript"),
        }
    }
}

/// This fork keeps only the Bun-run vanilla JS/TS frontend and the pure-Rust/WASM frameworks
/// (yew, leptos, sycamore, dioxus); every npm-ecosystem framework template (Vue, Svelte, React,
/// Solid, Angular, Preact) and the .NET one (Blazor) are dropped (see docs/guides/workspace/VENDORING.md upstream).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
#[derive(Default)]
pub enum Template {
    #[default]
    Vanilla,
    VanillaTs,
    Yew,
    Leptos,
    Sycamore,
    Dioxus,
}

impl Display for Template {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Template::Vanilla => write!(f, "vanilla"),
            Template::VanillaTs => write!(f, "vanilla-ts"),
            Template::Yew => write!(f, "yew"),
            Template::Leptos => write!(f, "leptos"),
            Template::Sycamore => write!(f, "sycamore"),
            Template::Dioxus => write!(f, "dioxus"),
        }
    }
}

impl FromStr for Template {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "vanilla" => Ok(Template::Vanilla),
            "vanilla-ts" => Ok(Template::VanillaTs),
            "yew" => Ok(Template::Yew),
            "leptos" => Ok(Template::Leptos),
            "sycamore" => Ok(Template::Sycamore),
            "dioxus" => Ok(Template::Dioxus),
            _ => Err(format!(
                "{YELLOW}{s}{RESET} is not a valid template. Valid templates are [{}]",
                Template::ALL
                    .iter()
                    .map(|e| format!("{GREEN}{e}{RESET}"))
                    .collect::<Vec<_>>()
                    .join(", ")
            )),
        }
    }
}

impl Template {
    pub const fn select_text<'a>(&self) -> &'a str {
        match self {
            Template::Vanilla => "Vanilla",
            Template::Yew => "Yew - (https://yew.rs/)",
            Template::Leptos => "Leptos - (https://leptos.dev/)",
            Template::Sycamore => "Sycamore - (https://sycamore.dev/)",
            Template::Dioxus => "Dioxus - (https://dioxuslabs.com/)",
            _ => unreachable!(),
        }
    }
}

impl Template {
    pub const ALL: &[Template] = &[
        Template::Vanilla,
        Template::VanillaTs,
        Template::Yew,
        Template::Leptos,
        Template::Sycamore,
        Template::Dioxus,
    ];

    pub fn flavors<'b>(&self, pkg_manager: PackageManager) -> Option<&'b [Flavor]> {
        match self {
            Template::Vanilla => {
                if pkg_manager == PackageManager::Cargo {
                    None
                } else {
                    Some(&[Flavor::TypeScript, Flavor::JavaScript])
                }
            }
            _ => None,
        }
    }

    pub fn from_flavor(&self, flavor: Flavor) -> Self {
        match (self, flavor) {
            (Template::Vanilla, Flavor::TypeScript) => Template::VanillaTs,
            _ => *self,
        }
    }

    pub fn without_flavor(&self) -> Self {
        match self {
            Template::VanillaTs => Template::Vanilla,
            _ => *self,
        }
    }

    pub const fn possible_package_managers(&self) -> &[PackageManager] {
        match self {
            Template::Vanilla => &[PackageManager::Cargo, PackageManager::Bun],
            Template::VanillaTs => PackageManager::NODE,
            Template::Yew | Template::Leptos | Template::Sycamore | Template::Dioxus => {
                &[PackageManager::Cargo]
            }
        }
    }

    pub const fn needs_trunk(&self) -> bool {
        matches!(self, Template::Sycamore | Template::Yew | Template::Leptos)
    }

    pub const fn needs_tauri_cli(&self) -> bool {
        matches!(
            self,
            Template::Dioxus
                | Template::Sycamore
                | Template::Yew
                | Template::Leptos
                | Template::Vanilla
        )
    }

    pub const fn needs_dioxus_cli(&self) -> bool {
        matches!(self, Template::Dioxus)
    }

    pub const fn needs_wasm32_target(&self) -> bool {
        matches!(self, Template::Sycamore | Template::Yew | Template::Leptos)
    }

    pub fn render(
        &self,
        target_dir: &path::Path,
        pkg_manager: PackageManager,
        project_name: &str,
        package_name: &str,
        identifier: &str,
        tauri_version: TauriVersion,
    ) -> anyhow::Result<()> {
        let manifest_bytes =
            EMBEDDED_TEMPLATES::get(&format!("template-{self}/{CTA_MANIFEST_FILENAME}"))
                .with_context(|| "Failed to get manifest bytes")?
                .data
                .to_vec();
        let manifest_str = String::from_utf8(manifest_bytes)?;
        let manifest = Manifest::parse(&manifest_str)?;

        let lib_name = format!("{}_lib", package_name.replace('-', "_"));
        let project_name_pascal_case = utils::to_pascal_case(project_name);

        let versions = TauriVersion::all()
            .iter()
            .map(|&v| {
                (
                    format!("v{v}",),
                    match v == tauri_version {
                        true => "true",
                        false => "false",
                    },
                )
            })
            .collect::<Vec<_>>();

        let styles = String::from_utf8(
            EMBEDDED_TEMPLATES::get("_assets_/styles.css")
                .unwrap()
                .data
                .to_vec(),
        )?;

        let mut manifest_template_data: HashMap<&str, &str> = [
            ("pkg_manager_run_command", pkg_manager.run_cmd()),
            ("lib_name", &lib_name),
            ("package_name", package_name),
            ("project_name", project_name),
            ("identifier", identifier),
            ("project_name_pascal_case", &project_name_pascal_case),
        ]
        .into();

        for (version, enabled) in &versions {
            manifest_template_data.insert(version, enabled);
        }

        let mut template_data: HashMap<&str, String> = [
            ("project_name", project_name.to_string()),
            (
                "project_name_pascal_case",
                project_name_pascal_case.to_string(),
            ),
            ("package_name", package_name.to_string()),
            ("identifier", identifier.to_string()),
            (
                "before_dev_command",
                lte::render(
                    manifest.before_dev_command.unwrap_or_default(),
                    &manifest_template_data,
                )?,
            ),
            (
                "before_build_command",
                lte::render(
                    manifest.before_build_command.unwrap_or_default(),
                    &manifest_template_data,
                )?,
            ),
            (
                "dev_url",
                lte::render(
                    manifest.dev_url.unwrap_or_default(),
                    &manifest_template_data,
                )?,
            ),
            (
                "frontend_dist",
                lte::render(
                    manifest.frontend_dist.unwrap_or_default(),
                    &manifest_template_data,
                )?,
            ),
            (
                "with_global_tauri",
                manifest.with_global_tauri.unwrap_or_default().to_string(),
            ),
            ("lib_name", lib_name),
            ("styles", styles),
        ]
        .into();

        for (version, enabled) in &versions {
            template_data.insert(version.as_str(), enabled.to_string());
        }

        let version_flags = TauriVersion::all()
            .iter()
            .map(|&v| (v, format!("v{v}")))
            .collect::<Vec<_>>();

        let write_file = |file: &str, template_data| -> anyhow::Result<()> {
            // remove the first component, which is certainly the template directory they were in before getting embeded into the binary
            let p = path::PathBuf::from(file)
                .components()
                .skip(1)
                .collect::<Vec<_>>()
                .iter()
                .collect::<path::PathBuf>();

            let p = target_dir.join(p);
            let file_name = p.file_name().unwrap().to_string_lossy();

            let file_name = match &*file_name {
                "_gitignore" => ".gitignore",
                // skip manifest
                CTA_MANIFEST_FILENAME => return Ok(()),
                // conditional files:
                // are files that start with a special syntax
                //          "%(<list of flags separated by `-`>%)<file_name>"
                // flags are supported package managers, and `v-$versionNumber` (tauri version filter).
                // example: "%(pnpm-npm-yarn-stable-v1)%package.json"
                name if name.starts_with("%(") && name[1..].contains(")%") => {
                    let mut s = name.strip_prefix("%(").unwrap().split(")%");
                    let (mut flags, name) = (
                        s.next().unwrap().split('-').collect::<Vec<_>>(),
                        s.next().unwrap(),
                    );

                    let for_version = version_flags
                        .iter()
                        .find(|(_, flag)| flags.contains(&flag.as_str()))
                        .map(|(v, _)| *v);

                    // remove version flags to only keep package managers flags
                    flags.retain(|e| !version_flags.iter().any(|(_, flag)| e == flag));

                    // this file has a version flag and matches active version.
                    // if doesn't have any version flag, it should be rendered
                    if for_version.map(|v| v == tauri_version).unwrap_or(true)
                        // this file has a package manager flag and matches active package manager.
                        // if doesn't have any package manager flag, it should be rendered
                        && (flags.contains(&pkg_manager.to_string().as_str()) || flags.is_empty())
                    {
                        name
                    } else {
                        // skip writing this file
                        return Ok(());
                    }
                }
                name => name,
            };

            // Only modify files that need to use the template engine
            let (file_data, file_name) = if let Some(new_name) = file_name.strip_suffix(".lte") {
                let data = EMBEDDED_TEMPLATES::get(file).unwrap().data.to_vec();
                let data = lte::render(data, template_data)?.into_bytes();
                (data, new_name)
            } else {
                let data = EMBEDDED_TEMPLATES::get(file).unwrap().data.to_vec();
                (data, file_name)
            };

            let file_name = lte::render(file_name, template_data)?;

            let parent = p.parent().unwrap();
            fs::create_dir_all(parent)?;
            fs::write(parent.join(file_name), file_data)?;
            Ok(())
        };

        // 1. write base files
        for file in EMBEDDED_TEMPLATES::iter().filter(|e| {
            path::PathBuf::from(e.to_string())
                .components()
                .next()
                .unwrap()
                .as_os_str()
                == "_base_"
        }) {
            write_file(&file, &template_data)?;
        }

        // 2. write template files which can override files from base
        for file in EMBEDDED_TEMPLATES::iter().filter(|e| {
            path::PathBuf::from(e.to_string())
                .components()
                .next()
                .unwrap()
                .as_os_str()
                == path::PathBuf::from(format!("template-{self}"))
        }) {
            write_file(&file, &template_data)?;
        }

        // 3. write extra files specified in the template manifest
        for (src, dest) in manifest.files {
            let data = EMBEDDED_TEMPLATES::get(&format!("_assets_/{src}"))
                .with_context(|| format!("Failed to get asset file bytes: {src}"))?
                .data;
            let dest = target_dir.join(dest);
            let parent = dest.parent().unwrap();
            fs::create_dir_all(parent)?;
            let mut file = fs::OpenOptions::new()
                .append(true)
                .create(true)
                .open(dest)?;
            file.write_all(&data)?;
        }

        Ok(())
    }
}
