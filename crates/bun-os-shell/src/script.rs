//! UI frame-time statistics and the `--script` driver used for qualification runs: a comma list of
//! steps (`wait:MS`, `left|right|up|down`, `accept`, `back`, `guide`, `prev`, `next`,
//! `shot:NAME`, `play:KEY`, `exit`) injected as the same intents real input produces.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::time::Instant;

use bevy::math::CompassOctant;
use bevy::prelude::*;

use crate::ui::{Activate, Intent};

#[derive(Resource, Default)]
pub struct Stats {
    /// Frame intervals in milliseconds (bounded ring).
    pub frames: VecDeque<f32>,
    pub all: Vec<f32>,
    pub started: Option<Instant>,
}

impl Stats {
    pub fn mean_ms(&self) -> f32 {
        if self.frames.is_empty() {
            0.0
        } else {
            self.frames.iter().sum::<f32>() / self.frames.len() as f32
        }
    }

    pub fn fps(&self) -> f32 {
        let mean = self.mean_ms();
        if mean > 0.0 { 1000.0 / mean } else { 0.0 }
    }

    fn percentile(values: &[f32], p: f32) -> f32 {
        if values.is_empty() {
            return 0.0;
        }
        let mut sorted = values.to_vec();
        sorted.sort_by(|a, b| a.total_cmp(b));
        sorted[((sorted.len() - 1) as f32 * p).round() as usize]
    }

    pub fn p99_ms(&self) -> f32 {
        Self::percentile(&self.frames.iter().copied().collect::<Vec<_>>(), 0.99)
    }

    pub fn report(&self) -> serde_json::Value {
        let v = &self.all;
        let mean = if v.is_empty() {
            0.0
        } else {
            v.iter().sum::<f32>() / v.len() as f32
        };
        serde_json::json!({
            "frames": v.len(),
            "meanMs": mean,
            "fps": if mean > 0.0 { 1000.0 / mean } else { 0.0 },
            "p50Ms": Self::percentile(v, 0.5),
            "p95Ms": Self::percentile(v, 0.95),
            "p99Ms": Self::percentile(v, 0.99),
            "maxMs": v.iter().copied().fold(0.0, f32::max),
            "over16_7ms": v.iter().filter(|&&f| f > 16.7).count(),
            "over33ms": v.iter().filter(|&&f| f > 33.4).count(),
        })
    }
}

pub fn record_frame(time: Res<Time<Real>>, mut stats: ResMut<Stats>) {
    let ms = time.delta_secs() * 1000.0;
    if ms <= 0.0 {
        return;
    }
    stats.started.get_or_insert_with(Instant::now);
    if stats.frames.len() == 240 {
        stats.frames.pop_front();
    }
    stats.frames.push_back(ms);
    // Skip the first second (pipeline warm-up, first texture uploads).
    if stats
        .started
        .is_some_and(|s| s.elapsed().as_secs_f32() > 1.0)
    {
        stats.all.push(ms);
    }
}

#[derive(Clone, Debug)]
pub enum Step {
    Wait(f32),
    Intent(Intent),
    Shot(String),
    Play(String),
    Exit,
}

#[derive(Resource, Default)]
pub struct Script {
    pub steps: VecDeque<Step>,
    pub wait: f32,
    pub shots: PathBuf,
    pub stats_path: Option<PathBuf>,
    pub log: Vec<String>,
}

impl Script {
    pub fn parse(text: &str) -> VecDeque<Step> {
        text.split(',')
            .filter_map(|s| {
                let s = s.trim();
                let (name, arg) = s.split_once(':').unwrap_or((s, ""));
                Some(match name {
                    "wait" => Step::Wait(arg.parse::<f32>().unwrap_or(500.0) / 1000.0),
                    "left" => Step::Intent(Intent::Move(CompassOctant::West)),
                    "right" => Step::Intent(Intent::Move(CompassOctant::East)),
                    "up" => Step::Intent(Intent::Move(CompassOctant::North)),
                    "down" => Step::Intent(Intent::Move(CompassOctant::South)),
                    "accept" => Step::Intent(Intent::Accept),
                    "back" => Step::Intent(Intent::Back),
                    "guide" => Step::Intent(Intent::Guide),
                    "prev" => Step::Intent(Intent::PrevTab),
                    "next" => Step::Intent(Intent::NextTab),
                    "shot" => Step::Shot(arg.to_string()),
                    "play" => Step::Play(arg.to_string()),
                    "exit" => Step::Exit,
                    "" => return None,
                    other => {
                        eprintln!("bun-os-shell: unknown script step `{other}`");
                        return None;
                    }
                })
            })
            .collect()
    }
}

pub fn run_script(
    time: Res<Time>,
    mut script: ResMut<Script>,
    mut intents: MessageWriter<Intent>,
    mut activate: MessageWriter<Activate>,
    mut commands: Commands,
    shell: Res<crate::app::Shell>,
    mut exit: MessageWriter<AppExit>,
    screen: Res<State<crate::app::Screen>>,
) {
    if script.wait > 0.0 {
        script.wait -= time.delta_secs();
        return;
    }
    let Some(step) = script.steps.pop_front() else {
        return;
    };
    let line = format!(
        "{:>8.3}s {:?} [{:?}]",
        time.elapsed_secs(),
        step,
        screen.get()
    );
    script.log.push(line);
    match step {
        Step::Wait(seconds) => script.wait = seconds,
        Step::Intent(intent) => {
            intents.write(intent);
            script.wait = 0.25;
        }
        Step::Shot(name) => {
            let path = script.shots.join(format!("{name}.png"));
            crate::runtime::screenshot(&mut commands, path);
            script.wait = 0.3;
        }
        Step::Play(key) => {
            if let Some(i) = shell
                .library
                .games
                .iter()
                .position(|g| g.key == key || g.title.eq_ignore_ascii_case(&key))
            {
                activate.write(Activate(crate::app::Action::Play(i)));
            } else {
                script.log.push(format!("no game `{key}`"));
            }
            script.wait = 0.5;
        }
        Step::Exit => {
            exit.write(AppExit::Success);
        }
    }
}

/// Writes the frame-time report and the script log when the app exits.
pub fn write_report(
    mut exits: MessageReader<AppExit>,
    stats: Res<Stats>,
    script: Res<Script>,
    running: Res<crate::runtime::Running>,
) {
    if exits.read().next().is_none() {
        return;
    }
    let mut report = stats.report();
    if let Some(info) = crate::runtime::machine_info(&running) {
        report["machine"] = serde_json::json!({
            "name": info.name, "fps": info.fps, "refreshHz": info.refresh, "frames": info.frames, "paused": info.paused,
            "resumedFromDisk": info.resumed_from_disk, "error": info.error,
        });
    }
    report["script"] = serde_json::json!(script.log);
    println!(
        "{}",
        serde_json::to_string_pretty(&report).unwrap_or_default()
    );
    if let Some(path) = &script.stats_path {
        let _ = std::fs::write(
            path,
            serde_json::to_string_pretty(&report).unwrap_or_default(),
        );
    }
}
