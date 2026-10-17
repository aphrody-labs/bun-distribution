//! Machine audio on a Bevy audio sink: `Machine::audio` samples go into a bounded queue that a
//! rodio source (the [`MachineAudio`] `Decodable` asset) drains on the audio thread. Underruns
//! play silence; overruns drop the oldest samples so latency stays near [`MAX_LATENCY_MS`].

use std::{
    collections::VecDeque,
    num::NonZero,
    sync::{Arc, Mutex},
    time::Duration,
};

use crate::bevy::{
    app::App,
    asset::{Asset, Assets},
    audio::{
        AddAudioSource, AudioPlayer, ChannelCount, Decodable, PlaybackSettings, SampleRate, Source,
    },
    ecs::prelude::*,
    reflect::TypePath,
};

use crate::machine::Machine;

/// Queue bound: about this much audio may wait for the sink.
pub const MAX_LATENCY_MS: u32 = 60;

struct Shared {
    samples: Mutex<VecDeque<f32>>,
    max: usize,
}

/// The producer side, a resource of the main world.
#[derive(Resource, Clone)]
pub struct MachineAudioQueue {
    shared: Arc<Shared>,
    scratch: Arc<Mutex<Vec<f32>>>,
    pub sample_rate: u32,
}

impl MachineAudioQueue {
    pub fn new(sample_rate: u32) -> Self {
        let max = (sample_rate as usize * 2 * MAX_LATENCY_MS as usize / 1000).max(512);
        Self {
            shared: Arc::new(Shared {
                samples: Mutex::new(VecDeque::with_capacity(max * 2)),
                max,
            }),
            scratch: Arc::new(Mutex::new(Vec::new())),
            sample_rate,
        }
    }

    /// Append interleaved stereo samples.
    pub fn push(&self, samples: &[f32]) {
        let mut queue = self.shared.samples.lock().unwrap();
        queue.extend(samples.iter().copied());
        let excess = queue.len().saturating_sub(self.shared.max);
        // Keep stereo pairs aligned.
        queue.drain(..excess & !1);
    }

    /// Move what `machine` produced since the last frame into the queue.
    pub fn drain_from(&self, machine: &mut dyn Machine) {
        let mut scratch = self.scratch.lock().unwrap();
        scratch.clear();
        machine.audio(&mut scratch);
        if !scratch.is_empty() {
            self.push(&scratch);
        }
    }
}

/// The consumer side: an endless stereo stream for `AudioPlayer<MachineAudio>`.
#[derive(Asset, TypePath)]
pub struct MachineAudio {
    shared: Arc<Shared>,
    sample_rate: u32,
}

pub struct MachineAudioSource {
    shared: Arc<Shared>,
    sample_rate: u32,
    local: VecDeque<f32>,
}

impl Iterator for MachineAudioSource {
    type Item = crate::bevy::audio::Sample;

    fn next(&mut self) -> Option<Self::Item> {
        if self.local.is_empty() {
            // Take a small batch per lock; silence on underrun keeps the sink alive.
            let mut queue = self.shared.samples.lock().unwrap();
            let n = queue.len().min(256) & !1;
            self.local.extend(queue.drain(..n));
        }
        Some(self.local.pop_front().unwrap_or(0.0) as _)
    }
}

impl Source for MachineAudioSource {
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

impl Decodable for MachineAudio {
    type Decoder = MachineAudioSource;

    fn decoder(&self) -> Self::Decoder {
        MachineAudioSource {
            shared: self.shared.clone(),
            sample_rate: self.sample_rate,
            local: VecDeque::new(),
        }
    }
}

/// Marker of the machine's audio sink entity.
#[derive(Component, Clone, Copy, Debug, Default)]
pub struct MachineAudioSink;

pub(super) fn register(app: &mut App) {
    app.add_audio_source::<MachineAudio>();
}

/// Install the queue and spawn the sink for a machine producing `sample_rate` Hz stereo.
pub(super) fn install(world: &mut World, sample_rate: u32) {
    let Some(mut assets) = world.get_resource_mut::<Assets<MachineAudio>>() else {
        return;
    };
    let queue = MachineAudioQueue::new(sample_rate);
    let handle = assets.add(MachineAudio {
        shared: queue.shared.clone(),
        sample_rate,
    });
    world.insert_resource(queue);
    world.spawn((
        AudioPlayer::<MachineAudio>(handle),
        PlaybackSettings::ONCE,
        MachineAudioSink,
    ));
}

pub(super) fn uninstall(world: &mut World) {
    world.remove_resource::<MachineAudioQueue>();
    let sinks: Vec<Entity> = world
        .query_filtered::<Entity, With<MachineAudioSink>>()
        .iter(world)
        .collect();
    for entity in sinks {
        world.despawn(entity);
    }
}
