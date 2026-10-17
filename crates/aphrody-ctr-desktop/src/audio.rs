//! Console sound on the default output device.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SizedSample};

/// Samples (console rate) kept queued, about 125 ms.
const TARGET: usize = 4096;

struct Queue {
    samples: VecDeque<[f32; 2]>,
    fraction: f64,
    step: f64,
    last: [f32; 2],
}

impl Queue {
    fn next(&mut self) -> [f32; 2] {
        if self.samples.len() < 2 {
            self.last = self.last.map(|v| v * 0.995);
            return self.last;
        }
        let (a, b) = (self.samples[0], self.samples[1]);
        let t = self.fraction as f32;
        let out = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        self.last = out;
        // A longer queue plays slightly faster, a shorter one slower.
        let error = (self.samples.len() as f64 - TARGET as f64) / TARGET as f64;
        self.fraction += self.step * (1.0 + error.clamp(-1.0, 1.0) * 0.005);
        while self.fraction >= 1.0 && self.samples.len() > 1 {
            self.samples.pop_front();
            self.fraction -= 1.0;
        }
        out
    }
}

/// An open output stream fed with console PCM.
pub struct Audio {
    queue: Arc<Mutex<Queue>>,
    _stream: cpal::Stream,
}

fn build<T: SizedSample + FromSample<f32>>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    queue: Arc<Mutex<Queue>>,
) -> Result<cpal::Stream, cpal::BuildStreamError> {
    let channels = usize::from(config.channels);
    device.build_output_stream(
        config,
        move |data: &mut [T], _| {
            let mut queue = queue.lock().unwrap_or_else(|e| e.into_inner());
            for frame in data.chunks_mut(channels) {
                let [l, r] = queue.next();
                for (i, out) in frame.iter_mut().enumerate() {
                    *out = T::from_sample(if i == 1 { r } else { l });
                }
            }
        },
        |error| eprintln!("audio: {error}"),
        None,
    )
}

impl Audio {
    /// Opens the default output device, or `None` when there is none.
    pub fn open() -> Option<Self> {
        let device = cpal::default_host().default_output_device()?;
        let supported = device.default_output_config().ok()?;
        let format = supported.sample_format();
        let config: cpal::StreamConfig = supported.into();
        let queue = Arc::new(Mutex::new(Queue {
            samples: VecDeque::new(),
            fraction: 0.0,
            step: aphrody_ctr_emu::AUDIO_SAMPLE_RATE / f64::from(config.sample_rate.0),
            last: [0.0; 2],
        }));
        let stream = match format {
            cpal::SampleFormat::F32 => build::<f32>(&device, &config, queue.clone()),
            cpal::SampleFormat::I16 => build::<i16>(&device, &config, queue.clone()),
            cpal::SampleFormat::U16 => build::<u16>(&device, &config, queue.clone()),
            _ => return None,
        }
        .ok()?;
        stream.play().ok()?;
        Some(Self {
            queue,
            _stream: stream,
        })
    }

    /// Queues console PCM, dropping the oldest samples when the host falls behind.
    pub fn push(&self, pcm: &[[i16; 2]]) {
        let mut queue = self.queue.lock().unwrap_or_else(|e| e.into_inner());
        queue
            .samples
            .extend(pcm.iter().map(|s| s.map(|v| f32::from(v) / 32768.0)));
        while queue.samples.len() > TARGET * 4 {
            queue.samples.pop_front();
        }
    }

    /// Samples currently queued.
    pub fn queued(&self) -> usize {
        self.queue
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .samples
            .len()
    }
}
