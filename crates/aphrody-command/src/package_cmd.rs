// SPDX-License-Identifier: Apache-2.0
//! `aphrody package`: a thin compatibility group over the single `aphrody` binary.
//!
//! Aphrody used to ship four separately cloned, built and installed command-line tools (`aphrody`,
//! `n2b`, `nie`). There is one binary now: `n2b` and every former
//! standalone name are links to it (multi-call dispatch, see `multicall.rs`). This group reports
//! and repairs those links; it never clones, builds or updates anything.

use std::{
    fs,
    path::{Path, PathBuf},
};

use clap::Subcommand;
use miette::IntoDiagnostic;
use serde::Serialize;

use crate::multicall;

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum PackageAction {
    /// Afficher le binaire unique, les noms de binaires qu'il remplace et les outils gérés ailleurs.
    Catalog {
        #[arg(long)]
        json: bool,
    },
    /// Afficher le binaire en cours et l'état de chaque lien (ok, absent, pendant, étranger).
    Status {
        /// Accepté pour compatibilité (aphrody, bxc, n2b, all) : la réponse est la même.
        package: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Vérifier le binaire, le répertoire des liens et PATH ; code 1 si un lien n'est pas sain.
    Doctor {
        #[arg(long)]
        json: bool,
    },
    /// Lier `aphrody` et chaque ancien nom de binaire au binaire en cours (= `aphrody self
    /// install-path`).
    Install {
        /// Accepté pour compatibilité (aphrody, bxc, n2b, all) : tous les liens sont créés.
        package: Option<String>,
        /// Binaire à lier ; par défaut, le binaire en cours.
        #[arg(long)]
        bin: Option<PathBuf>,
        #[arg(long)]
        dry_run: bool,
    },
    /// Retirer les liens créés par `install` (jamais le binaire lui-même).
    Uninstall {
        /// aphrody ou all : tous les liens ; bxc : bxc et bxc-mcp ; n2b : n2b.
        package: Option<String>,
        #[arg(long)]
        yes: bool,
        #[arg(long)]
        dry_run: bool,
    },
    /// Retiré : il n'y a plus rien à cloner, construire ou mettre à jour.
    #[command(hide = true)]
    Update {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
}

/// Names of the absorbed products: links to the single binary kept for compatibility.
const COMPAT_NAMES: &[&str] = &["n2b"];

/// Names `package` accepted before the unification; they all designate the single binary now.
const LEGACY_PACKAGES: &[&str] = &["aphrody", "n2b", "all"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum LinkState {
    /// Resolves to the running binary.
    Ok,
    /// Nothing at that path.
    Missing,
    /// A symbolic link whose target no longer exists.
    Dangling,
    /// Something else sits there: another binary, a script, a link to a different file.
    Foreign,
}

impl LinkState {
    const fn label(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Missing => "absent",
            Self::Dangling => "pendant",
            Self::Foreign => "étranger",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
struct LinkReport {
    name: String,
    /// `binary` (`aphrody`), `compat` (absorbed products) or `alias` (other former binaries).
    kind: &'static str,
    path: String,
    state: LinkState,
    /// Where a symbolic link points, when it is one.
    target: Option<String>,
}

pub(crate) fn run(action: PackageAction) -> miette::Result<()> {
    match action {
        PackageAction::Catalog { json } => catalog(json),
        PackageAction::Status { package, json } => {
            if let Some(package) = package {
                legacy_package(&package)?;
            }
            status(json)
        }
        PackageAction::Doctor { json } => doctor(json),
        PackageAction::Install {
            package,
            bin,
            dry_run,
        } => {
            if let Some(package) = package {
                legacy_package(&package)?;
            }
            install(bin, dry_run)
        }
        PackageAction::Uninstall {
            package,
            yes,
            dry_run,
        } => {
            let names = match package {
                Some(package) => legacy_package(&package)?,
                None => all_link_names(),
            };
            uninstall(&names, yes, dry_run)
        }
        PackageAction::Update { .. } => Err(miette::miette!(
            "`aphrody package update` est retiré : il n'y a qu'un binaire et plus de sources \
             gérées à tirer. Installer le nouveau binaire (fabrique : `bun \
             scripts/aphrody/build/rust/build-factory.ts run --install`), puis `aphrody package install` \
             pour re-pointer les liens."
        )),
    }
}

/// Link names designated by a legacy package argument.
fn legacy_package(name: &str) -> miette::Result<Vec<String>> {
    match name {
        "aphrody" | "all" => Ok(all_link_names()),
        "n2b" => Ok(vec!["n2b".to_owned()]),
        other => Err(miette::miette!(
            "paquet inconnu `{other}` : il n'y a qu'un binaire (`{}`)",
            LEGACY_PACKAGES.join("`, `")
        )),
    }
}

/// `aphrody` first, then every former binary name.
fn all_link_names() -> Vec<String> {
    std::iter::once("aphrody")
        .chain(multicall::aliases())
        .map(str::to_owned)
        .collect()
}

fn link_kind(name: &str) -> &'static str {
    if name == "aphrody" {
        "binary"
    } else if COMPAT_NAMES.contains(&name) {
        "compat"
    } else {
        "alias"
    }
}

fn exe(name: &str) -> String {
    format!("{name}{}", std::env::consts::EXE_SUFFIX)
}

/// The running binary, with symbolic links resolved.
fn running_binary() -> miette::Result<PathBuf> {
    let current = std::env::current_exe().into_diagnostic()?;
    Ok(fs::canonicalize(&current).unwrap_or(current))
}

fn link_dir(binary: &Path) -> miette::Result<PathBuf> {
    crate::self_cmd::alias_dir(binary)
}

/// Whether both paths name the same file (same canonical path, same inode, or on platforms
/// without inodes the same length and modification time).
fn same_file(a: &Path, b: &Path) -> bool {
    if let (Ok(a), Ok(b)) = (fs::canonicalize(a), fs::canonicalize(b))
        && a == b
    {
        return true;
    }
    let (Ok(a), Ok(b)) = (fs::metadata(a), fs::metadata(b)) else {
        return false;
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        a.dev() == b.dev() && a.ino() == b.ino()
    }
    #[cfg(not(unix))]
    {
        a.len() == b.len() && a.modified().ok() == b.modified().ok()
    }
}

fn is_aphrody_name(path: &Path) -> bool {
    path.file_stem().and_then(std::ffi::OsStr::to_str) == Some("aphrody")
}

/// Classify the link `path` against the running `binary`.
fn inspect(path: &Path, binary: &Path) -> (LinkState, Option<PathBuf>) {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return (LinkState::Missing, None);
    };
    if meta.file_type().is_symlink() {
        let target = fs::read_link(path).ok();
        let state = if !path.exists() {
            LinkState::Dangling
        } else if same_file(path, binary) {
            LinkState::Ok
        } else {
            LinkState::Foreign
        };
        return (state, target);
    }
    (
        if same_file(path, binary) {
            LinkState::Ok
        } else {
            LinkState::Foreign
        },
        None,
    )
}

fn collect_links(link_dir: &Path, binary: &Path, names: &[String]) -> Vec<LinkReport> {
    names
        .iter()
        .map(|name| {
            let path = link_dir.join(exe(name));
            let (state, target) = inspect(&path, binary);
            LinkReport {
                name: name.clone(),
                kind: link_kind(name),
                path: path.display().to_string(),
                state,
                target: target.map(|target| target.display().to_string()),
            }
        })
        .collect()
}

fn on_path(dir: &Path) -> bool {
    let wanted = fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
    std::env::var_os("PATH").is_some_and(|raw| {
        std::env::split_paths(&raw).any(|entry| fs::canonicalize(&entry).unwrap_or(entry) == wanted)
    })
}

fn print_json(value: &serde_json::Value) -> miette::Result<()> {
    println!("{}", serde_json::to_string_pretty(value).into_diagnostic()?);
    Ok(())
}

fn catalog(json: bool) -> miette::Result<()> {
    let names = all_link_names();
    if json {
        let rows: Vec<_> = names
            .iter()
            .map(|name| serde_json::json!({ "name": name, "kind": link_kind(name) }))
            .collect();
        return print_json(&serde_json::json!({
            "binary": "aphrody",
            "version": env!("CARGO_PKG_VERSION"),
            "links": rows,
        }));
    }
    println!("aphrody {}  binaire unique", env!("CARGO_PKG_VERSION"));
    for name in &names[1..] {
        let kind = match link_kind(name) {
            "compat" => "compatibilité (produit absorbé)",
            _ => "ancien binaire",
        };
        println!("  {name:<26} {kind}");
    }
    Ok(())
}

struct Inventory {
    binary: PathBuf,
    link_dir: PathBuf,
    links: Vec<LinkReport>,
    on_path: bool,
}

impl Inventory {
    fn collect() -> miette::Result<Self> {
        let binary = running_binary()?;
        let link_dir = link_dir(&binary)?;
        let links = collect_links(&link_dir, &binary, &all_link_names());
        Ok(Self {
            on_path: on_path(&link_dir),
            binary,
            link_dir,
            links,
        })
    }

    fn healthy(&self) -> bool {
        self.links.iter().all(|link| link.state == LinkState::Ok)
    }
}

fn status(json: bool) -> miette::Result<()> {
    let report = Inventory::collect()?;
    if json {
        return print_json(&serde_json::json!({
            "binary": {
                "path": report.binary.display().to_string(),
                "version": env!("CARGO_PKG_VERSION"),
                "target": env!("APHRODY_TARGET"),
            },
            "link_dir": report.link_dir.display().to_string(),
            "on_path": report.on_path,
            "healthy": report.healthy(),
            "links": report.links,
        }));
    }
    println!(
        "aphrody {}  {}",
        env!("CARGO_PKG_VERSION"),
        report.binary.display()
    );
    for link in &report.links {
        println!(
            "  {:<26} {:<9} {}",
            link.name,
            link.state.label(),
            link.path
        );
    }
    Ok(())
}

fn doctor(json: bool) -> miette::Result<()> {
    let report = Inventory::collect()?;
    let broken: Vec<&LinkReport> = report
        .links
        .iter()
        .filter(|link| link.state != LinkState::Ok)
        .collect();
    let legacy_state = dirs::home_dir()
        .map(|home| home.join(".bxc"))
        .filter(|path| path.exists());
    if json {
        print_json(&serde_json::json!({
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "binary": report.binary.display().to_string(),
            "link_dir": report.link_dir.display().to_string(),
            "link_dir_exists": report.link_dir.is_dir(),
            "on_path": report.on_path,
            "links_ok": report.links.len() - broken.len(),
            "links_total": report.links.len(),
            "healthy": report.healthy(),
            "broken": broken,
            "legacy_state": legacy_state.as_ref().map(|path| path.display().to_string()),
        }))?;
    } else {
        println!(
            "plateforme : {}/{}",
            std::env::consts::OS,
            std::env::consts::ARCH
        );
        println!("binaire    : {}", report.binary.display());
        println!(
            "liens      : {} ({}), {}/{} sains",
            report.link_dir.display(),
            if report.on_path {
                "dans PATH"
            } else {
                "hors PATH"
            },
            report.links.len() - broken.len(),
            report.links.len()
        );
        for link in &broken {
            println!(
                "  {:<26} {:<9} {}",
                link.name,
                link.state.label(),
                link.path
            );
        }
        if let Some(path) = &legacy_state {
            println!(
                "état hérité: {} (lu en repli pour les cookies, jamais écrit)",
                path.display()
            );
        }
    }
    if report.healthy() {
        Ok(())
    } else {
        Err(miette::miette!(
            "{} lien(s) non sain(s) : `aphrody package install` les recrée (`--dry-run` d'abord)",
            broken.len()
        ))
    }
}

fn install(bin: Option<PathBuf>, dry_run: bool) -> miette::Result<()> {
    let bin = match bin {
        Some(bin) => bin,
        None => running_binary()?,
    };
    crate::self_cmd::InstallPathCommand {
        bin: Some(bin),
        build_if_missing: false,
        dry_run,
    }
    .run()
}

/// Remove the links in `names` that are ours: pointing at the running binary, or dangling after
/// the removal of an `aphrody` build. A link that points elsewhere is reported and left alone.
fn remove_links(
    link_dir: &Path,
    binary: &Path,
    names: &[String],
    dry_run: bool,
) -> miette::Result<usize> {
    let mut removed = 0;
    for link in collect_links(link_dir, binary, names) {
        let path = PathBuf::from(&link.path);
        let ours = match link.state {
            LinkState::Ok => true,
            LinkState::Dangling => link
                .target
                .as_deref()
                .is_some_and(|t| is_aphrody_name(Path::new(t))),
            LinkState::Missing => {
                println!("absent: {}", link.path);
                continue;
            }
            LinkState::Foreign => false,
        };
        if !ours {
            println!("étranger, non retiré: {}", link.path);
            continue;
        }
        if dry_run {
            println!("[dry-run] retirer {}", link.path);
        } else {
            fs::remove_file(&path).into_diagnostic()?;
            println!("retiré: {}", link.path);
        }
        removed += 1;
    }
    Ok(removed)
}

fn uninstall(names: &[String], yes: bool, dry_run: bool) -> miette::Result<()> {
    if !dry_run && !yes {
        return Err(miette::miette!(
            "désinstallation refusée: ajouter --yes (ou utiliser --dry-run)"
        ));
    }
    let binary = running_binary()?;
    let link_dir = link_dir(&binary)?;
    let removed = remove_links(&link_dir, &binary, names, dry_run)?;
    println!(
        "{removed} lien(s) {}; le binaire {} reste en place",
        if dry_run { "à retirer" } else { "retiré(s)" },
        binary.display()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn the_catalog_is_one_binary_and_its_former_names() {
        let all = all_link_names();
        assert_eq!(all[0], "aphrody");
        for compat in COMPAT_NAMES {
            assert!(
                all.iter().any(|name| name == compat),
                "{compat} must be a link"
            );
            assert_eq!(link_kind(compat), "compat");
        }
        assert_eq!(link_kind("aphrody"), "binary");
        assert_eq!(link_kind("aphrody-infra"), "alias");
        let mut sorted = all.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), all.len(), "every link name is unique");
    }

    #[test]
    fn legacy_package_arguments_designate_links_never_builds() {
        assert_eq!(legacy_package("all").unwrap(), all_link_names());
        assert_eq!(legacy_package("aphrody").unwrap(), all_link_names());
        assert_eq!(legacy_package("n2b").unwrap(), names(&["n2b"]));
        assert!(
            legacy_package("bogus")
                .unwrap_err()
                .to_string()
                .contains("paquet inconnu")
        );
    }

    #[test]
    fn update_is_retired_with_the_replacement() {
        let error = run(PackageAction::Update {
            args: vec!["all".to_owned()],
        })
        .unwrap_err()
        .to_string();
        assert!(error.contains("retiré"), "{error}");
        assert!(error.contains("aphrody package install"), "{error}");
    }

    #[test]
    fn uninstall_needs_yes_unless_it_is_a_dry_run() {
        let error = uninstall(&names(&["n2b"]), false, false)
            .unwrap_err()
            .to_string();
        assert!(error.contains("--yes"), "{error}");
    }

    #[cfg(unix)]
    mod links {
        use std::os::unix::fs::symlink;

        use super::*;

        struct Fixture {
            _dir: tempfile::TempDir,
            bin_dir: PathBuf,
            binary: PathBuf,
        }

        fn fixture() -> Fixture {
            let dir = tempfile::tempdir().unwrap();
            let bin_dir = dir.path().join("bin");
            fs::create_dir_all(&bin_dir).unwrap();
            let binary = dir.path().join("installed").join("aphrody");
            fs::create_dir_all(binary.parent().unwrap()).unwrap();
            fs::write(&binary, b"binary").unwrap();
            Fixture {
                _dir: dir,
                bin_dir,
                binary,
            }
        }

        #[test]
        fn a_link_is_ok_missing_dangling_or_foreign() {
            let f = fixture();
            symlink(&f.binary, f.bin_dir.join("aphrody")).unwrap();
            symlink(f.bin_dir.join("gone/aphrody"), f.bin_dir.join("n2b")).unwrap();
            let wrapper = f.bin_dir.join("legacy-wrapper");
            fs::write(&wrapper, b"#!/bin/sh\n").unwrap();
            symlink(&wrapper, f.bin_dir.join("bxc")).unwrap();

            let reports = collect_links(
                &f.bin_dir,
                &f.binary,
                &names(&["aphrody", "n2b", "bxc", "bxc-mcp"]),
            );
            let states: Vec<_> = reports.iter().map(|report| report.state).collect();
            assert_eq!(
                states,
                [
                    LinkState::Ok,
                    LinkState::Dangling,
                    LinkState::Foreign,
                    LinkState::Missing
                ]
            );
            assert!(
                reports[1]
                    .target
                    .as_deref()
                    .unwrap()
                    .ends_with("gone/aphrody")
            );
        }

        #[test]
        fn a_hard_link_to_the_binary_is_ok() {
            let f = fixture();
            fs::hard_link(&f.binary, f.bin_dir.join("aphrody")).unwrap();
            let reports = collect_links(&f.bin_dir, &f.binary, &names(&["aphrody"]));
            assert_eq!(reports[0].state, LinkState::Ok);
        }

        #[test]
        fn uninstall_removes_ours_and_keeps_foreign_files() {
            let f = fixture();
            symlink(&f.binary, f.bin_dir.join("bxc")).unwrap();
            symlink(f.bin_dir.join("old/aphrody"), f.bin_dir.join("n2b")).unwrap();
            let wrapper = f.bin_dir.join("legacy-wrapper");
            fs::write(&wrapper, b"#!/bin/sh\n").unwrap();
            symlink(&wrapper, f.bin_dir.join("bxc-mcp")).unwrap();

            let wanted = names(&["bxc", "bxc-mcp", "n2b"]);
            assert_eq!(
                remove_links(&f.bin_dir, &f.binary, &wanted, true).unwrap(),
                2
            );
            assert!(
                f.bin_dir.join("bxc").symlink_metadata().is_ok(),
                "a dry run removes nothing"
            );

            assert_eq!(
                remove_links(&f.bin_dir, &f.binary, &wanted, false).unwrap(),
                2
            );
            assert!(f.bin_dir.join("bxc").symlink_metadata().is_err());
            assert!(f.bin_dir.join("n2b").symlink_metadata().is_err());
            assert!(
                f.bin_dir.join("bxc-mcp").symlink_metadata().is_ok(),
                "a link to another file is never ours to remove"
            );
            assert!(f.binary.is_file(), "the binary itself is never removed");
        }

        #[test]
        fn a_dangling_link_to_a_foreign_target_is_not_ours() {
            let f = fixture();
            symlink("/nonexistent/bxc-source/bin/bxc", f.bin_dir.join("bxc")).unwrap();
            assert_eq!(
                remove_links(&f.bin_dir, &f.binary, &names(&["bxc"]), false).unwrap(),
                0
            );
            assert!(f.bin_dir.join("bxc").symlink_metadata().is_ok());
        }
    }
}
