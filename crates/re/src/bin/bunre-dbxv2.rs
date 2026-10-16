// SPDX-License-Identifier: Apache-2.0
use std::{
    collections::HashSet,
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    process::ExitCode,
};

use bun_re::game::{
    formats::emb_archive::EmbArchive,
    fs::cpk::{CpkArchive, CpkEntry},
    inventory::inventory_install,
    text::{extract_msg_text, extract_msg_tree},
    world::xenoverse3::xenoverse3_prototype_map,
};

fn main() -> ExitCode {
    let mut args = env::args_os().skip(1);
    match args.next().as_deref() {
        Some(arg) if arg == "map" => {
            let result = xenoverse3_prototype_map();
            match args.next() {
                Some(path) if path == "--output" => match args.next() {
                    Some(path) if args.next().is_none() => write_json(PathBuf::from(path), &result),
                    _ => usage(),
                },
                None => print_json(&result),
                _ => usage(),
            }
        },
        Some(arg) if arg == "catalog" => {
            if args.next().is_some() {
                return usage();
            }
            let catalog = bun_re::game::get_dragon_ball_catalog();
            print_json(&catalog)
        },
        Some(arg) if arg == "emb" => {
            let Some(input) = args.next() else {
                return usage();
            };
            let input = PathBuf::from(input);
            if !input.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("emb")) {
                eprintln!("bunre-dbxv2: emb input must have a .emb extension");
                return ExitCode::FAILURE;
            }
            let Some(option) = args.next() else {
                return usage();
            };
            let Some(destination) = args.next() else {
                return usage();
            };
            if option != "--output-dir" || args.next().is_some() {
                return usage();
            }
            let archive_bytes = match fs::read(&input) {
                Ok(bytes) => bytes,
                Err(error) => {
                    eprintln!("bunre-dbxv2: could not read {}: {error}", input.display());
                    return ExitCode::FAILURE;
                },
            };
            let archive = match EmbArchive::parse(&archive_bytes) {
                Ok(archive) => archive,
                Err(error) => {
                    eprintln!("bunre-dbxv2: invalid EMB {}: {error}", input.display());
                    return ExitCode::FAILURE;
                },
            };
            let destination = PathBuf::from(destination);
            if destination.exists() {
                eprintln!("bunre-dbxv2: output directory already exists: {}", destination.display());
                return ExitCode::FAILURE;
            }
            if let Err(error) = fs::create_dir(&destination) {
                eprintln!("bunre-dbxv2: could not create {}: {error}", destination.display());
                return ExitCode::FAILURE;
            }
            let mut outputs = Vec::with_capacity(archive.entries.len());
            let mut total_bytes = 0u64;
            for (index, entry) in archive.entries.iter().enumerate() {
                let bytes = match archive.entry_bytes(&archive_bytes, index) {
                    Ok(bytes) => bytes,
                    Err(error) => {
                        eprintln!("bunre-dbxv2: invalid EMB entry {}: {error}", entry.name);
                        return ExitCode::FAILURE;
                    },
                };
                let output = destination.join(&entry.name);
                let result = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&output)
                    .and_then(|mut file| file.write_all(bytes));
                if let Err(error) = result {
                    eprintln!("bunre-dbxv2: could not create {}: {error}", output.display());
                    return ExitCode::FAILURE;
                }
                total_bytes = total_bytes.saturating_add(bytes.len() as u64);
                outputs.push(serde_json::json!({ "file": entry.name, "sizeBytes": bytes.len() }));
            }
            let summary = serde_json::json!({
                "archive": input.file_name().map(|name| name.to_string_lossy()),
                "entryCount": outputs.len(),
                "totalBytes": total_bytes,
                "files": outputs,
            });
            print_json(&summary)
        },
        Some(arg) if arg == "cpk" => {
            let Some(input) = args.next() else {
                return usage();
            };
            let input = PathBuf::from(input);
            if !input.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("cpk")) {
                eprintln!("bunre-dbxv2: cpk input must have a .cpk extension");
                return ExitCode::FAILURE;
            }
            let Some(option) = args.next() else {
                return usage();
            };
            let Some(destination) = args.next() else {
                return usage();
            };
            if option != "--output-dir" || args.next().is_some() {
                return usage();
            }
            let archive_bytes = match fs::read(&input) {
                Ok(bytes) => bytes,
                Err(error) => {
                    eprintln!("bunre-dbxv2: could not read {}: {error}", input.display());
                    return ExitCode::FAILURE;
                },
            };
            let archive = match CpkArchive::parse(&archive_bytes) {
                Ok(archive) => archive,
                Err(error) => {
                    eprintln!("bunre-dbxv2: invalid CPK {}: {error}", input.display());
                    return ExitCode::FAILURE;
                },
            };
            let mut paths = Vec::with_capacity(archive.entries.len());
            let mut unique_paths = HashSet::with_capacity(archive.entries.len());
            for entry in &archive.entries {
                let Some(path) = cpk_output_path(entry) else {
                    eprintln!(
                        "bunre-dbxv2: unsafe CPK output path: {:?}",
                        entry.dir_name.as_deref().unwrap_or("")
                    );
                    return ExitCode::FAILURE;
                };
                let key = path.to_string_lossy().replace('\\', "/").to_ascii_lowercase();
                if key == "cpk_manifest.json" {
                    eprintln!("bunre-dbxv2: CPK entry reserves cpk_manifest.json");
                    return ExitCode::FAILURE;
                }
                if !unique_paths.insert(key) {
                    eprintln!("bunre-dbxv2: duplicate CPK output path: {}", path.display());
                    return ExitCode::FAILURE;
                }
                paths.push(path);
            }
            let destination = PathBuf::from(destination);
            if destination.exists() {
                eprintln!("bunre-dbxv2: output directory already exists: {}", destination.display());
                return ExitCode::FAILURE;
            }
            if let Err(error) = fs::create_dir(&destination) {
                eprintln!("bunre-dbxv2: could not create {}: {error}", destination.display());
                return ExitCode::FAILURE;
            }
            let mut outputs = Vec::with_capacity(archive.entries.len());
            let mut total_bytes = 0u64;
            for (entry, relative) in archive.entries.iter().zip(paths) {
                let bytes = match archive.extract(&archive_bytes, &entry.name) {
                    Ok(bytes) => bytes,
                    Err(error) => {
                        eprintln!("bunre-dbxv2: could not extract {}: {error}", entry.name);
                        return ExitCode::FAILURE;
                    },
                };
                let output = destination.join(&relative);
                if let Some(parent) = output.parent()
                    && let Err(error) = fs::create_dir_all(parent)
                {
                    eprintln!("bunre-dbxv2: could not create {}: {error}", parent.display());
                    return ExitCode::FAILURE;
                }
                let result = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&output)
                    .and_then(|mut file| file.write_all(&bytes));
                if let Err(error) = result {
                    eprintln!("bunre-dbxv2: could not create {}: {error}", output.display());
                    return ExitCode::FAILURE;
                }
                total_bytes = total_bytes.saturating_add(bytes.len() as u64);
                outputs.push(serde_json::json!({
                    "id": entry.id,
                    "file": relative,
                    "sizeBytes": bytes.len(),
                }));
            }
            let manifest = serde_json::json!({
                "archive": input.file_name().map(|name| name.to_string_lossy()),
                "entryCount": outputs.len(),
                "totalBytes": total_bytes,
                "files": outputs,
            });
            let manifest_path = destination.join("cpk_manifest.json");
            if let Err(error) =
                OpenOptions::new().write(true).create_new(true).open(&manifest_path).and_then(
                    |mut file| {
                        let json =
                            serde_json::to_vec_pretty(&manifest).map_err(std::io::Error::other)?;
                        file.write_all(&json)
                    },
                )
            {
                eprintln!("bunre-dbxv2: could not write {}: {error}", manifest_path.display());
                return ExitCode::FAILURE;
            }
            print_json(&manifest)
        },
        Some(arg) if arg == "inventory" => {
            let Some(root) = args.next() else {
                return usage();
            };
            let inventory = match inventory_install(&PathBuf::from(root)) {
                Ok(inventory) => inventory,
                Err(error) => {
                    eprintln!("bunre-dbxv2: inventory failed: {error}");
                    return ExitCode::FAILURE;
                },
            };
            match args.next() {
                Some(option) if option == "--output" => match args.next() {
                    Some(path) if args.next().is_none() => {
                        write_json(PathBuf::from(path), &inventory)
                    },
                    _ => usage(),
                },
                None => print_json(&inventory),
                _ => usage(),
            }
        },
        Some(arg) if arg == "text" => {
            let Some(input) = args.next() else {
                return usage();
            };
            let input = PathBuf::from(input);
            if input.is_dir() {
                let Some(option) = args.next() else {
                    return usage();
                };
                let Some(destination) = args.next() else {
                    return usage();
                };
                if option != "--output-dir" || args.next().is_some() {
                    return usage();
                }
                let manifest = match extract_msg_tree(&input, &PathBuf::from(destination)) {
                    Ok(manifest) => manifest,
                    Err(error) => {
                        eprintln!("bunre-dbxv2: text batch failed: {error}");
                        return ExitCode::FAILURE;
                    },
                };
                return print_json(&manifest);
            }
            if !input.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("msg")) {
                eprintln!("bunre-dbxv2: text input must have a .msg extension");
                return ExitCode::FAILURE;
            }
            let bytes = match fs::read(&input) {
                Ok(bytes) => bytes,
                Err(error) => {
                    eprintln!("bunre-dbxv2: could not read {}: {error}", input.display());
                    return ExitCode::FAILURE;
                },
            };
            let text = extract_msg_text(&input, &bytes);
            match args.next() {
                Some(option) if option == "--output" => match args.next() {
                    Some(path) if args.next().is_none() => {
                        write_json_new(PathBuf::from(path), &text)
                    },
                    _ => usage(),
                },
                None => print_json(&text),
                _ => usage(),
            }
        },
        _ => usage(),
    }
}

fn print_json(value: &impl serde::Serialize) -> ExitCode {
    match serde_json::to_string_pretty(value) {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        },
        Err(error) => {
            eprintln!("bunre-dbxv2: could not encode JSON: {error}");
            ExitCode::FAILURE
        },
    }
}

fn write_json(path: PathBuf, value: &impl serde::Serialize) -> ExitCode {
    let json = match serde_json::to_vec_pretty(value) {
        Ok(json) => json,
        Err(error) => {
            eprintln!("bunre-dbxv2: could not encode JSON: {error}");
            return ExitCode::FAILURE;
        },
    };
    match fs::write(&path, json) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("bunre-dbxv2: could not write {}: {error}", path.display());
            ExitCode::FAILURE
        },
    }
}

fn write_json_new(path: PathBuf, value: &impl serde::Serialize) -> ExitCode {
    let json = match serde_json::to_vec_pretty(value) {
        Ok(json) => json,
        Err(error) => {
            eprintln!("bunre-dbxv2: could not encode JSON: {error}");
            return ExitCode::FAILURE;
        },
    };
    let result = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .and_then(|mut output| output.write_all(&json));
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("bunre-dbxv2: could not create {}: {error}", path.display());
            ExitCode::FAILURE
        },
    }
}

fn cpk_output_path(entry: &CpkEntry) -> Option<PathBuf> {
    let mut output = PathBuf::new();
    if let Some(directory) = entry.dir_name.as_deref().filter(|value| !value.is_empty()) {
        for component in directory.split(['/', '\\']) {
            if !is_safe_path_component(component) {
                return None;
            }
            output.push(component);
        }
    }
    if !is_safe_path_component(&entry.name) || entry.name.contains(['/', '\\']) {
        return None;
    }
    output.push(&entry.name);
    Some(output)
}

fn is_safe_path_component(component: &str) -> bool {
    !component.is_empty()
        && component != "."
        && component != ".."
        && !component.contains(':')
        && !component.chars().any(char::is_control)
}

fn usage() -> ExitCode {
    eprintln!(
        "Usage: bunre-dbxv2 map [--output <file>] | catalog | inventory <game-root> [--output <file>] | text <file.msg> [--output <new-file>] | text <input-dir> --output-dir <new-dir> | emb <file.emb> --output-dir <new-dir> | cpk <file.cpk> --output-dir <new-dir>"
    );
    ExitCode::from(2)
}
