//! The captures library: screenshots and recordings of the shell (`usr/var/lib/bep/shell/captures`)
//! and the media exports (`usr/var/lib/bep/media/exports`: `bunre game export --out` targets, NIE
//! model exports), classified by content through ArtCraft's MIME owner (`artcraft-mimetypes`) with
//! the file extension as the fallback for formats `infer` does not sniff (`.gltf`).

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::mpsc::{Receiver, channel};
use std::time::SystemTime;

use bevy::prelude::*;
use mimetypes::mimetype_info::file_extension::FileExtension;
use mimetypes::mimetype_info::mimetype_info::MimetypeInfo;

use crate::paths::Paths;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Kind {
    Image,
    Clip,
    Model,
}

impl Kind {
    pub fn icon(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Clip => "movie",
            Self::Model => "view_in_ar",
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::Image => "media.screenshots",
            Self::Clip => "media.clips",
            Self::Model => "media.models",
        }
    }
}

#[derive(Clone, Debug)]
pub struct MediaItem {
    pub path: PathBuf,
    pub name: String,
    pub kind: Kind,
    pub modified: SystemTime,
    pub size: u64,
}

/// Exports root (created on demand): `bunre game export <game> --out <exports>/<game>`.
pub fn exports_dir(paths: &Paths) -> PathBuf {
    paths.bep.join("media").join("exports")
}

fn classify(path: &Path) -> Option<Kind> {
    let by_content = MimetypeInfo::get_for_path(path)
        .ok()
        .flatten()
        .and_then(|info| info.file_extension());
    match by_content {
        Some(FileExtension::Png | FileExtension::Jpg | FileExtension::Webp | FileExtension::Gif) => {
            return Some(Kind::Image);
        }
        Some(FileExtension::Mp4 | FileExtension::Webm | FileExtension::Mov) => return Some(Kind::Clip),
        Some(FileExtension::Glb) => return Some(Kind::Model),
        _ => {}
    }
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "glb" | "gltf" => Some(Kind::Model),
        _ => None,
    }
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<MediaItem>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            // Skip the gallery's own caches (`.thumbs`) and hidden folders.
            if depth > 0 && !entry.file_name().to_string_lossy().starts_with('.') {
                walk(&path, depth - 1, out);
            }
            continue;
        }
        if let Some(kind) = classify(&path) {
            out.push(MediaItem {
                name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                path,
                kind,
                modified: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                size: meta.len(),
            });
        }
    }
}

/// Every capture and export, newest first.
pub fn scan(paths: &Paths) -> Vec<MediaItem> {
    let mut out = Vec::new();
    walk(&paths.captures(), 1, &mut out);
    walk(&exports_dir(paths), 6, &mut out);
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

/// Decoded thumbnails arriving from the worker thread.
#[derive(Resource)]
pub struct Thumbs {
    rx: Mutex<Receiver<(PathBuf, u32, u32, Vec<u8>)>>,
    pub ready: std::collections::HashMap<PathBuf, Handle<Image>>,
}

/// Decode image thumbnails off the main thread with ArtCraft's resize (`artcraft-images`).
pub fn start_thumbnails(items: &[MediaItem], edge: u32) -> Thumbs {
    let (tx, rx) = channel();
    let jobs: Vec<PathBuf> = items.iter().filter(|i| i.kind == Kind::Image).map(|i| i.path.clone()).collect();
    let _ = std::thread::Builder::new().name("media-thumbs".into()).spawn(move || {
        for path in jobs {
            let Ok(image) = images::image::open(&path) else { continue };
            let thumb = images::resize_preserving_aspect::resize_preserving_aspect(&image, edge, edge, false);
            let rgba = thumb.to_rgba8();
            if tx.send((path, rgba.width(), rgba.height(), rgba.into_raw())).is_err() {
                break;
            }
        }
    });
    Thumbs {
        rx: Mutex::new(rx),
        ready: Default::default(),
    }
}

impl Thumbs {
    /// Images decoded since the last call, as Bevy assets.
    pub fn receive(&mut self, images: &mut Assets<Image>) -> Vec<PathBuf> {
        let mut out = Vec::new();
        let Ok(rx) = self.rx.lock() else { return out };
        while let Ok((path, w, h, rgba)) = rx.try_recv() {
            let handle = images.add(crate::assets::rgba_image(w, h, rgba, false));
            self.ready.insert(path.clone(), handle);
            out.push(path);
        }
        out
    }

    /// Add a decoded thumbnail produced elsewhere (clip posters from the platform service).
    pub fn insert(&mut self, path: PathBuf, handle: Handle<Image>) {
        self.ready.insert(path, handle);
    }
}
