//! Runtimes for console code statically recompiled by `bunre recompile` (crates/re, bun-re
//! pipeline: lift -> IR -> emit -> rebuild -> verify).
//!
//! Generated crates contain one Rust function per translated block and a `lookup` table; each
//! machine runtime below provides the handle (`Rt`) those functions call into - registers, flags,
//! bus accesses, pipeline and timing bookkeeping of the real device model - and the dispatcher the
//! core calls in place of an interpreter step. Addresses without a translated block, and
//! instructions the lifter hands back (`Fallback`), run in the core interpreter, so recompiled
//! programs always run (hybrid static recompilation).

#[cfg(feature = "gba")]
pub mod gba;
#[cfg(feature = "nes")]
pub mod nes;
#[cfg(feature = "psx")]
pub mod psx;
pub mod wasm;

use std::sync::atomic::{AtomicU64, Ordering};

use crate::machine::{Input, Machine, Step, keys};

static NATIVE: AtomicU64 = AtomicU64::new(0);
static INTERPRETED: AtomicU64 = AtomicU64::new(0);
static FALLBACKS: AtomicU64 = AtomicU64::new(0);
static ENTRIES: AtomicU64 = AtomicU64::new(0);

/// Execution counters of the recompiled runtime.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Stats {
    /// Instructions executed by translated code.
    pub native: u64,
    /// Interpreter steps for addresses without a translated block.
    pub interpreted: u64,
    /// Instructions handed back to the interpreter by translated blocks.
    pub fallbacks: u64,
    /// Block entries.
    pub entries: u64,
}

impl Stats {
    /// Share of executed instructions run by translated code.
    #[must_use]
    pub fn native_ratio(&self) -> f64 {
        let total = self.native + self.interpreted + self.fallbacks;
        if total == 0 {
            0.0
        } else {
            self.native as f64 / total as f64
        }
    }
}

/// Current counters.
#[must_use]
pub fn stats() -> Stats {
    Stats {
        native: NATIVE.load(Ordering::Relaxed),
        interpreted: INTERPRETED.load(Ordering::Relaxed),
        fallbacks: FALLBACKS.load(Ordering::Relaxed),
        entries: ENTRIES.load(Ordering::Relaxed),
    }
}

pub(crate) fn count_entries(native: u64, entries: u64, fallback: bool) {
    NATIVE.fetch_add(native, Ordering::Relaxed);
    ENTRIES.fetch_add(entries, Ordering::Relaxed);
    if fallback {
        FALLBACKS.fetch_add(1, Ordering::Relaxed);
    }
}

pub(crate) fn count_interpreted(n: u64) {
    INTERPRETED.fetch_add(n, Ordering::Relaxed);
}

/// Factory of a recompiled machine; `interp = true` builds the same machine without the
/// translated code (pure interpreter), for comparisons.
pub type Factory = fn(bool) -> Result<Box<dyn Machine>, String>;

/// Scripted input: comma-separated `key@first[-last]` entries (frames, inclusive), keys
/// `a b select start right left up down r l x y`.
pub fn parse_input(spec: &str) -> Result<Vec<(u32, u64, u64)>, String> {
    spec.split(',')
        .filter(|e| !e.trim().is_empty())
        .map(|e| {
            let (key, range) = e
                .trim()
                .split_once('@')
                .ok_or_else(|| format!("input `{e}`: expected key@frame[-frame]"))?;
            let mask = match key.to_ascii_lowercase().as_str() {
                "a" => keys::A,
                "b" => keys::B,
                "select" => keys::SELECT,
                "start" => keys::START,
                "right" => keys::RIGHT,
                "left" => keys::LEFT,
                "up" => keys::UP,
                "down" => keys::DOWN,
                "r" => keys::R,
                "l" => keys::L,
                "x" => keys::X,
                "y" => keys::Y,
                other => return Err(format!("input `{e}`: unknown key `{other}`")),
            };
            let (first, last) = range.split_once('-').unwrap_or((range, range));
            let num = |v: &str| {
                v.trim()
                    .parse::<u64>()
                    .map_err(|_| format!("input `{e}`: bad frame `{v}`"))
            };
            Ok((mask, num(first)?, num(last)?))
        })
        .collect()
}

/// Keys held at `frame` by a parsed input script.
#[must_use]
pub fn keys_at(script: &[(u32, u64, u64)], frame: u64) -> u32 {
    script
        .iter()
        .filter(|(_, a, b)| (*a..=*b).contains(&frame))
        .fold(0, |k, (m, _, _)| k | m)
}

/// Command line of a generated recompiled executable:
/// `[--frames N] [--out DIR] [--interp] [--input SCRIPT] [--json]`.
pub fn cli(factory: Factory, blocks: usize, insns: usize) -> std::process::ExitCode {
    let mut frames = 600_u64;
    let mut out = None::<std::path::PathBuf>;
    let mut interp = false;
    let mut json = false;
    let mut script = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--frames" => frames = args.next().and_then(|v| v.parse().ok()).unwrap_or(frames),
            "--out" => out = args.next().map(Into::into),
            "--interp" => interp = true,
            "--json" => json = true,
            "--input" => match parse_input(&args.next().unwrap_or_default()) {
                Ok(s) => script = s,
                Err(e) => {
                    eprintln!("recompiled: {e}");
                    return std::process::ExitCode::from(2);
                }
            },
            _ => {
                eprintln!(
                    "usage: [--frames N] [--out DIR] [--interp] [--input key@first[-last],...] [--json]"
                );
                return std::process::ExitCode::from(2);
            }
        }
    }
    let mut machine = match factory(interp) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("recompiled: {e}");
            return std::process::ExitCode::FAILURE;
        }
    };
    let started = std::time::Instant::now();
    let mut done = 0;
    let mut console = Vec::new();
    while done < frames {
        if !script.is_empty() {
            machine.set_input(Input {
                keys: keys_at(&script, done),
                touch: None,
            });
        }
        match machine.run_frame() {
            Step::Frame => done += 1,
            Step::Shutdown => break,
            Step::Stopped => {}
        }
        console.extend(machine.console());
    }
    let elapsed = started.elapsed().as_secs_f64();
    if let Some(dir) = &out
        && let Err(e) = crate::machine::write_screens(dir, &machine.screens())
    {
        eprintln!("recompiled: {}: {e}", dir.display());
        return std::process::ExitCode::FAILURE;
    }
    let s = stats();
    if json {
        println!(
            "{{\"machine\":\"{}\",\"frames\":{done},\"seconds\":{elapsed:.3},\"interp\":{interp},\"blocks\":{blocks},\"insns\":{insns},\"native\":{},\"interpreted\":{},\"fallbacks\":{},\"entries\":{},\"nativeRatio\":{:.6},\"console\":{:?}}}",
            machine.name(),
            s.native,
            s.interpreted,
            s.fallbacks,
            s.entries,
            s.native_ratio(),
            String::from_utf8_lossy(&console)
        );
    } else {
        use std::io::Write;
        let _ = std::io::stdout().write_all(&console);
        println!(
            "{}: {done} frames in {elapsed:.2}s ({}), {blocks} blocks / {insns} instructions translated; executed {} native, {} interpreted, {} fallbacks ({:.1}% native)",
            machine.name(),
            if interp {
                "interpreter only"
            } else {
                "recompiled"
            },
            s.native,
            s.interpreted,
            s.fallbacks,
            s.native_ratio() * 100.0
        );
    }
    std::process::ExitCode::SUCCESS
}

/// Run `machine` for `frames` frames (used by the WebAssembly entry points).
pub(crate) fn run_frames(machine: &mut dyn Machine, frames: u32) -> u32 {
    let mut done = 0;
    while done < frames {
        match machine.run_frame() {
            Step::Frame => done += 1,
            Step::Shutdown => break,
            Step::Stopped => {}
        }
    }
    done
}
