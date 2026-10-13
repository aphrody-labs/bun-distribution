// SPDX-License-Identifier: Apache-2.0
//! Guards the set of files Tauri embeds from `ui-dist`.
//!
//! `tauri::generate_context!()` walks the whole `frontendDist` directory when it expands, which is
//! after `build.rs` has run. The binary assets under `ui-dist/fonts` are not committed there: the
//! build script stages them from their canonical packages (`ui-dist.manifest`). These checks fail
//! when that staging did not happen or when a canonical source moved or changed.

use std::{env, fs, path::PathBuf};

fn app_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// `(destination relative to ui-dist, canonical source)` for every manifest line.
fn manifest_entries() -> Vec<(String, PathBuf)> {
    let text =
        fs::read_to_string(app_dir().join("ui-dist.manifest")).expect("read ui-dist.manifest");
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| {
            let (destination, source) = line
                .split_once(' ')
                .unwrap_or_else(|| panic!("ui-dist.manifest: bad line {line:?}"));
            let root = app_dir().join("../../..");
            let source = source.trim();
            let canonical = source.strip_prefix("material/").map_or_else(
                || root.join(source),
                |relative| {
                    env::var_os("APHRODY_MATERIAL_CHECKOUT")
                        .filter(|path| !path.is_empty())
                        .map(PathBuf::from)
                        .unwrap_or_else(|| root.join("../material"))
                        .join(relative)
                },
            );
            (destination.trim().to_owned(), canonical)
        })
        .collect()
}

#[test]
fn staged_assets_are_the_canonical_bytes() {
    let entries = manifest_entries();
    assert!(!entries.is_empty(), "ui-dist.manifest lists no asset");
    for (destination, source) in entries {
        let staged_path = app_dir().join("ui-dist").join(&destination);
        let staged = fs::read(&staged_path)
            .unwrap_or_else(|error| panic!("{destination} is not staged in ui-dist: {error}"));
        let canonical = fs::read(&source)
            .unwrap_or_else(|error| panic!("canonical {source:?} is unreadable: {error}"));
        assert!(!staged.is_empty(), "{destination} is empty");
        assert!(staged == canonical, "ui-dist/{destination} differs from {}", source.display());
    }
}

#[test]
fn every_font_the_stylesheet_loads_is_in_the_embed_set() {
    let css = fs::read_to_string(app_dir().join("ui-dist/app.css")).expect("read ui-dist/app.css");
    let mut loaded = 0_usize;
    for chunk in css.split("url(./fonts/").skip(1) {
        let name = chunk
            .split(')')
            .next()
            .unwrap_or_default()
            .trim_matches(|c: char| c == '"' || c == '\'');
        let path = app_dir().join("ui-dist/fonts").join(name);
        let length = fs::metadata(&path).map(|metadata| metadata.len()).unwrap_or(0);
        assert!(length > 0, "app.css loads fonts/{name} but ui-dist/fonts/{name} is missing");
        loaded += 1;
    }
    assert!(loaded > 0, "app.css no longer references ui-dist/fonts: update this test");
}

#[test]
fn no_partial_copy_is_left_in_the_embed_set() {
    let fonts = app_dir().join("ui-dist/fonts");
    let leftovers: Vec<String> = fs::read_dir(&fonts)
        .expect("read ui-dist/fonts")
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.contains(".partial-"))
        .collect();
    assert!(leftovers.is_empty(), "interrupted staging left {leftovers:?} in ui-dist/fonts");
}
