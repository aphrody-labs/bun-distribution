//! Real assets only (DIRECTION.md): Google Sans Flex from the M3 token crate, Material Symbols
//! Rounded from the pinned font in packages/m3-fonts (rendered as vector glyphs through its
//! ligatures, so icons stay crisp at every size), and game art from the Steam client cache, the
//! public Steam CDN or libretro-thumbnails, cached under `usr/var/cache/bun-os-shell`. The loader
//! thread also extracts each picture's M3 source color for the per-game scheme.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::sync::mpsc::{Receiver, Sender, channel};

use bevy::asset::RenderAssetUsages;
use bevy::image::{Image, ImageSampler};
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};

/// Material Symbols Rounded, pinned in packages/m3-fonts (material-symbols@0.44.8, Apache-2.0).
const SYMBOLS_ROUNDED: &[u8] = include_bytes!(
    "../../../packages/m3-fonts/fonts/upstream/material-symbols/material-symbols-rounded.woff2"
);

#[derive(Resource, Clone)]
pub struct Fonts {
    pub text: Handle<Font>,
    pub symbols: Handle<Font>,
}

pub fn rgba_image(width: u32, height: u32, rgba: Vec<u8>, nearest: bool) -> Image {
    let mut image = Image::new(
        Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        rgba,
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::default(),
    );
    image.sampler = if nearest {
        ImageSampler::nearest()
    } else {
        ImageSampler::linear()
    };
    image
}

pub fn setup(mut commands: Commands, mut fonts: ResMut<Assets<Font>>) {
    let text = fonts.add(Font::from_bytes(
        aphrody_m3_tokens::google_sans_flex::TTF_DATA.to_vec(),
    ));
    let ttf = aphrody_svg::symbols::decode_font(SYMBOLS_ROUNDED)
        .map(|t| t.into_owned())
        .unwrap_or_default();
    let symbols = fonts.add(Font::from_bytes(ttf));
    commands.insert_resource(Fonts { text, symbols });
}

/// Where a picture comes from, in preference order.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Source {
    File(PathBuf),
    /// Downloaded once into `cache`; a `cache.missing` marker records a 404.
    Remote {
        url: String,
        cache: PathBuf,
    },
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct ArtRef(pub Vec<Source>);

impl ArtRef {
    pub fn file(path: PathBuf) -> Self {
        Self(vec![Source::File(path)])
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Stable id of this reference (its first source).
    pub fn id(&self) -> String {
        match self.0.first() {
            Some(Source::File(p)) => p.display().to_string(),
            Some(Source::Remote { cache, .. }) => cache.display().to_string(),
            None => String::new(),
        }
    }

    pub fn then(mut self, other: ArtRef) -> Self {
        self.0.extend(other.0);
        self
    }
}

fn missing(cache: &Path) -> PathBuf {
    let mut name = cache.as_os_str().to_owned();
    name.push(".missing");
    PathBuf::from(name)
}

/// Fetch `url` into `cache` with the system curl (Windows 10+ ships it), once.
fn download(url: &str, cache: &Path) -> bool {
    if cache.is_file() {
        return true;
    }
    if missing(cache).is_file() {
        return false;
    }
    if let Some(dir) = cache.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let partial = cache.with_extension("part");
    let ok = Command::new("curl")
        .args(["-fsSL", "--max-time", "20", "-A", "bun-os-shell", "-o"])
        .arg(&partial)
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success());
    if ok && std::fs::rename(&partial, cache).is_ok() {
        true
    } else {
        let _ = std::fs::remove_file(&partial);
        let _ = std::fs::write(missing(cache), url);
        false
    }
}

struct Decoded {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    seed: u32,
}

fn decode(path: &Path) -> Option<Decoded> {
    let img = image::open(path).ok()?;
    let img = if img.width() > 1920 {
        img.resize(1920, 1080, image::imageops::FilterType::Triangle)
    } else {
        img
    };
    let small = img.thumbnail(112, 112).to_rgba8();
    let seed = aphrody_m3_tokens::image::source_color_from_rgba8(small.as_raw());
    let rgba = img.to_rgba8();
    Some(Decoded {
        width: rgba.width(),
        height: rgba.height(),
        rgba: rgba.into_raw(),
        seed,
    })
}

fn resolve(art: &ArtRef) -> Option<Decoded> {
    for source in &art.0 {
        let path = match source {
            Source::File(p) if p.is_file() => p.clone(),
            Source::File(_) => continue,
            Source::Remote { url, cache } => {
                if !download(url, cache) {
                    continue;
                }
                cache.clone()
            }
        };
        if let Some(decoded) = decode(&path) {
            return Some(decoded);
        }
    }
    None
}

/// Decodes (and fetches) artwork on a worker thread; results become `Handle<Image>`s on the main
/// thread together with their M3 source color.
#[derive(Resource)]
pub struct Art {
    requests: Sender<(String, ArtRef)>,
    results: Mutex<Receiver<(String, Option<Decoded>)>>,
    pub loaded: HashMap<String, (Handle<Image>, u32)>,
    failed: HashSet<String>,
    pending: HashSet<String>,
}

impl Default for Art {
    fn default() -> Self {
        let (requests, jobs) = channel::<(String, ArtRef)>();
        let (done, results) = channel();
        let _ = std::thread::Builder::new()
            .name("art loader".into())
            .spawn(move || {
                while let Ok((id, art)) = jobs.recv() {
                    if done.send((id, resolve(&art))).is_err() {
                        break;
                    }
                }
            });
        Self {
            requests,
            results: Mutex::new(results),
            loaded: HashMap::new(),
            failed: HashSet::new(),
            pending: HashSet::new(),
        }
    }
}

impl Art {
    /// The image for `art` if ready; queues it otherwise.
    pub fn get(&mut self, art: &ArtRef) -> Option<Handle<Image>> {
        self.entry(art).map(|(h, _)| h)
    }

    /// Image and M3 source color for `art` if ready; queues it otherwise.
    pub fn entry(&mut self, art: &ArtRef) -> Option<(Handle<Image>, u32)> {
        if art.is_empty() {
            return None;
        }
        let id = art.id();
        if let Some(found) = self.loaded.get(&id) {
            return Some(found.clone());
        }
        if !self.failed.contains(&id) && self.pending.insert(id.clone()) {
            let _ = self.requests.send((id, art.clone()));
        }
        None
    }

    /// True once every source of `art` failed.
    pub fn unavailable(&self, art: &ArtRef) -> bool {
        art.is_empty() || self.failed.contains(&art.id())
    }

    /// Forget an id so a changed file (a new suspend thumbnail) is decoded again.
    pub fn invalidate(&mut self, id: &str) {
        self.loaded.remove(id);
        self.pending.remove(id);
        self.failed.remove(id);
    }
}

pub fn receive_art(mut art: ResMut<Art>, mut images: ResMut<Assets<Image>>) {
    let finished: Vec<_> = art.results.lock().unwrap().try_iter().collect();
    for (id, decoded) in finished {
        art.pending.remove(&id);
        match decoded {
            Some(d) => {
                let handle = images.add(rgba_image(d.width, d.height, d.rgba, false));
                art.loaded.insert(id, (handle, d.seed));
            }
            None => {
                art.failed.insert(id);
            }
        }
    }
}
