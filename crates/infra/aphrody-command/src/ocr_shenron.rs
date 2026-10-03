// SPDX-License-Identifier: Apache-2.0
//! `aphrody ocr shenron …` — native bridge to the sibling `shenron` checkout.
//!
//! `shenron` already expects exactly this shape: `depose-transcriptions.ts`
//! (`~/aphrody/apps/shenron/site/scripts/depose-transcriptions.ts`) opens with "Entrée
//! : le JSONL qu'écrit `aphrody ocr batch`" and reads `<databookId>-<page>.ext`
//! file names. The two repos were designed to meet here; this module is what
//! actually walks aphrody across that meeting point instead of leaving it as a
//! shape two humans have to remember to match.
//!
//! # Division of authority
//!
//! aphrody owns the read: two local OCR engines, a measured contract for what
//! counts as text (`aphrody-ocr-core::result`), a corpus database. `shenron`
//! owns the write: it is `shenron/plugins/dragon-ball/skills/databooks-ocr`
//! that says it plainly — "Shenron reste l'unique validateur et écrivain du
//! corpus" — and its own `databooks.ts verifie`/`depose` run `classerDefaut`,
//! a second, independent judge, before anything reaches the API. This module
//! shells into that judge rather than reimplementing it: two different
//! quality gates written by two different sessions are worth more than one
//! gate trusted twice.
//!
//! # Platform gating
//!
//! Native-only: it locates a sibling checkout and spawns `bun`.

use std::path::{Path, PathBuf};

use aphrody_ocr::ocr_core::{OcrStatus, store::OcrStore};

use crate::ocr_dbfr::plate_number;

/// Actions for `aphrody ocr shenron`.
#[derive(clap::Subcommand, Debug, Clone)]
pub(crate) enum ShenronAction {
    /// Report whether the sibling `shenron` checkout and its databooks
    /// tooling were found.
    ///
    /// Example: aphrody ocr shenron doctor
    Doctor,
    /// Write one databook's stored transcriptions as a `shenron`-shaped
    /// `resultats.jsonl`, without depositing anything.
    ///
    /// The file names inside it — `<databookId>-<page>.jpg` — are exactly what
    /// `shenron`'s own `depose-transcriptions.ts` parses; nothing downstream
    /// needs to know these files never existed on disk.
    ///
    /// Example: aphrody ocr shenron emit 312 --out var/shenron-bridge/312
    Emit {
        /// Databook identifier.
        id: u64,
        /// Directory to write `resultats.jsonl` into. Created if needed.
        #[arg(long)]
        out: PathBuf,
        /// Corpus database. Defaults to `<state>/ocr/results.db`.
        #[arg(long)]
        db: Option<PathBuf>,
    },
    /// Run `shenron`'s own quality judge over an emitted lot.
    ///
    /// This is the second gate: aphrody's `content_score`/`is_page_furniture`
    /// already refused what it could tell was wrong, but `shenron`'s
    /// `classerDefaut` was tuned against the corpus's own history and catches
    /// what aphrody's rules do not know to look for.
    ///
    /// Example: aphrody ocr shenron verify var/shenron-bridge/312
    Verify {
        /// Lot directory written by `emit`, or its `resultats.jsonl` directly.
        lot: PathBuf,
    },
    /// Emit, then hand the lot to `shenron`'s own depositor.
    ///
    /// `shenron depose` refuses a lot carrying a defect unless `--force` is
    /// passed, and resolves its own API token from `apps/shenron/site/.env` — no
    /// secret crosses from aphrody into this command.
    ///
    /// Example: aphrody ocr shenron deposit 312 --apply
    Deposit {
        /// Databook identifier.
        id: u64,
        /// Send the deposit. Without it `shenron depose --simulation` runs:
        /// the quality judge and the API payload are computed, nothing is
        /// written.
        #[arg(long)]
        apply: bool,
        /// Deposit despite a quality-judge defect. `shenron`'s own escape
        /// hatch, forwarded as-is — aphrody adds no separate override.
        #[arg(long)]
        force: bool,
        /// Directory to stage the bridge lot in. Defaults to
        /// `<root>/apps/shenron/site/var/aphrody-bridge/<id>` inside the monorepo
        /// checkout, so `shenron`'s own tooling can find it without a path
        /// argument crossing back into aphrody's tree.
        #[arg(long)]
        out: Option<PathBuf>,
        /// Corpus database. Defaults to `<state>/ocr/results.db`.
        #[arg(long)]
        db: Option<PathBuf>,
    },
    /// Deposit every databook the local corpus holds readable text for.
    ///
    /// No confirmation, no dry-run gate of its own: the safety rail is
    /// `shenron`'s own judge on every lot, run once per databook. A databook
    /// whose lot fails that judge is reported and skipped, not force-deposited
    /// — `--force` stays a per-databook, explicit choice.
    ///
    /// Example: aphrody ocr shenron pipeline --apply
    Pipeline {
        /// Send every deposit. Without it, every lot runs as a simulation.
        #[arg(long)]
        apply: bool,
        /// Corpus database. Defaults to `<state>/ocr/results.db`.
        #[arg(long)]
        db: Option<PathBuf>,
    },
}

/// Locate the Shenron source root.
///
/// `$SHENRON_ROOT` wins when set. Otherwise search current-directory ancestors
/// for the integrated monorepo layout, then for a legacy sibling checkout.
///
/// # Errors
///
/// A `miette` report naming the environment variable and supported layouts
/// when neither resolves to a real source tree.
pub(crate) fn locate() -> miette::Result<PathBuf> {
    if let Ok(explicit) = std::env::var("SHENRON_ROOT") {
        let path = PathBuf::from(explicit.trim());
        if scripts_dir(&path).is_dir() {
            return Ok(path);
        }
        return Err(miette::miette!(
            "$SHENRON_ROOT is set to {} but it has no Shenron databooks script",
            path.display()
        ));
    }
    let dir = std::env::current_dir()
        .map_err(|e| miette::miette!("locate the current directory: {e}"))?;
    for ancestor in dir.ancestors() {
        if scripts_dir(ancestor).is_dir() {
            return Ok(ancestor.to_path_buf());
        }
        // Preserve compatibility with the pre-monorepo sibling checkout.
        let candidate = ancestor.join("shenron");
        if scripts_dir(&candidate).is_dir() {
            return Ok(candidate);
        }
    }
    Err(miette::miette!(
        "no Shenron source found: set $SHENRON_ROOT or run from within the Aphrody monorepo"
    ))
}

/// The directory containing Shenron's site app.
fn site_dir(shenron_root: &Path) -> PathBuf {
    let integrated = shenron_root.join("apps").join("shenron").join("site");
    if integrated.is_dir() { integrated } else { shenron_root.join("apps").join("site") }
}

/// The directory Shenron's databooks scripts live in.
fn scripts_dir(shenron_root: &Path) -> PathBuf {
    site_dir(shenron_root).join("scripts")
}

/// Make `path` absolute without requiring it to exist.
///
/// Every path this module hands to `bun` is a bridge artifact aphrody wrote,
/// and `run_bun` spawns the child with its own working directory
/// (`<shenron>/apps/shenron/site`, or the legacy `<shenron>/apps/site`) — a
/// relative path built against Aphrody's cwd would
/// silently resolve against the wrong tree once it crosses that boundary.
fn absolute(path: &Path) -> miette::Result<PathBuf> {
    std::path::absolute(path).map_err(|e| miette::miette!("resolve {}: {e}", path.display()))
}

/// Run `bun <script> …args` inside Shenron's site app, streaming output.
///
/// # Errors
///
/// A `miette` report when `bun` cannot be spawned, or exits non-zero.
fn run_bun(shenron_root: &Path, script: &str, args: &[&str]) -> miette::Result<()> {
    let site_dir = site_dir(shenron_root);
    let script_path = scripts_dir(shenron_root).join(script);
    let status = aphrody_toolchains::Toolchain::Bun
        .command_in(&site_dir, [script_path.as_os_str()])
        .args(args)
        .status()
        .map_err(|e| miette::miette!("spawn bun {}: {e}", script_path.display()))?;
    if !status.success() {
        return Err(miette::miette!("bun {} exited with {status}", script_path.display()));
    }
    Ok(())
}

/// Run an `ocr shenron` action.
pub(crate) fn run(action: ShenronAction) -> miette::Result<()> {
    match action {
        ShenronAction::Doctor => doctor(),
        ShenronAction::Emit { id, out, db } => {
            let store = open_store(db.as_deref())?;
            let report = emit(&store, id, &out)?;
            println!(
                "wrote {} plate(s) to {} ({} skipped: {})",
                report.written,
                out.join("resultats.jsonl").display(),
                report.skipped_number + report.skipped_empty,
                skip_reasons(&report)
            );
            Ok(())
        },
        ShenronAction::Verify { lot } => {
            let shenron_root = locate()?;
            let target = if lot.is_dir() { lot.join("resultats.jsonl") } else { lot };
            let target = absolute(&target)?;
            run_bun(&shenron_root, "databooks.ts", &["verifie", &target.to_string_lossy()])
        },
        ShenronAction::Deposit { id, apply, force, out, db } => {
            let shenron_root = locate()?;
            let store = open_store(db.as_deref())?;
            let staging = match out {
                Some(path) => absolute(&path)?,
                None => shenron_root
                    .join("apps")
                    .join("site")
                    .join("var")
                    .join("aphrody-bridge")
                    .join(id.to_string()),
            };
            let report = emit(&store, id, &staging)?;
            if report.written == 0 {
                println!(
                    "nothing to deposit for databook {id}: 0 plate(s) stored as readable text ({} \
                     held back: {})",
                    report.skipped_number + report.skipped_empty,
                    skip_reasons(&report)
                );
                return Ok(());
            }
            let mut args = vec!["depose".to_owned(), staging.to_string_lossy().into_owned()];
            if !apply {
                args.push("--simulation".to_owned());
            }
            if force {
                args.push("--force".to_owned());
            }
            let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
            run_bun(&shenron_root, "databooks.ts", &args_ref)
        },
        ShenronAction::Pipeline { apply, db } => pipeline(apply, db.as_deref()),
    }
}

fn doctor() -> miette::Result<()> {
    match locate() {
        Ok(root) => {
            println!("shenron checkout: {}", root.display());
            let has_bun = aphrody_toolchains::Toolchain::Bun
                .command(["--version"])
                .output()
                .is_ok_and(|output| output.status.success());
            println!("bun on PATH: {}", if has_bun { "yes" } else { "no" });
            let depositor = scripts_dir(&root).join("depose-transcriptions.ts");
            println!(
                "depose-transcriptions.ts: {}",
                if depositor.is_file() { "found" } else { "MISSING" }
            );
            if !has_bun {
                return Err(miette::miette!(
                    "bun is not on PATH — install it, `aphrody ocr shenron` needs it to run \
                     shenron's own scripts"
                ));
            }
            Ok(())
        },
        Err(e) => Err(e),
    }
}

/// Open the corpus, creating it on first use.
fn open_store(db: Option<&Path>) -> miette::Result<OcrStore> {
    let path = match db {
        Some(path) => path.to_path_buf(),
        None => aphrody_models::paths::ocr_dir()
            .map_err(|e| miette::miette!("locate the aphrody state directory: {e}"))?
            .join("results.db"),
    };
    OcrStore::open(&path).map_err(|e| miette::miette!("open {}: {e}", path.display()))
}

/// What `emit` did for one databook.
///
/// Every page it looks at is already `Text`-status — `emit` queries the store
/// pre-filtered — so the only ways a page fails to become a line are the two
/// counted here.
struct EmitReport {
    written: usize,
    skipped_number: usize,
    skipped_empty: usize,
}

fn skip_reasons(report: &EmitReport) -> String {
    format!("{} without a plate number, {} empty", report.skipped_number, report.skipped_empty)
}

/// Whether `path` belongs to databook `id`'s lot, under any of the roots this
/// pipeline writes into (`ocr-lots`, `ocr-lots-mute`, `ocr-lots-oversized`,
/// …). The id must be a whole path component, not a substring: databook `3`
/// must not match a path that merely contains `312`.
fn lot_id_matches(path: &Path, id: &str) -> bool {
    path.components().any(|component| component.as_os_str() == id)
}

/// Write `<out>/resultats.jsonl` in `shenron`'s exact legacy contract:
/// `{"image":"<databookId>-<page>.jpg","text":{"kind":"text","markdown":"…"}}`.
///
/// Only pages stored as [`OcrStatus::Text`] are written — the same rule
/// `aphrody ocr dbfr push` applies, restated here because this path never
/// touches the public API and so never gets that check for free.
fn emit(store: &OcrStore, id: u64, out: &Path) -> miette::Result<EmitReport> {
    use aphrody_ocr::ocr_core::store::ListFilter;

    std::fs::create_dir_all(out).map_err(|e| miette::miette!("create {}: {e}", out.display()))?;
    let id_str = id.to_string();
    let pages = store
        .list(&ListFilter::default().status(OcrStatus::Text))
        .map_err(|e| miette::miette!("read corpus: {e}"))?;

    let mut report = EmitReport { written: 0, skipped_number: 0, skipped_empty: 0 };
    let mut lines = Vec::new();
    let mut matched = 0_usize;
    for page in &pages {
        // Matches any lot root this pipeline writes into — `ocr-lots`,
        // `ocr-lots-mute` (the PP-OCR pass), `ocr-lots-oversized` — as long as
        // the databook id is one whole path component, not a substring: id 3
        // must not match a path that merely contains "312".
        if !lot_id_matches(&page.path, &id_str) {
            continue;
        }
        matched += 1;
        let Some(number) = plate_number(&page.path) else {
            report.skipped_number += 1;
            continue;
        };
        let record = store
            .record(&page.page_id, None)
            .map_err(|e| miette::miette!("{e}"))?
            .or(store.record(&page.page_id, Some("")).map_err(|e| miette::miette!("{e}"))?);
        let text = record.as_ref().and_then(|record| {
            record.markdown.clone().or_else(|| {
                let joined = record
                    .blocks
                    .iter()
                    .map(|block| block.text.as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                (!joined.trim().is_empty()).then_some(joined)
            })
        });
        match text {
            Some(text) if !text.trim().is_empty() => {
                let line = serde_json::json!({
                    "image": format!("{id}-{number}.jpg"),
                    "text": { "kind": "text", "markdown": text },
                });
                lines.push(line.to_string());
                report.written += 1;
            },
            _ => report.skipped_empty += 1,
        }
    }
    debug_assert_eq!(matched, report.written + report.skipped_number + report.skipped_empty);

    std::fs::write(out.join("resultats.jsonl"), lines.join("\n") + "\n")
        .map_err(|e| miette::miette!("write {}: {e}", out.join("resultats.jsonl").display()))?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_lot_id_must_be_a_whole_component() {
        assert!(lot_id_matches(Path::new("var/ocr-lots/312/0003.jpg"), "312"));
        assert!(lot_id_matches(Path::new("var/ocr-lots-mute/312/0003.jpg"), "312"));
        // `3` must not match a path that merely contains "312" as a substring
        // of a different component.
        assert!(!lot_id_matches(Path::new("var/ocr-lots/312/0003.jpg"), "3"));
        assert!(!lot_id_matches(Path::new("var/ocr-lots/29/0003.jpg"), "312"));
    }

    #[test]
    fn absolute_leaves_an_already_absolute_path_alone() {
        let input = if cfg!(windows) { "C:\\a\\b" } else { "/a/b" };
        let resolved = absolute(Path::new(input)).unwrap();
        assert!(resolved.is_absolute());
    }
}

/// Deposit every databook the corpus holds readable text for.
fn pipeline(apply: bool, db: Option<&Path>) -> miette::Result<()> {
    let shenron_root = locate()?;
    let store = open_store(db)?;
    let pages = store
        .list(&aphrody_ocr::ocr_core::store::ListFilter::default().status(OcrStatus::Text))
        .map_err(|e| miette::miette!("read corpus: {e}"))?;

    // The databook id is the path component right after the lot root, on
    // whichever root produced the read (`ocr-lots` for the VLM pass,
    // `ocr-lots-mute` for the PP-OCR pass over what came back empty,
    // `ocr-lots-oversized` for a lot the size gate routed around the VLM).
    let lot_roots = ["ocr-lots", "ocr-lots-mute", "ocr-lots-oversized"];
    let mut ids: Vec<u64> = pages
        .iter()
        .filter_map(|page| {
            let mut components = page.path.components().map(|c| c.as_os_str().to_string_lossy());
            while let Some(part) = components.next() {
                if lot_roots.contains(&part.as_ref()) {
                    return components.next()?.parse().ok();
                }
            }
            None
        })
        .collect();
    ids.sort_unstable();
    ids.dedup();

    if ids.is_empty() {
        println!("nothing to deposit: the corpus holds no page stored as readable text");
        return Ok(());
    }

    println!("{} databook(s) with stored text to deposit", ids.len());
    let mut deposited = 0_usize;
    let mut failed = Vec::new();
    for id in ids {
        let staging = shenron_root
            .join("apps")
            .join("site")
            .join("var")
            .join("aphrody-bridge")
            .join(id.to_string());
        let report = emit(&store, id, &staging)?;
        if report.written == 0 {
            continue;
        }
        println!("--- databook {id}: {} plate(s) ---", report.written);
        let mut args = vec!["depose".to_owned(), staging.to_string_lossy().into_owned()];
        if !apply {
            args.push("--simulation".to_owned());
        }
        let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
        match run_bun(&shenron_root, "databooks.ts", &args_ref) {
            Ok(()) => deposited += report.written,
            Err(e) => {
                eprintln!("  {e}");
                failed.push(id);
            },
        }
    }

    println!("\n{deposited} plate(s) processed across databooks");
    if !failed.is_empty() {
        println!("refused by shenron's own judge (relis-les, ou --force par ouvrage): {failed:?}");
    }
    Ok(())
}
