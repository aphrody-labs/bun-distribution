//! Per-frame latency samples and their summaries (HUD and the final report).

use std::{
    collections::VecDeque,
    time::{Duration, Instant},
};

/// One presented frame, in milliseconds.
#[derive(Clone, Copy, Debug, Default)]
pub struct Sample {
    /// First packet to complete access unit (network burst + FEC reassembly).
    pub net: f64,
    /// Access unit queued to the decoder until it starts decoding.
    pub queue: f64,
    /// Decoder submission (ProcessInput .. GPU copy queued).
    pub decode: f64,
    /// Decoder submission until the GPU finished decoding and copying into the shared ring.
    pub decode_gpu: Option<f64>,
    /// GPU work of the presenter once the decoded picture was ready (EASU + RCAS + HUD).
    pub present_gpu: Option<f64>,
    /// Decoded until the renderer picked it up.
    pub wait: f64,
    /// CPU time to record and submit EASU + RCAS.
    pub render: f64,
    /// Submit until the GPU finished the frame (includes waiting on the decode fence).
    pub gpu: f64,
    /// First packet received until the frame was ready to flip.
    pub recv_to_glass: f64,
    /// Loopback only: capture of the synthetic frame until ready to flip.
    pub capture_to_glass: Option<f64>,
    /// Loopback only: encoder time.
    pub encode: Option<f64>,
    /// Host-reported processing latency.
    pub host: f64,
}

pub fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

pub fn between(a: Instant, b: Instant) -> f64 {
    ms(b.saturating_duration_since(a))
}

#[derive(Default)]
pub struct Stats {
    pub all: Vec<Sample>,
    recent: VecDeque<(Instant, Sample)>,
    pub presented: u64,
    pub first: Option<Instant>,
    pub last: Option<Instant>,
}

pub struct Summary {
    pub fps: f64,
    pub mean: Sample,
    pub p95_recv_to_glass: f64,
    pub p95_capture_to_glass: Option<f64>,
}

fn percentile(values: &mut [f64], p: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|a, b| a.total_cmp(b));
    let i = ((values.len() - 1) as f64 * p).round() as usize;
    values[i]
}

fn mean_of(samples: &[Sample]) -> Sample {
    let n = samples.len().max(1) as f64;
    let sum = |f: &dyn Fn(&Sample) -> f64| samples.iter().map(f).sum::<f64>() / n;
    let opt = |f: &dyn Fn(&Sample) -> Option<f64>| {
        let v: Vec<f64> = samples.iter().filter_map(f).collect();
        (!v.is_empty()).then(|| v.iter().sum::<f64>() / v.len() as f64)
    };
    Sample {
        net: sum(&|s| s.net),
        queue: sum(&|s| s.queue),
        decode: sum(&|s| s.decode),
        decode_gpu: opt(&|s| s.decode_gpu),
        present_gpu: opt(&|s| s.present_gpu),
        wait: sum(&|s| s.wait),
        render: sum(&|s| s.render),
        gpu: sum(&|s| s.gpu),
        recv_to_glass: sum(&|s| s.recv_to_glass),
        capture_to_glass: opt(&|s| s.capture_to_glass),
        encode: opt(&|s| s.encode),
        host: sum(&|s| s.host),
    }
}

impl Stats {
    pub fn push(&mut self, at: Instant, sample: Sample) {
        self.presented += 1;
        self.first.get_or_insert(at);
        self.last = Some(at);
        self.all.push(sample);
        self.recent.push_back((at, sample));
        while self
            .recent
            .front()
            .is_some_and(|(t, _)| at.duration_since(*t) > Duration::from_secs(1))
        {
            self.recent.pop_front();
        }
    }

    /// Rolling one-second summary.
    pub fn recent(&self) -> Summary {
        let samples: Vec<Sample> = self.recent.iter().map(|(_, s)| *s).collect();
        let span = match (self.recent.front(), self.recent.back()) {
            (Some((a, _)), Some((b, _))) if self.recent.len() > 1 => {
                b.duration_since(*a).as_secs_f64()
            }
            _ => 0.0,
        };
        let fps = if span > 0.0 {
            (self.recent.len() - 1) as f64 / span
        } else {
            0.0
        };
        let mut r2g: Vec<f64> = samples.iter().map(|s| s.recv_to_glass).collect();
        let mut c2g: Vec<f64> = samples.iter().filter_map(|s| s.capture_to_glass).collect();
        Summary {
            fps,
            mean: mean_of(&samples),
            p95_recv_to_glass: percentile(&mut r2g, 0.95),
            p95_capture_to_glass: (!c2g.is_empty()).then(|| percentile(&mut c2g, 0.95)),
        }
    }

    /// Whole-run report.
    pub fn report(&self) -> String {
        if self.all.is_empty() {
            return "no frame was presented".into();
        }
        let span = match (self.first, self.last) {
            (Some(a), Some(b)) => b.duration_since(a).as_secs_f64(),
            _ => 0.0,
        };
        let fps = if span > 0.0 {
            (self.all.len() - 1) as f64 / span
        } else {
            0.0
        };
        let mut out = format!(
            "frames presented: {} over {:.2} s = {:.2} fps\n",
            self.all.len(),
            span,
            fps
        );
        let metrics: [(&str, Box<dyn Fn(&Sample) -> Option<f64>>); 12] = [
            ("encode (loopback host)", Box::new(|s| s.encode)),
            ("network + FEC reassembly", Box::new(|s| Some(s.net))),
            ("decoder queue", Box::new(|s| Some(s.queue))),
            ("decode submit (CPU)", Box::new(|s| Some(s.decode))),
            ("decode GPU (DXVA + NV12 copy)", Box::new(|s| s.decode_gpu)),
            ("decoded -> render", Box::new(|s| Some(s.wait))),
            ("render record+submit", Box::new(|s| Some(s.render))),
            ("submit -> GPU done", Box::new(|s| Some(s.gpu))),
            ("present GPU (EASU+RCAS+HUD)", Box::new(|s| s.present_gpu)),
            ("receive -> glass", Box::new(|s| Some(s.recv_to_glass))),
            (
                "capture -> glass (loopback)",
                Box::new(|s| s.capture_to_glass),
            ),
            ("host processing", Box::new(|s| Some(s.host))),
        ];
        out.push_str(&format!(
            "{:<32} {:>8} {:>8} {:>8} {:>8}\n",
            "stage (ms)", "mean", "p50", "p95", "p99"
        ));
        for (name, f) in metrics {
            let mut v: Vec<f64> = self.all.iter().filter_map(|s| f(s)).collect();
            if v.is_empty() {
                continue;
            }
            let mean = v.iter().sum::<f64>() / v.len() as f64;
            let (p50, p95, p99) = (
                percentile(&mut v, 0.5),
                percentile(&mut v, 0.95),
                percentile(&mut v, 0.99),
            );
            out.push_str(&format!(
                "{name:<32} {mean:>8.3} {p50:>8.3} {p95:>8.3} {p99:>8.3}\n"
            ));
        }
        out
    }
}
