// SPDX-License-Identifier: Apache-2.0
//! `terminal-theme` — writes the terminal themes of [`crate::terminal_theme`] into the versioned
//! terminal configuration, and checks that the versioned copies are current.
//!
//! ```text
//! aphrody identity terminal-theme                    # write into <root>/infra/config/host/windows/terminal
//! aphrody identity terminal-theme --out <dir>        # write into <dir>
//! aphrody identity terminal-theme --check            # exit 1 when a versioned file differs
//! aphrody identity terminal-theme --print <wt|rio|rio-light|nushell|prompt>
//! aphrody identity terminal-theme --contrast         # WCAG table of every drawn pair
//! ```
//!
//! `<root>` is `APHRODY_ROOT`, else the current directory. The `schemes` array of the
//! `settings.json` next to the generated files is rewritten too (and checked by `--check`).
//! Writes are idempotent: an unchanged file is not touched.

use crate::terminal_theme::{ANSI_NAMES, CONFIG_DIR, FILES, TerminalTheme, hct};
use aphrody_m3_tokens::color_math::hex_from_argb;
use std::{ffi::OsString, path::PathBuf};

/// Entry point of `aphrody identity terminal-theme`. `args[0]` is the tool name.
pub fn terminal_theme_main(args: Vec<OsString>) -> i32 {
    let mut check = false;
    let mut out: Option<PathBuf> = None;
    let mut print: Option<String> = None;
    let mut contrast_only = false;
    let mut it = args.into_iter().skip(1).map(|a| a.to_string_lossy().into_owned());
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--check" | "--verifier" => check = true,
            "--contrast" => contrast_only = true,
            "--out" => match it.next() {
                Some(dir) => out = Some(PathBuf::from(dir)),
                None => return usage("--out needs a directory"),
            },
            "--print" => match it.next() {
                Some(what) => print = Some(what),
                None => return usage("--print needs wt, rio, rio-light, nushell or prompt"),
            },
            "-h" | "--help" => {
                println!("{}", help());
                return 0;
            },
            other => return usage(&format!("unknown argument: {other}")),
        }
    }

    let theme = TerminalTheme::aphrody();
    if let Some(what) = print {
        let text = match what.as_str() {
            "wt" => theme.windows_terminal_json(),
            "rio" => theme.rio_toml(true),
            "rio-light" => theme.rio_toml(false),
            "nushell" => theme.nushell(),
            "prompt" => theme.prompt_json(),
            other => return usage(&format!("unknown --print target: {other}")),
        };
        print!("{text}");
        return 0;
    }
    if contrast_only {
        return report(&theme);
    }

    let dir = out.unwrap_or_else(|| {
        std::env::var_os("APHRODY_ROOT")
            .map_or_else(|| PathBuf::from("."), PathBuf::from)
            .join(CONFIG_DIR)
    });
    let mut wanted: Vec<(PathBuf, String)> =
        theme.files().into_iter().map(|(rel, text)| (dir.join(rel), text)).collect();
    let settings = dir.join("settings.json");
    if let Ok(current) = std::fs::read_to_string(&settings) {
        match theme.splice_wt_settings(&current) {
            Ok(text) => wanted.push((settings, text)),
            Err(e) => {
                eprintln!("{}: {e}", settings.display());
                return 1;
            },
        }
    }

    let mut differing = 0;
    for (path, text) in &wanted {
        let same = std::fs::read_to_string(path).is_ok_and(|old| old == *text);
        if same {
            println!("unchanged  {}", path.display());
            continue;
        }
        if check {
            eprintln!("DIFFERS    {}", path.display());
            differing += 1;
            continue;
        }
        if let Some(parent) = path.parent()
            && let Err(e) = std::fs::create_dir_all(parent)
        {
            eprintln!("{}: {e}", parent.display());
            return 1;
        }
        if let Err(e) = std::fs::write(path, text) {
            eprintln!("{}: {e}", path.display());
            return 1;
        }
        println!("written    {}", path.display());
    }
    if differing > 0 {
        eprintln!("{differing} file(s) differ: regenerate with `aphrody identity terminal-theme`");
        return 1;
    }
    report(&theme)
}

fn report(theme: &TerminalTheme) -> i32 {
    for m in theme.modes() {
        println!("\n{} ({})", m.wt_name(), if m.dark { "dark" } else { "light" });
        for (i, name) in ANSI_NAMES.iter().enumerate() {
            let h = hct(m.ansi[i]);
            println!(
                "  {name:<15} {}  hue {:>5.1}  chroma {:>4.1}  tone {:>4.1}",
                hex_from_argb(m.ansi[i]),
                h.hue,
                h.chroma,
                h.tone
            );
        }
    }
    let checks = theme.contrast_checks();
    let failing: Vec<_> = checks.iter().filter(|c| !c.ok()).collect();
    let lowest = checks.iter().filter(|c| c.minimum >= 4.5).min_by(|a, b| a.ratio.total_cmp(&b.ratio));
    println!("\n{} contrast pairs, {} below their minimum", checks.len(), failing.len());
    if let Some(c) = lowest {
        println!("lowest text pair: {} {} {:.2}:1", c.mode, c.what, c.ratio);
    }
    for c in &failing {
        eprintln!("  FAIL {} {} {:.2} < {}", c.mode, c.what, c.ratio, c.minimum);
    }
    i32::from(!failing.is_empty())
}

fn usage(message: &str) -> i32 {
    eprintln!("{message}\n\n{}", help());
    2
}

fn help() -> String {
    format!(
        "aphrody identity terminal-theme [--out <dir>] [--check] [--contrast] [--print <wt|rio|rio-light|nushell|prompt>]\n\n\
         Writes {} and the settings.json schemes into <APHRODY_ROOT>/{CONFIG_DIR} (or --out).",
        FILES.join(", ")
    )
}
