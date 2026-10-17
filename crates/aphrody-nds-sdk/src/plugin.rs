//! Bevy plugin over [`Handheld`]: the machine lives in the world as the non-send
//! [`HandheldSlot`], `run_frame` runs in `FixedUpdate` at the console refresh rate, both screens
//! are `Image` assets ([`HandheldScreens`]) updated after every frame, Bevy keyboard input is
//! folded into [`HandheldInput`], audio plays on a `bevy_audio` sink and [`HandheldEvent`]
//! reports frames, shutdown and faults.
//!
//! The plugin spawns no camera, sprite or UI: show the two images however the game wants (see
//! `examples/viewer.rs`). Add it after `DefaultPlugins` (or `AudioPlugin`) to get sound.

use std::{
    collections::VecDeque,
    num::NonZero,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use bevy::{
    app::{App, FixedUpdate, Plugin, PreUpdate},
    asset::{Asset, Assets, Handle, RenderAssetUsages},
    audio::{
        AddAudioSource, AudioPlayer, AudioPlugin, ChannelCount, Decodable, PlaybackSettings,
        SampleRate, Source,
    },
    ecs::prelude::*,
    image::{Image, ImageSampler},
    input::{ButtonInput, keyboard::KeyCode},
    reflect::TypePath,
    render::render_resource::{Extent3d, TextureDimension, TextureFormat},
    time::{Fixed, Time},
};

use crate::{
    Options,
    handheld::{Handheld, Input, ScreenId, Step, button},
};

/// The running machine (non-send: cores own renderer buffers and raw pointers).
pub struct HandheldSlot(pub Box<dyn Handheld>);

/// Progress and control of the machine.
#[derive(Resource, Clone, Debug)]
pub struct HandheldStatus {
    pub frames: u64,
    /// Stop advancing (menu, overlay); the last picture stays.
    pub paused: bool,
    /// The guest shut down or crashed.
    pub stopped: bool,
    pub refresh_rate: f64,
}

/// The two screens as images (RGBA8 sRGB, nearest sampling), top first.
#[derive(Resource, Clone, Debug)]
pub struct HandheldScreens {
    pub top: Handle<Image>,
    pub bottom: Handle<Image>,
    pub top_size: (u32, u32),
    pub bottom_size: (u32, u32),
}

/// Input applied before every frame. [`HandheldKeyMap`] fills `buttons` from the keyboard;
/// hosts write `touch`, `circle` and `c_stick` (the viewer example maps the mouse).
#[derive(Resource, Clone, Copy, Debug, Default)]
pub struct HandheldInput(pub Input);

/// Keyboard bindings. Defaults: Z/X = A/B, A/S = Y/X, Q/W = L/R, E/R = ZL/ZR, Enter = Start,
/// Right Shift or Backspace = Select, arrows = D-pad.
#[derive(Resource, Clone, Debug)]
pub struct HandheldKeyMap(pub Vec<(KeyCode, u32)>);

impl Default for HandheldKeyMap {
    fn default() -> Self {
        Self(vec![
            (KeyCode::KeyZ, button::A),
            (KeyCode::KeyX, button::B),
            (KeyCode::KeyA, button::Y),
            (KeyCode::KeyS, button::X),
            (KeyCode::KeyQ, button::L),
            (KeyCode::KeyW, button::R),
            (KeyCode::KeyE, button::ZL),
            (KeyCode::KeyR, button::ZR),
            (KeyCode::Enter, button::START),
            (KeyCode::ShiftRight, button::SELECT),
            (KeyCode::Backspace, button::SELECT),
            (KeyCode::ArrowUp, button::UP),
            (KeyCode::ArrowDown, button::DOWN),
            (KeyCode::ArrowLeft, button::LEFT),
            (KeyCode::ArrowRight, button::RIGHT),
        ])
    }
}

/// Machine lifecycle and saved-state results.
#[derive(Message, Clone, Debug)]
pub enum HandheldEvent {
    /// A frame completed (carries the frame count).
    Frame(u64),
    Shutdown,
    Fault(String),
    StateSaved(Result<PathBuf, String>),
    StateLoaded(Result<PathBuf, String>),
}

/// Write the machine state to `path`.
#[derive(Message, Clone, Debug)]
pub struct SaveHandheldState(pub PathBuf);

/// Restore the machine state from `path`.
#[derive(Message, Clone, Debug)]
pub struct LoadHandheldState(pub PathBuf);

enum Source_ {
    Path(PathBuf),
    Bytes(String, Vec<u8>),
}

/// Boots a DS or 3DS image when the app is built and runs it. A boot failure panics with the
/// reason when the app is built, as a missing asset would.
pub struct HandheldPlugin {
    source: Mutex<Option<Source_>>,
    options: Options,
}

impl HandheldPlugin {
    /// Boot the image at `path`; DS saves go to `<path>.sav` unless `options.save_path` is set.
    pub fn from_path(path: impl Into<PathBuf>, options: Options) -> Self {
        Self { source: Mutex::new(Some(Source_::Path(path.into()))), options }
    }

    /// Boot an image held in memory.
    pub fn from_bytes(name: impl Into<String>, image: Vec<u8>, options: Options) -> Self {
        Self { source: Mutex::new(Some(Source_::Bytes(name.into(), image))), options }
    }
}

impl Plugin for HandheldPlugin {
    fn build(&self, app: &mut App) {
        let Some(source) = self.source.lock().unwrap().take() else { return };
        let machine = match source {
            Source_::Path(path) => crate::open(&path, &self.options),
            Source_::Bytes(name, image) => crate::boot(&name, &image, &self.options),
        }
        .unwrap_or_else(|e| panic!("{e}"));
        install(app, machine);
    }
}

/// Run an already booted machine in `app` (what [`HandheldPlugin`] does after booting).
pub fn install(app: &mut App, machine: Box<dyn Handheld>) {
    let [top, bottom] = machine.screens();
    let refresh = machine.refresh_rate();
    let sample_rate = machine.sample_rate();
    let make = |w: u32, h: u32| {
        let mut image = Image::new_fill(
            Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            TextureDimension::D2,
            &[0, 0, 0, 255],
            TextureFormat::Rgba8UnormSrgb,
            RenderAssetUsages::RENDER_WORLD | RenderAssetUsages::MAIN_WORLD,
        );
        image.sampler = ImageSampler::nearest();
        image
    };
    let mut images = app.world_mut().resource_mut::<Assets<Image>>();
    let screens = HandheldScreens {
        top: images.add(make(top.width, top.height)),
        bottom: images.add(make(bottom.width, bottom.height)),
        top_size: (top.width, top.height),
        bottom_size: (bottom.width, bottom.height),
    };
    app.insert_resource(screens)
        .insert_resource(HandheldStatus { frames: 0, paused: false, stopped: false, refresh_rate: refresh })
        .init_resource::<HandheldInput>()
        .init_resource::<HandheldKeyMap>()
        .add_message::<HandheldEvent>()
        .add_message::<SaveHandheldState>()
        .add_message::<LoadHandheldState>()
        .insert_resource(Time::<Fixed>::from_hz(refresh))
        .add_systems(PreUpdate, keyboard)
        .add_systems(FixedUpdate, (run, state_files).chain());
    app.world_mut().insert_non_send(HandheldSlot(machine));
    if app.is_plugin_added::<AudioPlugin>() {
        app.add_audio_source::<HandheldAudio>();
        let queue = HandheldAudioQueue::new(sample_rate);
        let handle = app.world_mut().resource_mut::<Assets<HandheldAudio>>().add(HandheldAudio {
            shared: queue.shared.clone(),
            sample_rate,
        });
        app.insert_resource(queue);
        app.world_mut().spawn((AudioPlayer::<HandheldAudio>(handle), PlaybackSettings::ONCE));
    }
}

fn keyboard(
    keyboard: Option<Res<ButtonInput<KeyCode>>>,
    map: Res<HandheldKeyMap>,
    mut input: ResMut<HandheldInput>,
) {
    let Some(keyboard) = keyboard else { return };
    input.0.buttons = map
        .0
        .iter()
        .filter(|(key, _)| keyboard.pressed(*key))
        .fold(0, |acc, (_, bit)| acc | bit);
}

fn run(
    slot: Option<NonSendMut<HandheldSlot>>,
    input: Res<HandheldInput>,
    mut status: ResMut<HandheldStatus>,
    screens: Res<HandheldScreens>,
    mut images: ResMut<Assets<Image>>,
    mut events: MessageWriter<HandheldEvent>,
    audio: Option<Res<HandheldAudioQueue>>,
    mut scratch: Local<Vec<f32>>,
) {
    let Some(mut slot) = slot else { return };
    if status.stopped || status.paused {
        return;
    }
    let machine = &mut *slot.0;
    machine.set_input(&input.0);
    match machine.run_frame() {
        Step::Frame => {
            status.frames += 1;
            events.write(HandheldEvent::Frame(status.frames));
            for (id, handle) in [(ScreenId::Top, &screens.top), (ScreenId::Bottom, &screens.bottom)] {
                let picture = machine.image(id);
                if let Some(mut image) = images.get_mut(handle) {
                    match image.data.as_mut() {
                        Some(data) if data.len() == picture.rgba.len() => {
                            data.copy_from_slice(&picture.rgba);
                        }
                        _ => image.data = Some(picture.rgba.to_vec()),
                    }
                }
            }
        }
        Step::Shutdown => {
            status.stopped = true;
            events.write(HandheldEvent::Shutdown);
        }
        Step::Fault(why) => {
            status.stopped = true;
            events.write(HandheldEvent::Fault(why));
        }
    }
    scratch.clear();
    machine.take_audio(&mut scratch);
    if let Some(audio) = audio
        && !scratch.is_empty()
    {
        audio.push(&scratch);
    }
}

fn state_files(
    slot: Option<NonSendMut<HandheldSlot>>,
    mut saves: MessageReader<SaveHandheldState>,
    mut loads: MessageReader<LoadHandheldState>,
    mut events: MessageWriter<HandheldEvent>,
) {
    let Some(mut slot) = slot else { return };
    for SaveHandheldState(path) in saves.read() {
        let result = slot
            .0
            .save_state()
            .map_err(|e| e.to_string())
            .and_then(|state| std::fs::write(path, state).map_err(|e| e.to_string()))
            .map(|()| path.clone());
        events.write(HandheldEvent::StateSaved(result));
    }
    for LoadHandheldState(path) in loads.read() {
        let result = std::fs::read(path)
            .map_err(|e| e.to_string())
            .and_then(|state| slot.0.load_state(&state).map_err(|e| e.to_string()))
            .map(|()| path.clone());
        events.write(HandheldEvent::StateLoaded(result));
    }
}

/// Queue bound: about this much audio may wait for the sink.
const MAX_LATENCY_MS: usize = 60;

struct Shared {
    samples: Mutex<VecDeque<f32>>,
    max: usize,
}

/// Producer side of the audio sink.
#[derive(Resource, Clone)]
pub struct HandheldAudioQueue {
    shared: Arc<Shared>,
}

impl HandheldAudioQueue {
    fn new(sample_rate: u32) -> Self {
        let max = (sample_rate as usize * 2 * MAX_LATENCY_MS / 1000).max(512);
        Self { shared: Arc::new(Shared { samples: Mutex::new(VecDeque::with_capacity(max * 2)), max }) }
    }

    /// Append interleaved stereo samples; the oldest are dropped past the latency bound.
    pub fn push(&self, samples: &[f32]) {
        let mut queue = self.shared.samples.lock().unwrap();
        queue.extend(samples.iter().copied());
        let excess = queue.len().saturating_sub(self.shared.max);
        queue.drain(..excess & !1);
    }
}

/// Endless stereo stream for `AudioPlayer<HandheldAudio>`; underruns play silence.
#[derive(Asset, TypePath)]
pub struct HandheldAudio {
    shared: Arc<Shared>,
    sample_rate: u32,
}

pub struct HandheldAudioSource {
    shared: Arc<Shared>,
    sample_rate: u32,
    local: VecDeque<f32>,
}

impl Iterator for HandheldAudioSource {
    type Item = bevy::audio::Sample;

    fn next(&mut self) -> Option<Self::Item> {
        if self.local.is_empty() {
            let mut queue = self.shared.samples.lock().unwrap();
            let n = queue.len().min(256) & !1;
            self.local.extend(queue.drain(..n));
        }
        Some(self.local.pop_front().unwrap_or(0.0) as _)
    }
}

impl Source for HandheldAudioSource {
    fn current_span_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> ChannelCount {
        NonZero::new(2).unwrap()
    }

    fn sample_rate(&self) -> SampleRate {
        NonZero::new(self.sample_rate.max(1)).unwrap()
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

impl Decodable for HandheldAudio {
    type Decoder = HandheldAudioSource;

    fn decoder(&self) -> Self::Decoder {
        HandheldAudioSource {
            shared: self.shared.clone(),
            sample_rate: self.sample_rate,
            local: VecDeque::new(),
        }
    }
}
