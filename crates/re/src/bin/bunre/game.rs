// SPDX-License-Identifier: Apache-2.0
//! `bunre game`: the game-agnostic asset pipeline (feature `assets`). Every command reads the
//! install read-only and writes only below explicit output paths.

use std::{
    collections::HashMap,
    ffi::OsString,
    io::{BufRead, Write},
    path::{Path, PathBuf},
    process::ExitCode,
    time::Instant,
};

use bun_re::game::assets::{
    AssetError, Keys,
    classify::Kind,
    engine::{self, DetectLimits},
    export::{self, ExportPlan},
    profile,
    vfs::{GameVfs, MountOptions},
};
use serde_json::json;

const USAGE: &str = "\
Usage: bunre game <command> <appid|path> ...
  detect <target>                          engine report (JSON)
  profiles                                 built-in profiles (JSON)
  mount <target>                           mount report + statistics (JSON)
  ls <target> [--prefix <p>] [--limit <n>] [--sniff-unknown <n>]
                                           one JSON entry per line
  cat <target> <path> [--output <file>]    raw bytes (stdout or a new file)
  formats <target> <path>                  export formats for one file (JSON)
  convert <target> <path> --format <id> [--output <file>]
  export <target> --out <new-dir> [--kinds texture,model,audio,table,video]
         [--per-kind <n>] [--filter <s>] [--max-mb <n>] [--raw] [--converted-only]
  worker <target>                          framed stdin/stdout protocol (`re game serve`)
Options: --profile <id>  --only <glob>...  --no-loose  --max-files <n>
         --aes-key <hex64> --hca-key <n>   (user-provided keys; also BUNRE_GAME_AES_KEY,
                                            BUNRE_GAME_HCA_KEY)";

struct Args {
    positional: Vec<String>,
    options: HashMap<String, Vec<String>>,
}

const FLAGS: [&str; 3] = ["--no-loose", "--raw", "--converted-only"];

impl Args {
    fn parse(args: impl Iterator<Item = OsString>) -> Option<Self> {
        let mut positional = Vec::new();
        let mut options: HashMap<String, Vec<String>> = HashMap::new();
        let mut args = args.map(|value| value.to_string_lossy().into_owned());
        while let Some(arg) = args.next() {
            if !arg.starts_with("--") {
                positional.push(arg);
            } else if FLAGS.contains(&arg.as_str()) {
                options.entry(arg).or_default();
            } else {
                let value = args.next()?;
                options.entry(arg).or_default().push(value);
            }
        }
        Some(Self { positional, options })
    }
    fn get(&self, name: &str) -> Option<&str> {
        self.options.get(name).and_then(|values| values.last()).map(String::as_str)
    }
    fn all(&self, name: &str) -> Vec<String> {
        self.options.get(name).cloned().unwrap_or_default()
    }
    fn flag(&self, name: &str) -> bool {
        self.options.contains_key(name)
    }
    fn number(&self, name: &str, default: u64) -> Result<u64, String> {
        self.get(name).map_or(Ok(default), |value| value.parse().map_err(|_| format!("{name}: not a number")))
    }
}

/// Resolve `<appid|path>`: a number is looked up in the local Steam libraries (`bun-steam`).
fn resolve(target: &str) -> Result<PathBuf, String> {
    if !target.is_empty() && target.bytes().all(|b| b.is_ascii_digit()) {
        let app_id: u32 = target.parse().map_err(|_| "app id out of range".to_string())?;
        for installation in bun_steam::find_steam_installations() {
            let Ok(games) = bun_steam::list_installed_games(&installation.root_path) else { continue };
            if let Some(game) = games.into_iter().find(|game| game.manifest.app_id == app_id) {
                return Ok(game.install_path);
            }
        }
        return Err(format!("Steam app {app_id} is not installed in a local Steam library"));
    }
    let path = PathBuf::from(target);
    if path.is_dir() {
        Ok(path)
    } else {
        Err(format!("{target}: not a directory"))
    }
}

fn keys(args: &Args) -> Result<Keys, String> {
    let mut keys = Keys::from_env()?;
    if let Some(value) = args.get("--aes-key") {
        keys.aes = Some(Keys::parse_aes(value)?);
    }
    if let Some(value) = args.get("--hca-key") {
        keys.hca = Some(Keys::parse_hca(value)?);
    }
    Ok(keys)
}

fn limits(args: &Args) -> Result<DetectLimits, String> {
    let mut limits = DetectLimits::default();
    limits.max_files = usize::try_from(args.number("--max-files", limits.max_files as u64)?).unwrap_or(usize::MAX);
    Ok(limits)
}

fn mount(args: &Args, target: &Path) -> Result<GameVfs, String> {
    let profile = match args.get("--profile") {
        Some(id) => Some(profile::by_id(id).ok_or_else(|| format!("unknown profile `{id}`"))?),
        None => None,
    };
    let options = MountOptions {
        keys: keys(args)?,
        profile,
        limits: Some(limits(args)?),
        skip_loose: args.flag("--no-loose"),
        only: args.all("--only"),
    };
    GameVfs::mount(target, &options).map_err(|error| error.to_string())
}

fn print_json(value: &serde_json::Value) {
    println!("{}", serde_json::to_string_pretty(value).unwrap_or_default());
}

fn write_new(path: &str, bytes: &[u8]) -> Result<(), String> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("{path}: {error}"))?;
    file.write_all(bytes).map_err(|error| format!("{path}: {error}"))
}

pub fn main(args: impl Iterator<Item = OsString>) -> ExitCode {
    let Some(args) = Args::parse(args) else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("bunre game: {message}");
            ExitCode::FAILURE
        },
    }
}

#[allow(clippy::too_many_lines)]
fn run(args: &Args) -> Result<(), String> {
    let command = args.positional.first().map(String::as_str).unwrap_or_default();
    if command == "profiles" {
        print_json(&serde_json::to_value(profile::PROFILES).unwrap_or_default());
        return Ok(());
    }
    let Some(target) = args.positional.get(1) else { return Err(USAGE.to_string()) };
    let root = resolve(target)?;
    match command {
        "detect" => {
            let started = Instant::now();
            let report = engine::detect(&root, limits(args)?).map_err(|e| e.to_string())?;
            let mut value = serde_json::to_value(&report).unwrap_or_default();
            value["profile"] = json!(profile::select(&report).id);
            value["millis"] = json!(started.elapsed().as_millis());
            print_json(&value);
        },
        "mount" => {
            let vfs = mount(args, &root)?;
            let mut value = serde_json::to_value(vfs.report()).unwrap_or_default();
            value["stats"] = vfs.stats();
            print_json(&value);
        },
        "ls" => {
            let vfs = mount(args, &root)?;
            let prefix = args.get("--prefix").unwrap_or_default().to_ascii_lowercase();
            let limit = usize::try_from(args.number("--limit", u64::MAX)?).unwrap_or(usize::MAX);
            let mut sniff_budget = args.number("--sniff-unknown", 0)?;
            let stdout = std::io::stdout();
            let mut out = std::io::BufWriter::new(stdout.lock());
            for entry in vfs
                .entries()
                .iter()
                .filter(|entry| entry.path.to_ascii_lowercase().starts_with(&prefix))
                .take(limit)
            {
                let mut value = serde_json::to_value(entry).unwrap_or_default();
                if entry.kind == Kind::Unknown && sniff_budget > 0 {
                    sniff_budget -= 1;
                    if let Ok((kind, format)) = vfs.sniff(entry) {
                        value["kind"] = json!(kind);
                        value["format"] = json!(format);
                        value["sniffed"] = json!(true);
                    }
                }
                if writeln!(out, "{value}").is_err() {
                    break;
                }
            }
        },
        "cat" | "convert" | "formats" => {
            let path = args.positional.get(2).ok_or("missing <path>")?;
            let vfs = mount(args, &root)?;
            let entry = vfs.find(path).ok_or_else(|| format!("{path}: not in the mounted view"))?;
            if command == "formats" {
                print_json(&serde_json::to_value(export::formats_for(&vfs, entry)).unwrap_or_default());
                return Ok(());
            }
            let data = vfs.read_entry(entry).map_err(|e| e.to_string())?;
            let bytes = if command == "cat" {
                data
            } else {
                let format = args.get("--format").ok_or("missing --format")?;
                export::convert(&vfs, entry, data, format, &keys(args)?).map_err(|e| e.to_string())?.bytes
            };
            match args.get("--output") {
                Some(output) => write_new(output, &bytes)?,
                None => match std::io::stdout().write_all(&bytes) {
                    Err(error) if error.kind() != std::io::ErrorKind::BrokenPipe => {
                        return Err(error.to_string());
                    },
                    _ => {},
                },
            }
        },
        "export" => {
            let out = args.get("--out").ok_or("missing --out <new-dir>")?;
            if Path::new(out).exists() {
                return Err(format!("{out}: already exists (exports go to a new directory)"));
            }
            let mut plan = ExportPlan::default();
            if let Some(kinds) = args.get("--kinds") {
                plan.kinds = kinds
                    .split(',')
                    .map(|kind| Kind::parse(kind.trim()).ok_or_else(|| format!("unknown kind `{kind}`")))
                    .collect::<Result<_, _>>()?;
            }
            plan.per_kind = usize::try_from(args.number("--per-kind", plan.per_kind as u64)?).unwrap_or(8);
            plan.filter = args.get("--filter").map(str::to_string);
            plan.max_bytes = args.number("--max-mb", plan.max_bytes >> 20)? << 20;
            plan.convert = !args.flag("--raw");
            plan.converted_only = args.flag("--converted-only");
            let started = Instant::now();
            let vfs = mount(args, &root)?;
            let mount_millis = started.elapsed().as_millis();
            let summary = export::export_batch(&vfs, Path::new(out), &plan, &keys(args)?).map_err(|e| e.to_string())?;
            print_json(&json!({
                "profile": summary.profile,
                "mountMillis": mount_millis,
                "exportMillis": summary.millis,
                "entries": vfs.entries().len(),
                "candidates": summary.candidates,
                "ok": summary.ok,
                "failed": summary.failed,
                "manifest": Path::new(out).join("export_manifest.json"),
            }));
        },
        "worker" => worker(&mount(args, &root)?, &keys(args)?)?,
        other => return Err(format!("unknown command `{other}`\n{USAGE}")),
    }
    Ok(())
}

/// Framed protocol: one JSON request per input line (`{"id","op","path","format"}`, ops
/// `read`, `convert`, `formats`, `head`, `stats`, `report`); each reply is one JSON header line
/// (`{"id","ok","len","mime","ext"}` or `{"id","ok":false,"error"}`) followed by `len` bytes.
fn worker(vfs: &GameVfs, keys: &Keys) -> Result<(), String> {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    let ready = json!({ "id": 0, "ok": true, "len": 0, "ready": true, "entries": vfs.entries().len(), "profile": vfs.profile().id });
    writeln!(out, "{ready}").and_then(|()| out.flush()).map_err(|e| e.to_string())?;
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let request: serde_json::Value = serde_json::from_str(&line).unwrap_or_default();
        let id = request.get("id").cloned().unwrap_or(json!(null));
        let op = request.get("op").and_then(|v| v.as_str()).unwrap_or_default();
        let path = request.get("path").and_then(|v| v.as_str()).unwrap_or_default();
        let result: Result<(Vec<u8>, &str, String), AssetError> = (|| match op {
            "stats" => Ok((vfs.stats().to_string().into_bytes(), "application/json", "json".into())),
            "report" => Ok((serde_json::to_vec(vfs.report()).unwrap_or_default(), "application/json", "json".into())),
            _ => {
                let entry = vfs.find(path).ok_or_else(|| AssetError::NotFound(path.to_string()))?;
                match op {
                    "formats" => Ok((
                        serde_json::to_vec(&export::formats_for(vfs, entry)).unwrap_or_default(),
                        "application/json",
                        "json".into(),
                    )),
                    "head" => {
                        let mut data = vfs.read_entry(entry)?;
                        data.truncate(64 * 1024);
                        Ok((data, "application/octet-stream", entry.format.clone()))
                    },
                    "read" => Ok((vfs.read_entry(entry)?, "application/octet-stream", entry.format.clone())),
                    "convert" => {
                        let format = request.get("format").and_then(|v| v.as_str()).unwrap_or("raw");
                        let data = vfs.read_entry(entry)?;
                        let exported = export::convert(vfs, entry, data, format, keys)?;
                        Ok((exported.bytes, exported.mime, exported.ext))
                    },
                    other => Err(AssetError::Unsupported(format!("worker op `{other}`"))),
                }
            },
        })();
        let written = match result {
            Ok((bytes, mime, ext)) => {
                let header = json!({ "id": id, "ok": true, "len": bytes.len(), "mime": mime, "ext": ext });
                writeln!(out, "{header}").and_then(|()| out.write_all(&bytes))
            },
            Err(error) => {
                let header = json!({ "id": id, "ok": false, "len": 0, "error": error.to_string() });
                writeln!(out, "{header}")
            },
        };
        if written.and_then(|()| out.flush()).is_err() {
            break;
        }
    }
    Ok(())
}
