// SPDX-License-Identifier: Apache-2.0
//! `bunre vfs`: the canonical VFS manifest of an install (feature `assets`). The same
//! `aphrody_nie_formats::vfs_manifest` code runs on the server (local disk) and on a client
//! (a network share such as the SMB drive of the games disk), so equal digests mean equal views.
//! Only pack TOCs are read, with positioned reads; nothing is written unless `--out` is given.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::ExitCode,
    time::Instant,
};

use aphrody_nie_formats::{
    game_source::local_data_dir,
    vfs::Vfs,
    vfs_manifest::{self, Difference, Manifest},
};
use serde_json::json;

const USAGE: &str = "\
Usage: bunre vfs <command> <ievr|dbxv2> <install-root> ...
  manifest <game> <root> [--out <file.ndjson>]   view digest + counts (JSON); --out writes the NDJSON
  verify   <game> <root> --against <file.ndjson> compare with a server manifest; exit 1 on any difference
  hash     <game> <root> <path> [--pack <name>]  sha256 and size of one entry (dbxv2 needs --pack)
  cat      <game> <root> <path> [--pack <name>] [--output <new-file>]  bytes of one entry";

fn fail(message: impl std::fmt::Display) -> ExitCode {
    eprintln!("bunre vfs: {message}");
    ExitCode::from(1)
}

fn cpk_dir(root: &Path) -> PathBuf {
    if root.join("cpk").is_dir() {
        root.join("cpk")
    } else {
        root.to_path_buf()
    }
}

fn mount_ievr(root: &Path) -> Result<Vfs, String> {
    let data =
        local_data_dir(root).ok_or_else(|| format!("{}: no cpk_list.cfg.bin", root.display()))?;
    let mut vfs = Vfs::new();
    vfs.init(&data).map_err(|e| format!("mount: {e}"))?;
    Ok(vfs)
}

fn build(game: &str, root: &Path) -> Result<Manifest, String> {
    match game {
        "ievr" => mount_ievr(root)?
            .manifest("ievr")
            .map_err(|e| format!("manifest: {e}")),
        "dbxv2" => {
            Manifest::from_cpk_dir("dbxv2", &cpk_dir(root)).map_err(|e| format!("manifest: {e}"))
        }
        other => Err(format!("unknown game `{other}` (ievr|dbxv2)")),
    }
}

fn read_entry(game: &str, root: &Path, path: &str, pack: Option<&str>) -> Result<Vec<u8>, String> {
    match game {
        "ievr" => mount_ievr(root)?
            .read(path)
            .map_err(|e| format!("read: {e}")),
        "dbxv2" => {
            let pack = pack.ok_or("dbxv2 needs --pack <name.cpk>")?;
            if pack.contains(['/', '\\']) {
                return Err("--pack is a file name".into());
            }
            vfs_manifest::read_pack_entry(&cpk_dir(root).join(pack), path)
                .map_err(|e| format!("read: {e}"))
        }
        other => Err(format!("unknown game `{other}` (ievr|dbxv2)")),
    }
}

pub fn main(args: impl Iterator<Item = OsString>) -> ExitCode {
    let args: Vec<String> = args.map(|a| a.to_string_lossy().into_owned()).collect();
    let mut positional = Vec::new();
    let (mut out, mut against, mut pack) = (None, None, None);
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--out" | "--output" => out = it.next().cloned(),
            "--against" => against = it.next().cloned(),
            "--pack" => pack = it.next().cloned(),
            _ => positional.push(a.clone()),
        }
    }
    let [command, game, root, rest @ ..] = positional.as_slice() else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };
    let root = PathBuf::from(root);
    let started = Instant::now();
    match command.as_str() {
        "manifest" => {
            let manifest = match build(game, &root) {
                Ok(m) => m,
                Err(e) => return fail(e),
            };
            let millis = started.elapsed().as_millis();
            let count = |f: fn(&vfs_manifest::ManifestEntry) -> bool| {
                manifest.entries().iter().filter(|e| f(e)).count()
            };
            let mut report = manifest.header_json();
            report["millis"] = json!(millis);
            report["unresolved"] = json!(count(|e| e.unresolved));
            report["loose"] = json!(count(|e| e.loose));
            report["extra"] = json!(count(|e| e.extra));
            if let Some(file) = out {
                if let Err(e) = std::fs::write(&file, manifest.to_ndjson()) {
                    return fail(format!("{file}: {e}"));
                }
                report["wrote"] = json!(file);
            }
            println!("{report}");
            ExitCode::SUCCESS
        }
        "verify" => {
            let Some(against) = against else {
                return fail("verify needs --against <manifest.ndjson>");
            };
            let text = match std::fs::read_to_string(&against) {
                Ok(t) => t,
                Err(e) => return fail(format!("{against}: {e}")),
            };
            let server = match Manifest::parse_ndjson(&text) {
                Ok(m) => m,
                Err(e) => return fail(format!("{against}: {e}")),
            };
            let local = match build(game, &root) {
                Ok(m) => m,
                Err(e) => return fail(e),
            };
            let diffs = local.diff(&server);
            let equal = local.digest() == server.digest();
            let sample: Vec<_> = diffs
                .iter()
                .take(20)
                .map(|d| match d {
                    Difference::OnlyLeft(e) => json!({"onlyLocal": e.path, "source": e.source}),
                    Difference::OnlyRight(e) => json!({"onlyServer": e.path, "source": e.source}),
                    Difference::Changed { left, right } => json!({
                        "changed": left.path,
                        "local": left.canonical_line(),
                        "server": right.canonical_line()
                    }),
                })
                .collect();
            println!(
                "{}",
                json!({
                    "equal": equal,
                    "localDigest": local.digest(),
                    "serverDigest": server.digest(),
                    "localCount": local.len(),
                    "serverCount": server.len(),
                    "differences": diffs.len(),
                    "sample": sample,
                    "millis": started.elapsed().as_millis(),
                })
            );
            if equal && diffs.is_empty() {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            }
        }
        "hash" | "cat" => {
            let Some(path) = rest.first() else {
                return fail("missing <path>");
            };
            let bytes = match read_entry(game, &root, path, pack.as_deref()) {
                Ok(b) => b,
                Err(e) => return fail(e),
            };
            if command == "hash" {
                println!(
                    "{}",
                    json!({
                        "path": path,
                        "size": bytes.len(),
                        "sha256": vfs_manifest::sha256_hex(&bytes),
                        "millis": started.elapsed().as_millis(),
                    })
                );
            } else if let Some(file) = out {
                use std::io::Write;
                let written = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&file)
                    .and_then(|mut f| f.write_all(&bytes));
                if let Err(e) = written {
                    return fail(format!("{file}: {e}"));
                }
            } else {
                use std::io::Write;
                if std::io::stdout().write_all(&bytes).is_err() {
                    return ExitCode::from(1);
                }
            }
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("{USAGE}");
            ExitCode::from(2)
        }
    }
}
