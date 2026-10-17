//! Shell assets created at startup without files: Google Sans Flex (from the M3 token crate),
//! Material Symbols Rounded icons (rasterized from the pinned variable font through `aphrody-svg`),
//! UI sounds synthesized here (original, no third-party audio), and the background art loader
//! that decodes Steam artwork and suspend thumbnails off the main thread.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::mpsc::{Receiver, Sender, channel};

use bevy::asset::RenderAssetUsages;
use bevy::audio::AudioSource;
use bevy::image::{Image, ImageSampler};
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};

/// Material Symbols Rounded, pinned in packages/m3-fonts (material-symbols@0.44.8, Apache-2.0).
const SYMBOLS_ROUNDED: &[u8] = include_bytes!(
    "../../../packages/m3-fonts/fonts/upstream/material-symbols/material-symbols-rounded.woff2"
);

pub const ICONS: &[&str] = &[
    "home",
    "sports_esports",
    "download",
    "settings",
    "power_settings_new",
    "play_arrow",
    "info",
    "tune",
    "photo_camera",
    "radio_button_checked",
    "stop_circle",
    "monitoring",
    "speed",
    "aspect_ratio",
    "volume_down",
    "volume_up",
    "bedtime",
    "restart_alt",
    "logout",
    "close",
    "grid_view",
    "language",
    "memory",
    "thermostat",
    "bolt",
    "hdr_on",
    "hdr_off",
    "history",
    "videogame_asset",
    "pause",
    "replay",
    "arrow_back",
    "check_circle",
    "desktop_windows",
    "motion_photos_off",
    "vibration",
    "music_note",
    "fullscreen",
    "cloud_download",
    "library_books",
    "chevron_right",
    "graphic_eq",
];

#[derive(Resource, Clone)]
pub struct Fonts {
    pub text: Handle<Font>,
}

#[derive(Resource, Default)]
pub struct Icons(pub HashMap<&'static str, Handle<Image>>);

impl Icons {
    pub fn get(&self, name: &str) -> Handle<Image> {
        self.0.get(name).cloned().unwrap_or_default()
    }
}

#[derive(Resource, Clone)]
pub struct Sounds {
    pub navigate: Handle<AudioSource>,
    pub select: Handle<AudioSource>,
    pub back: Handle<AudioSource>,
    pub open: Handle<AudioSource>,
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

fn icons(images: &mut Assets<Image>) -> Icons {
    use aphrody_svg::glyph::NumberFormat;
    use aphrody_svg::raster::{RenderOptions, render};
    use aphrody_svg::symbols::{SymbolAxes, decode_font, symbol_path, symbol_svg};
    let mut out = Icons::default();
    let Ok(ttf) = decode_font(SYMBOLS_ROUNDED) else {
        return out;
    };
    let axes = SymbolAxes {
        fill: 1.0,
        weight: 500.0,
        grade: 0.0,
        optical_size: 48.0,
    };
    for &name in ICONS {
        let Ok(Some(path)) = symbol_path(&ttf, name, axes, NumberFormat::Fixed(2)) else {
            continue;
        };
        let svg = symbol_svg(&path, 96.0, Some("#FFFFFF"));
        if let Ok(raster) = render(&svg, RenderOptions::square(96)) {
            out.0.insert(
                name,
                images.add(rgba_image(raster.width, raster.height, raster.rgba, false)),
            );
        }
    }
    out
}

/// 16-bit mono PCM WAV of a sum of decaying partials: (start Hz, end Hz, gain) over `ms`.
fn tone(ms: u32, partials: &[(f32, f32, f32)], decay: f32) -> Vec<u8> {
    const RATE: u32 = 48_000;
    let samples = RATE * ms / 1000;
    let mut pcm = Vec::with_capacity(samples as usize * 2);
    let mut phases = vec![0f32; partials.len()];
    for i in 0..samples {
        let t = i as f32 / samples as f32;
        let attack = (i as f32 / (RATE as f32 * 0.003)).min(1.0);
        let envelope = attack * (-decay * t).exp() * (1.0 - t).max(0.0).sqrt();
        let mut v = 0.0;
        for (p, &(f0, f1, gain)) in phases.iter_mut().zip(partials) {
            let f = f0 + (f1 - f0) * t;
            *p += std::f32::consts::TAU * f / RATE as f32;
            v += p.sin() * gain;
        }
        let s = (v * envelope * 0.25).clamp(-1.0, 1.0);
        pcm.extend_from_slice(&((s * f32::from(i16::MAX)) as i16).to_le_bytes());
    }
    let mut wav = Vec::with_capacity(44 + pcm.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&RATE.to_le_bytes());
    wav.extend_from_slice(&(RATE * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(&pcm);
    wav
}

fn sounds(audio: &mut Assets<AudioSource>) -> Sounds {
    let mut add = |bytes: Vec<u8>| {
        audio.add(AudioSource {
            bytes: Arc::from(bytes),
        })
    };
    Sounds {
        navigate: add(tone(
            40,
            &[(1320.0, 1180.0, 0.6), (2640.0, 2360.0, 0.15)],
            9.0,
        )),
        select: add(tone(
            110,
            &[(660.0, 880.0, 0.5), (990.0, 1320.0, 0.35)],
            5.0,
        )),
        back: add(tone(90, &[(880.0, 620.0, 0.5), (440.0, 330.0, 0.25)], 6.0)),
        open: add(tone(
            220,
            &[
                (392.0, 523.0, 0.35),
                (587.0, 784.0, 0.3),
                (784.0, 1046.0, 0.2),
            ],
            3.5,
        )),
    }
}

pub fn setup(
    mut commands: Commands,
    mut fonts: ResMut<Assets<Font>>,
    mut images: ResMut<Assets<Image>>,
    mut audio: ResMut<Assets<AudioSource>>,
) {
    let text = fonts.add(Font::from_bytes(
        aphrody_m3_tokens::google_sans_flex::TTF_DATA.to_vec(),
    ));
    commands.insert_resource(Fonts { text });
    commands.insert_resource(icons(&mut images));
    commands.insert_resource(sounds(&mut audio));
}

/// Decodes artwork on a worker thread; finished images become `Handle<Image>`s on the main thread.
#[derive(Resource)]
pub struct Art {
    requests: Sender<PathBuf>,
    results: Mutex<Receiver<(PathBuf, Option<(u32, u32, Vec<u8>)>)>>,
    pub loaded: HashMap<PathBuf, Handle<Image>>,
    pending: std::collections::HashSet<PathBuf>,
    /// Bumped whenever an image finishes, so views refresh.
    pub generation: u64,
}

impl Default for Art {
    fn default() -> Self {
        let (requests, jobs) = channel::<PathBuf>();
        let (done, results) = channel();
        let _ = std::thread::Builder::new()
            .name("art loader".into())
            .spawn(move || {
                while let Ok(path) = jobs.recv() {
                    let decoded = image::open(&path).ok().map(|img| {
                        let img = if img.width() > 1920 {
                            img.resize(1920, 1080, image::imageops::FilterType::Triangle)
                        } else {
                            img
                        };
                        let rgba = img.to_rgba8();
                        (rgba.width(), rgba.height(), rgba.into_raw())
                    });
                    if done.send((path, decoded)).is_err() {
                        break;
                    }
                }
            });
        Self {
            requests,
            results: Mutex::new(results),
            loaded: HashMap::new(),
            pending: Default::default(),
            generation: 0,
        }
    }
}

impl Art {
    /// The image for `path` if decoded; queues it otherwise.
    pub fn get(&mut self, path: &Path) -> Option<Handle<Image>> {
        if let Some(handle) = self.loaded.get(path) {
            return Some(handle.clone());
        }
        if self.pending.insert(path.to_path_buf()) {
            let _ = self.requests.send(path.to_path_buf());
        }
        None
    }

    /// Forget a path so a changed file (a new suspend thumbnail) is decoded again.
    pub fn invalidate(&mut self, path: &Path) {
        self.loaded.remove(path);
        self.pending.remove(path);
    }
}

pub fn receive_art(mut art: ResMut<Art>, mut images: ResMut<Assets<Image>>) {
    let finished: Vec<_> = art.results.lock().unwrap().try_iter().collect();
    for (path, decoded) in finished {
        if let Some((w, h, rgba)) = decoded {
            let handle = images.add(rgba_image(w, h, rgba, false));
            art.loaded.insert(path, handle);
            art.generation += 1;
        }
    }
}
