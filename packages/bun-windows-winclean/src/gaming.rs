// SPDX-License-Identifier: Apache-2.0
//! Gaming computer-use profile: low-latency game window capture and frame pacing, high-rate input
//! (raw relative mouse deltas, scan-code keys, timed sequences), Steam launch and focus through the
//! `bun-steam` owner, and the read-only gaming optimisation checks of the host.
//!
//! Windows uses Windows.Graphics.Capture on Direct3D 11 (`aphrody_capture::gpu`) and `SendInput`.
//! Linux drives an X11 display (Xvfb `:99` on the VPS session, `DISPLAY` otherwise) through
//! ImageMagick `import` and `xdotool` (XTEST); gamescope present timing is a later backend.
//!
//! The optimisation profile is read here and only changed by `gaming_profile_apply`, which requires
//! `confirm: true` and is meant to be run by the machine owner; every other tool is read-only.

use std::time::{Duration, Instant};

use base64::Engine as _;
use serde_json::{Value, json};

use crate::{SubsystemError, dispatch::failed};

const MAX_DURATION_MS: u64 = 30_000;

fn duration_arg(args: &Value, default_ms: u64) -> Duration {
    Duration::from_millis(
        args.get("durationMs")
            .and_then(Value::as_u64)
            .unwrap_or(default_ms)
            .clamp(100, MAX_DURATION_MS),
    )
}

fn invalid(message: impl Into<String>) -> SubsystemError {
    SubsystemError::InvalidArguments(message.into())
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

/// Sleeps until `deadline` with millisecond sleeps and a short spin, for sub-millisecond pacing.
fn sleep_until(deadline: Instant) {
    loop {
        let now = Instant::now();
        if now >= deadline {
            return;
        }
        let left = deadline - now;
        if left > Duration::from_micros(1500) {
            std::thread::sleep(left - Duration::from_millis(1));
        } else {
            std::hint::spin_loop();
        }
    }
}

// ─── key names ───────────────────────────────────────────────────────────────

/// A key: PC set-1 scan code (US-QWERTY physical position), extended flag and X11 keysym.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GameKey {
    pub scan: u16,
    pub extended: bool,
    pub keysym: &'static str,
}

const KEYS: &[(&str, u16, bool, &str)] = &[
    ("escape", 0x01, false, "Escape"),
    ("esc", 0x01, false, "Escape"),
    ("1", 0x02, false, "1"),
    ("2", 0x03, false, "2"),
    ("3", 0x04, false, "3"),
    ("4", 0x05, false, "4"),
    ("5", 0x06, false, "5"),
    ("6", 0x07, false, "6"),
    ("7", 0x08, false, "7"),
    ("8", 0x09, false, "8"),
    ("9", 0x0A, false, "9"),
    ("0", 0x0B, false, "0"),
    ("backspace", 0x0E, false, "BackSpace"),
    ("tab", 0x0F, false, "Tab"),
    ("q", 0x10, false, "q"),
    ("w", 0x11, false, "w"),
    ("e", 0x12, false, "e"),
    ("r", 0x13, false, "r"),
    ("t", 0x14, false, "t"),
    ("y", 0x15, false, "y"),
    ("u", 0x16, false, "u"),
    ("i", 0x17, false, "i"),
    ("o", 0x18, false, "o"),
    ("p", 0x19, false, "p"),
    ("enter", 0x1C, false, "Return"),
    ("return", 0x1C, false, "Return"),
    ("ctrl", 0x1D, false, "Control_L"),
    ("control", 0x1D, false, "Control_L"),
    ("a", 0x1E, false, "a"),
    ("s", 0x1F, false, "s"),
    ("d", 0x20, false, "d"),
    ("f", 0x21, false, "f"),
    ("g", 0x22, false, "g"),
    ("h", 0x23, false, "h"),
    ("j", 0x24, false, "j"),
    ("k", 0x25, false, "k"),
    ("l", 0x26, false, "l"),
    ("shift", 0x2A, false, "Shift_L"),
    ("z", 0x2C, false, "z"),
    ("x", 0x2D, false, "x"),
    ("c", 0x2E, false, "c"),
    ("v", 0x2F, false, "v"),
    ("b", 0x30, false, "b"),
    ("n", 0x31, false, "n"),
    ("m", 0x32, false, "m"),
    ("rshift", 0x36, false, "Shift_R"),
    ("alt", 0x38, false, "Alt_L"),
    ("space", 0x39, false, "space"),
    ("capslock", 0x3A, false, "Caps_Lock"),
    ("f1", 0x3B, false, "F1"),
    ("f2", 0x3C, false, "F2"),
    ("f3", 0x3D, false, "F3"),
    ("f4", 0x3E, false, "F4"),
    ("f5", 0x3F, false, "F5"),
    ("f6", 0x40, false, "F6"),
    ("f7", 0x41, false, "F7"),
    ("f8", 0x42, false, "F8"),
    ("f9", 0x43, false, "F9"),
    ("f10", 0x44, false, "F10"),
    ("f11", 0x57, false, "F11"),
    ("f12", 0x58, false, "F12"),
    ("home", 0x47, true, "Home"),
    ("up", 0x48, true, "Up"),
    ("pageup", 0x49, true, "Prior"),
    ("left", 0x4B, true, "Left"),
    ("right", 0x4D, true, "Right"),
    ("end", 0x4F, true, "End"),
    ("down", 0x50, true, "Down"),
    ("pagedown", 0x51, true, "Next"),
    ("insert", 0x52, true, "Insert"),
    ("delete", 0x53, true, "Delete"),
];

/// Resolves a key name (US-QWERTY physical position, as games bind keys) or `scanCode`.
pub fn resolve_key(args: &Value) -> Result<GameKey, SubsystemError> {
    if let Some(scan) = args.get("scanCode").and_then(Value::as_u64) {
        let scan = u16::try_from(scan).map_err(|_| invalid("scanCode out of range"))?;
        let extended = args
            .get("extended")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let keysym = KEYS
            .iter()
            .find(|k| k.1 == scan && k.2 == extended)
            .map_or("", |k| k.3);
        return Ok(GameKey {
            scan,
            extended,
            keysym,
        });
    }
    let name = args
        .get("key")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("key or scanCode is required"))?
        .trim()
        .to_ascii_lowercase();
    KEYS.iter()
        .find(|k| k.0 == name)
        .map(|k| GameKey {
            scan: k.1,
            extended: k.2,
            keysym: k.3,
        })
        .ok_or_else(|| invalid(format!("unknown key '{name}'; use scanCode for other keys")))
}

// ─── platform backend ────────────────────────────────────────────────────────

#[cfg(windows)]
mod backend {
    use super::*;
    use windows::Win32::{Foundation::POINT, UI::WindowsAndMessaging::GetCursorPos};

    pub(super) const NAME: &str = "windows";

    pub(super) fn cursor() -> Option<(i32, i32)> {
        let mut point = POINT::default();
        // Safety: `point` is a valid out-parameter.
        unsafe { GetCursorPos(&mut point) }
            .ok()
            .map(|()| (point.x, point.y))
    }

    pub(super) fn mouse_delta(dx: i32, dy: i32) -> Result<(), SubsystemError> {
        aphrody_capture::mouse_move_relative(dx, dy).map_err(failed)
    }

    pub(super) fn mouse_button(button: &str, down: bool) -> Result<(), SubsystemError> {
        aphrody_capture::mouse_button_input(button, down).map_err(failed)
    }

    pub(super) fn key(key: GameKey, down: bool) -> Result<(), SubsystemError> {
        aphrody_capture::key_scan(key.scan, if down { "down" } else { "up" }, key.extended)
            .map_err(failed)
    }

    pub(super) fn capture_png(hwnd: usize) -> Result<(Vec<u8>, &'static str), SubsystemError> {
        match aphrody_capture::gpu::capture_window_png(hwnd) {
            Ok(png) => Ok((png, "windows-graphics-capture")),
            Err(gpu_error) => aphrody_capture::capture_window(hwnd)
                .map(|png| (png, "gdi-printwindow"))
                .map_err(|gdi| failed(format!("WGC: {gpu_error}; GDI: {gdi}"))),
        }
    }

    pub(super) fn focus(hwnd: usize) -> Result<(), SubsystemError> {
        aphrody_capture::switch_to_window(hwnd).map_err(failed)
    }

    pub(super) fn windows() -> Vec<(usize, u32, String)> {
        aphrody_capture::list_detailed_windows()
            .into_iter()
            .map(|w| (w.handle, w.process_id, w.title))
            .collect()
    }

    pub(super) fn foreground() -> Option<usize> {
        aphrody_capture::list_detailed_windows()
            .into_iter()
            .find(|w| w.is_foreground)
            .map(|w| w.handle)
    }

    pub(super) fn open_uri(uri: &str) -> Result<(), SubsystemError> {
        crate::system::shell_open(uri).map_err(failed)
    }
}

#[cfg(unix)]
mod backend {
    //! X11 backend over `xdotool` (XTEST) and ImageMagick `import`; works on Xvfb.
    use super::*;
    use aphrody_proc::NoWindow as _;
    use std::process::Command;

    pub(super) const NAME: &str = "x11";

    pub(super) fn display() -> String {
        std::env::var("BUN_GAMING_DISPLAY")
            .or_else(|_| std::env::var("DISPLAY"))
            .unwrap_or_else(|_| ":0".into())
    }

    fn run(program: &str, args: &[String]) -> Result<Vec<u8>, SubsystemError> {
        let output = Command::new(program)
            .no_window()
            .env("DISPLAY", display())
            .args(args)
            .output()
            .map_err(|error| failed(format!("{program}: {error}")))?;
        if output.status.success() {
            Ok(output.stdout)
        } else {
            Err(failed(format!(
                "{program}: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )))
        }
    }

    fn xdotool(args: &[&str]) -> Result<Vec<u8>, SubsystemError> {
        run(
            "xdotool",
            &args.iter().map(|a| (*a).to_owned()).collect::<Vec<_>>(),
        )
    }

    pub(super) fn cursor() -> Option<(i32, i32)> {
        let out = xdotool(&["getmouselocation", "--shell"]).ok()?;
        let text = String::from_utf8_lossy(&out);
        let field = |name: &str| {
            text.lines()
                .find_map(|l| l.strip_prefix(name))
                .and_then(|v| v.trim().parse().ok())
        };
        Some((field("X=")?, field("Y=")?))
    }

    pub(super) fn mouse_delta(dx: i32, dy: i32) -> Result<(), SubsystemError> {
        xdotool(&["mousemove_relative", "--", &dx.to_string(), &dy.to_string()]).map(drop)
    }

    fn button_number(button: &str) -> &'static str {
        match button.to_ascii_lowercase().as_str() {
            "right" => "3",
            "middle" => "2",
            _ => "1",
        }
    }

    pub(super) fn mouse_button(button: &str, down: bool) -> Result<(), SubsystemError> {
        xdotool(&[
            if down { "mousedown" } else { "mouseup" },
            button_number(button),
        ])
        .map(drop)
    }

    pub(super) fn key(key: GameKey, down: bool) -> Result<(), SubsystemError> {
        if key.keysym.is_empty() {
            return Err(invalid("this scan code has no X11 keysym mapping"));
        }
        xdotool(&[if down { "keydown" } else { "keyup" }, key.keysym]).map(drop)
    }

    pub(super) fn capture_png(window: usize) -> Result<(Vec<u8>, &'static str), SubsystemError> {
        let target = if window == 0 {
            "root".to_owned()
        } else {
            window.to_string()
        };
        run(
            "import",
            &["-silent".into(), "-window".into(), target, "png:-".into()],
        )
        .map(|png| (png, "x11-import"))
    }

    pub(super) fn focus(window: usize) -> Result<(), SubsystemError> {
        xdotool(&["windowactivate", "--sync", &window.to_string()]).map(drop)
    }

    pub(super) fn windows() -> Vec<(usize, u32, String)> {
        let Ok(out) = xdotool(&["search", "--onlyvisible", "--name", ""]) else {
            return Vec::new();
        };
        String::from_utf8_lossy(&out)
            .lines()
            .filter_map(|line| line.trim().parse::<usize>().ok())
            .map(|id| {
                let id_text = id.to_string();
                let title = xdotool(&["getwindowname", &id_text])
                    .map(|o| String::from_utf8_lossy(&o).trim().to_owned())
                    .unwrap_or_default();
                let pid = xdotool(&["getwindowpid", &id_text])
                    .ok()
                    .and_then(|o| String::from_utf8_lossy(&o).trim().parse().ok())
                    .unwrap_or(0);
                (id, pid, title)
            })
            .collect()
    }

    pub(super) fn foreground() -> Option<usize> {
        xdotool(&["getactivewindow"])
            .ok()
            .and_then(|o| String::from_utf8_lossy(&o).trim().parse().ok())
    }

    pub(super) fn open_uri(uri: &str) -> Result<(), SubsystemError> {
        let program = if std::path::Path::new("/usr/games/steam").exists() {
            "/usr/games/steam"
        } else {
            "xdg-open"
        };
        Command::new(program)
            .no_window()
            .env("DISPLAY", display())
            .arg(uri)
            .spawn()
            .map(drop)
            .map_err(|error| failed(format!("{program}: {error}")))
    }
}

#[cfg(not(any(windows, unix)))]
mod backend {
    use super::*;
    pub(super) const NAME: &str = "unsupported";
    fn no() -> SubsystemError {
        SubsystemError::Unavailable("gaming tools need Windows or X11".into())
    }
    pub(super) fn cursor() -> Option<(i32, i32)> {
        None
    }
    pub(super) fn mouse_delta(_: i32, _: i32) -> Result<(), SubsystemError> {
        Err(no())
    }
    pub(super) fn mouse_button(_: &str, _: bool) -> Result<(), SubsystemError> {
        Err(no())
    }
    pub(super) fn key(_: GameKey, _: bool) -> Result<(), SubsystemError> {
        Err(no())
    }
    pub(super) fn capture_png(_: usize) -> Result<(Vec<u8>, &'static str), SubsystemError> {
        Err(no())
    }
    pub(super) fn focus(_: usize) -> Result<(), SubsystemError> {
        Err(no())
    }
    pub(super) fn windows() -> Vec<(usize, u32, String)> {
        Vec::new()
    }
    pub(super) fn foreground() -> Option<usize> {
        None
    }
    pub(super) fn open_uri(_: &str) -> Result<(), SubsystemError> {
        Err(no())
    }
}

// ─── target window ───────────────────────────────────────────────────────────

/// `hwnd` (Windows HWND / X11 window id), else first window whose title contains `title`, else
/// the foreground window.
fn target_window(args: &Value) -> Result<(usize, String), SubsystemError> {
    let windows = backend::windows();
    if let Some(handle) = args.get("hwnd").and_then(Value::as_u64).filter(|h| *h != 0) {
        let handle = handle as usize;
        let title = windows
            .iter()
            .find(|w| w.0 == handle)
            .map(|w| w.2.clone())
            .unwrap_or_default();
        return Ok((handle, title));
    }
    if let Some(needle) = args
        .get("title")
        .and_then(Value::as_str)
        .filter(|t| !t.trim().is_empty())
    {
        let needle = needle.to_lowercase();
        return windows
            .into_iter()
            .find(|w| w.2.to_lowercase().contains(&needle))
            .map(|w| (w.0, w.2))
            .ok_or_else(|| failed(format!("no window title contains '{needle}'")));
    }
    let handle = backend::foreground().ok_or_else(|| failed("no foreground window"))?;
    let title = windows
        .iter()
        .find(|w| w.0 == handle)
        .map(|w| w.2.clone())
        .unwrap_or_default();
    Ok((handle, title))
}

/// Input guard: when `hwnd` or `title` is given, the window is brought to the foreground and the
/// input is refused unless it really is the foreground window, so keystrokes never land in
/// another application. Without a target the input goes to whatever has focus.
fn ensure_focus(args: &Value) -> Result<Option<usize>, SubsystemError> {
    let targeted = args
        .get("hwnd")
        .and_then(Value::as_u64)
        .is_some_and(|h| h != 0)
        || args
            .get("title")
            .and_then(Value::as_str)
            .is_some_and(|t| !t.trim().is_empty());
    if !targeted {
        return Ok(None);
    }
    let (handle, _) = target_window(args)?;
    if backend::foreground() != Some(handle) {
        let _ = backend::focus(handle);
        let deadline = Instant::now() + Duration::from_millis(500);
        while backend::foreground() != Some(handle) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    if backend::foreground() == Some(handle) {
        Ok(Some(handle))
    } else {
        Err(failed(format!(
            "window {handle} could not be brought to the foreground; input not sent"
        )))
    }
}

// ─── capture and pacing ──────────────────────────────────────────────────────

pub(crate) fn capture_window(args: &Value) -> Result<Value, SubsystemError> {
    let (handle, title) = target_window(args)?;
    let started = Instant::now();
    let (png, backend_name) = backend::capture_png(handle)?;
    let elapsed = started.elapsed().as_secs_f64() * 1000.0;
    if let Some(path) = args
        .get("outputPath")
        .and_then(Value::as_str)
        .filter(|p| !p.trim().is_empty())
    {
        std::fs::write(path, &png).map_err(failed)?;
    }
    let (width, height) = image::load_from_memory(&png)
        .map(|i| (i.width(), i.height()))
        .unwrap_or((0, 0));
    let mut result = json!({
        "hwnd": handle, "title": title, "backend": backend_name, "width": width, "height": height,
        "captureMs": round2(elapsed), "bytes": png.len(),
    });
    if args
        .get("includeImage")
        .and_then(Value::as_bool)
        .unwrap_or(true)
    {
        result["image"] = json!({"mimeType":"image/png","dataBase64":base64::engine::general_purpose::STANDARD.encode(&png)});
    }
    Ok(result)
}

/// Hash of a captured frame, for the X11 content-change estimate.
#[cfg(not(windows))]
fn frame_hash(bytes: &[u8]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

pub(crate) fn capture_benchmark(args: &Value) -> Result<Value, SubsystemError> {
    let (handle, title) = target_window(args)?;
    let duration = duration_arg(args, 3000);
    #[cfg(windows)]
    {
        let bench = aphrody_capture::gpu::capture_benchmark(handle, duration).map_err(failed)?;
        let mut result = json!({
            "hwnd": handle, "title": title, "backend": bench.backend, "width": bench.width, "height": bench.height,
            "durationMs": round2(bench.duration_ms), "grabs": bench.grabs, "grabFps": round2(bench.grab_fps),
            "grabAvgMs": round2(bench.grab_avg_ms), "grabP95Ms": round2(bench.grab_p95_ms), "grabMaxMs": round2(bench.grab_max_ms),
            "deliveredFrames": bench.delivered_frames, "deliveredFps": round2(bench.delivered_fps),
        });
        if args
            .get("compareGdi")
            .and_then(Value::as_bool)
            .unwrap_or(true)
        {
            let started = Instant::now();
            let mut grabs = 0u32;
            while started.elapsed() < duration.min(Duration::from_secs(3)) {
                std::hint::black_box(aphrody_capture::capture_window(handle).map_err(failed)?);
                grabs += 1;
            }
            let fps = f64::from(grabs) / started.elapsed().as_secs_f64();
            result["gdiPngFps"] = json!(round2(fps));
        }
        Ok(result)
    }
    #[cfg(not(windows))]
    {
        let started = Instant::now();
        let (mut grabs, mut changes, mut last) = (0u32, 0u32, None);
        while started.elapsed() < duration {
            let (png, _) = backend::capture_png(handle)?;
            let hash = frame_hash(&png);
            if last != Some(hash) {
                changes += 1;
                last = Some(hash);
            }
            grabs += 1;
        }
        let secs = started.elapsed().as_secs_f64();
        Ok(json!({
            "hwnd": handle, "title": title, "backend": "x11-import", "durationMs": round2(secs * 1000.0),
            "grabs": grabs, "grabFps": round2(f64::from(grabs) / secs),
            "deliveredFrames": changes, "deliveredFps": round2(f64::from(changes) / secs),
        }))
    }
}

pub(crate) fn frame_pacing(args: &Value) -> Result<Value, SubsystemError> {
    let (handle, title) = target_window(args)?;
    let duration = duration_arg(args, 3000);
    #[cfg(windows)]
    {
        let p = aphrody_capture::gpu::frame_pacing(handle, duration).map_err(failed)?;
        Ok(json!({
            "hwnd": handle, "title": title, "method": "wgc-present-timestamps", "width": p.width, "height": p.height,
            "frames": p.frames, "durationMs": round2(p.duration_ms), "fps": round2(p.fps),
            "frameTimeAvgMs": round2(p.frame_time_avg_ms), "frameTimeP50Ms": round2(p.frame_time_p50_ms),
            "frameTimeP95Ms": round2(p.frame_time_p95_ms), "frameTimeP99Ms": round2(p.frame_time_p99_ms),
            "frameTimeMinMs": round2(p.frame_time_min_ms), "frameTimeMaxMs": round2(p.frame_time_max_ms),
            "jitterMs": round2(p.jitter_ms), "onePercentLowFps": round2(p.one_percent_low_fps),
            "note": "DWM delivers a frame only when the window content changes; a static window reports ~0 fps.",
        }))
    }
    #[cfg(not(windows))]
    {
        let mut result =
            capture_benchmark(&json!({"hwnd": handle, "durationMs": duration.as_millis() as u64}))?;
        result["title"] = json!(title);
        result["method"] = json!("x11-content-change-sampling");
        result["note"] = json!(
            "Content-change rate bounded by the capture rate; gamescope present stats are the planned exact backend."
        );
        Ok(result)
    }
}

// ─── input ───────────────────────────────────────────────────────────────────

pub(crate) fn mouse_delta(args: &Value) -> Result<Value, SubsystemError> {
    let focused = ensure_focus(args)?;
    let dx = args.get("dx").and_then(Value::as_i64).unwrap_or(0);
    let dy = args.get("dy").and_then(Value::as_i64).unwrap_or(0);
    let steps = args
        .get("steps")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .clamp(1, 100_000);
    let rate = args
        .get("rateHz")
        .and_then(Value::as_u64)
        .unwrap_or(1000)
        .clamp(1, 8000);
    let before = backend::cursor();
    let interval = Duration::from_secs_f64(1.0 / rate as f64);
    let started = Instant::now();
    let (mut sent_x, mut sent_y) = (0i64, 0i64);
    for step in 1..=steps as i64 {
        // Distribute the total exactly: each step sends the rounding difference.
        let target_x = dx * step / steps as i64;
        let target_y = dy * step / steps as i64;
        backend::mouse_delta((target_x - sent_x) as i32, (target_y - sent_y) as i32)?;
        sent_x = target_x;
        sent_y = target_y;
        if step < steps as i64 {
            sleep_until(started + interval * step as u32);
        }
    }
    let elapsed = started.elapsed().as_secs_f64();
    let after = backend::cursor();
    Ok(json!({
        "backend": backend::NAME, "hwnd": focused, "dx": dx, "dy": dy, "events": steps, "elapsedMs": round2(elapsed * 1000.0),
        "achievedHz": if elapsed > 0.0 && steps > 1 { round2((steps - 1) as f64 / elapsed) } else { 0.0 },
        "cursorBefore": before.map(|(x, y)| json!({"x": x, "y": y})),
        "cursorAfter": after.map(|(x, y)| json!({"x": x, "y": y})),
    }))
}

fn hold(ms: u64) {
    if ms > 0 {
        sleep_until(Instant::now() + Duration::from_millis(ms.min(MAX_DURATION_MS)));
    }
}

pub(crate) fn mouse_button(args: &Value) -> Result<Value, SubsystemError> {
    let focused = ensure_focus(args)?;
    let button = args.get("button").and_then(Value::as_str).unwrap_or("left");
    let action = args
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("click");
    let hold_ms = args.get("holdMs").and_then(Value::as_u64).unwrap_or(30);
    match action {
        "down" => backend::mouse_button(button, true)?,
        "up" => backend::mouse_button(button, false)?,
        "click" => {
            backend::mouse_button(button, true)?;
            hold(hold_ms);
            backend::mouse_button(button, false)?;
        }
        _ => return Err(invalid("action must be down, up or click")),
    }
    Ok(json!({"backend": backend::NAME, "hwnd": focused, "button": button, "action": action}))
}

pub(crate) fn key(args: &Value) -> Result<Value, SubsystemError> {
    let focused = ensure_focus(args)?;
    let key = resolve_key(args)?;
    let action = args.get("action").and_then(Value::as_str).unwrap_or("tap");
    let hold_ms = args
        .get("holdMs")
        .and_then(Value::as_u64)
        .unwrap_or(if action == "hold" { 250 } else { 20 });
    let repeat = args
        .get("repeat")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .clamp(1, 1000);
    let started = Instant::now();
    for index in 0..repeat {
        match action {
            "down" => backend::key(key, true)?,
            "up" => backend::key(key, false)?,
            "tap" | "hold" => {
                backend::key(key, true)?;
                hold(hold_ms);
                backend::key(key, false)?;
            }
            _ => return Err(invalid("action must be down, up, tap or hold")),
        }
        if index + 1 < repeat {
            hold(args.get("intervalMs").and_then(Value::as_u64).unwrap_or(20));
        }
    }
    Ok(json!({
        "backend": backend::NAME, "hwnd": focused, "scanCode": key.scan, "extended": key.extended, "keysym": key.keysym,
        "action": action, "repeat": repeat, "elapsedMs": round2(started.elapsed().as_secs_f64() * 1000.0),
    }))
}

/// Timed sequence: `{type: move, dx, dy} | {type: key, key|scanCode, action: down|up|tap} |
/// {type: button, button, action: down|up|click} | {type: wait, ms}`, each optionally `atMs`
/// (offset from the sequence start) for deterministic timing.
pub(crate) fn input_sequence(args: &Value) -> Result<Value, SubsystemError> {
    let events = args
        .get("events")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("events array is required"))?;
    let focused = ensure_focus(args)?;
    if events.len() > 10_000 {
        return Err(invalid("at most 10000 events"));
    }
    let started = Instant::now();
    let mut lateness = Vec::new();
    for (index, event) in events.iter().enumerate() {
        if let Some(at) = event.get("atMs").and_then(Value::as_f64) {
            let deadline = started + Duration::from_secs_f64(at.max(0.0) / 1000.0);
            sleep_until(deadline);
            lateness.push(
                Instant::now()
                    .saturating_duration_since(deadline)
                    .as_secs_f64()
                    * 1000.0,
            );
        }
        let kind = event
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let outcome = match kind {
            "move" => backend::mouse_delta(
                event.get("dx").and_then(Value::as_i64).unwrap_or(0) as i32,
                event.get("dy").and_then(Value::as_i64).unwrap_or(0) as i32,
            ),
            "key" => {
                let key = resolve_key(event)?;
                match event.get("action").and_then(Value::as_str).unwrap_or("tap") {
                    "down" => backend::key(key, true),
                    "up" => backend::key(key, false),
                    _ => backend::key(key, true).and_then(|()| {
                        hold(event.get("holdMs").and_then(Value::as_u64).unwrap_or(20));
                        backend::key(key, false)
                    }),
                }
            }
            "button" => {
                let button = event
                    .get("button")
                    .and_then(Value::as_str)
                    .unwrap_or("left");
                match event
                    .get("action")
                    .and_then(Value::as_str)
                    .unwrap_or("click")
                {
                    "down" => backend::mouse_button(button, true),
                    "up" => backend::mouse_button(button, false),
                    _ => backend::mouse_button(button, true).and_then(|()| {
                        hold(event.get("holdMs").and_then(Value::as_u64).unwrap_or(30));
                        backend::mouse_button(button, false)
                    }),
                }
            }
            "wait" => {
                hold(event.get("ms").and_then(Value::as_u64).unwrap_or(0));
                Ok(())
            }
            _ => Err(invalid(format!(
                "event {index}: type must be move, key, button or wait"
            ))),
        };
        outcome.map_err(|error| failed(format!("event {index}: {error}")))?;
    }
    let max_late = lateness.iter().copied().fold(0.0, f64::max);
    Ok(json!({
        "backend": backend::NAME, "hwnd": focused, "events": events.len(), "elapsedMs": round2(started.elapsed().as_secs_f64() * 1000.0),
        "maxLatenessMs": round2(max_late),
    }))
}

// ─── environment and gamepad ────────────────────────────────────────────────

#[cfg(windows)]
fn xinput_slots() -> Value {
    use windows::Win32::UI::Input::XboxController::{XINPUT_STATE, XInputGetState};
    let slots: Vec<Value> = (0..4u32)
        .map(|slot| {
            let mut state = XINPUT_STATE::default();
            // Safety: `state` is a valid out-parameter; an empty slot returns an error code.
            let code = unsafe { XInputGetState(slot, &mut state) };
            if code == 0 {
                let pad = state.Gamepad;
                json!({"slot": slot, "connected": true, "packet": state.dwPacketNumber, "buttons": pad.wButtons.0,
                       "leftTrigger": pad.bLeftTrigger, "rightTrigger": pad.bRightTrigger,
                       "thumbLX": pad.sThumbLX, "thumbLY": pad.sThumbLY, "thumbRX": pad.sThumbRX, "thumbRY": pad.sThumbRY})
            } else {
                json!({"slot": slot, "connected": false})
            }
        })
        .collect();
    Value::Array(slots)
}

pub(crate) fn environment() -> Result<Value, SubsystemError> {
    #[cfg(windows)]
    {
        let wgc =
            windows::Graphics::Capture::GraphicsCaptureSession::IsSupported().unwrap_or(false);
        let vigem = crate::system::gamepad_environment().unwrap_or(Value::Null);
        let vigem_ready = vigem["registryKeyExists"].as_bool().unwrap_or(false);
        let system32 = std::env::var("SystemRoot")
            .map(|r| std::path::PathBuf::from(r).join("System32"))
            .ok();
        let has = |dll: &str| system32.as_ref().is_some_and(|d| d.join(dll).is_file());
        Ok(json!({
            "platform": "windows",
            "capture": {"windowsGraphicsCapture": wgc, "gdiFallback": true},
            "input": {"sendInput": true, "rawRelativeMouse": true, "scanCodeKeys": true},
            "gamepad": {
                "xinputRead": has("xinput1_4.dll"), "xinputSlots": xinput_slots(),
                "gameInputRuntime": has("GameInput.dll"),
                "virtualPad": {"backend": "ViGEmBus (vigem-rust)", "driverInstalled": vigem_ready, "details": vigem,
                    "note": "XInput and GameInput only read pads; virtual Xbox 360 pads need the ViGEmBus kernel driver, which this SDK never installs."},
            },
        }))
    }
    #[cfg(unix)]
    {
        let which = |tool: &str| {
            std::env::var_os("PATH")
                .is_some_and(|p| std::env::split_paths(&p).any(|d| d.join(tool).is_file()))
        };
        Ok(json!({
            "platform": "x11", "display": backend::display(),
            "capture": {"import": which("import"), "xwd": which("xwd")},
            "input": {"xdotool": which("xdotool"), "uinputDevice": std::path::Path::new("/dev/uinput").exists()},
            "gamescope": {"binary": which("gamescope"), "note": "gamescope capture and present stats are a later backend"},
        }))
    }
    #[cfg(not(any(windows, unix)))]
    {
        Err(SubsystemError::Unavailable(
            "gaming tools need Windows or X11".into(),
        ))
    }
}

// ─── Steam launch and focus ──────────────────────────────────────────────────

pub(crate) fn steam_launch(args: &Value) -> Result<Value, SubsystemError> {
    let app_id = args
        .get("appId")
        .and_then(Value::as_u64)
        .and_then(|id| u32::try_from(id).ok())
        .ok_or_else(|| invalid("gaming_steam_launch requires appId"))?;
    let uri = bun_steam::launch::rungameid_uri(app_id);
    if !bun_steam::launch::is_safe_steam_uri(&uri) {
        return Err(invalid("unsafe Steam URI"));
    }
    let title = args
        .get("windowTitle")
        .and_then(Value::as_str)
        .map(str::to_lowercase);
    let process = args
        .get("processName")
        .and_then(Value::as_str)
        .map(|p| p.trim_end_matches(".exe").to_ascii_lowercase());
    let timeout = Duration::from_millis(
        args.get("timeoutMs")
            .and_then(Value::as_u64)
            .unwrap_or(120_000)
            .min(600_000),
    );
    let before: std::collections::HashSet<usize> =
        backend::windows().into_iter().map(|w| w.0).collect();
    backend::open_uri(&uri)?;
    if title.is_none() && process.is_none() {
        return Ok(json!({"appId": app_id, "uri": uri, "launched": true, "window": null}));
    }
    let pids: Box<dyn Fn() -> Vec<u32>> = match &process {
        Some(name) => {
            let name = name.clone();
            Box::new(move || {
                crate::system::list_processes(Some(&name), "name", 50)
                    .processes
                    .into_iter()
                    .filter(|p| p.name.trim_end_matches(".exe").eq_ignore_ascii_case(&name))
                    .map(|p| p.pid)
                    .collect()
            })
        }
        None => Box::new(Vec::new),
    };
    let started = Instant::now();
    while started.elapsed() < timeout {
        let candidates = pids();
        let found = backend::windows()
            .into_iter()
            .find(|(handle, pid, window_title)| {
                let by_title = title
                    .as_ref()
                    .is_some_and(|t| window_title.to_lowercase().contains(t));
                let by_process = candidates.contains(pid);
                (by_title || by_process)
                    && (process.is_some() || !before.contains(handle) || by_title)
            });
        if let Some((handle, pid, window_title)) = found {
            let focused = if args.get("focus").and_then(Value::as_bool).unwrap_or(true) {
                backend::focus(handle).is_ok()
            } else {
                false
            };
            return Ok(json!({
                "appId": app_id, "uri": uri, "launched": true, "hwnd": handle, "pid": pid, "title": window_title,
                "focused": focused, "elapsedMs": started.elapsed().as_millis() as u64,
            }));
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Ok(
        json!({"appId": app_id, "uri": uri, "launched": true, "window": null, "error": "timeout waiting for the game window"}),
    )
}

// ─── gaming optimisation profile (read-only checks, owner-applied changes) ──

/// One registry setting of the gaming profile.
struct RegSetting {
    id: &'static str,
    label: &'static str,
    path: &'static str,
    name: &'static str,
    recommended: u32,
    /// Writes under HKLM need an elevated shell; some take effect after a reboot.
    admin: bool,
    reboot: bool,
}

const PROFILE: &[RegSetting] = &[
    RegSetting {
        id: "gameMode",
        label: "Game Mode",
        path: r"HKCU:\Software\Microsoft\GameBar",
        name: "AutoGameModeEnabled",
        recommended: 1,
        admin: false,
        reboot: false,
    },
    RegSetting {
        id: "hags",
        label: "Hardware-accelerated GPU scheduling",
        path: r"HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers",
        name: "HwSchMode",
        recommended: 2,
        admin: true,
        reboot: true,
    },
    RegSetting {
        id: "backgroundApps",
        label: "Background apps (user switch, 1 = disabled)",
        path: r"HKCU:\Software\Microsoft\Windows\CurrentVersion\BackgroundAccessApplications",
        name: "GlobalUserDisabled",
        recommended: 1,
        admin: false,
        reboot: false,
    },
    RegSetting {
        id: "gameDvr",
        label: "Game Bar background recording (GameDVR)",
        path: r"HKCU:\System\GameConfigStore",
        name: "GameDVR_Enabled",
        recommended: 0,
        admin: false,
        reboot: false,
    },
    RegSetting {
        id: "appCapture",
        label: "Game Bar app capture",
        path: r"HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR",
        name: "AppCaptureEnabled",
        recommended: 0,
        admin: false,
        reboot: false,
    },
    RegSetting {
        id: "globalTimerResolution",
        label: "Honour timer-resolution requests of every process (Windows 11)",
        path: r"HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\kernel",
        name: "GlobalTimerResolutionRequests",
        recommended: 1,
        admin: true,
        reboot: true,
    },
];

/// High performance power scheme (`SCHEME_MIN`).
const HIGH_PERFORMANCE: &str = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";
/// Ultimate Performance template, duplicated when the scheme is not listed.
const ULTIMATE_TEMPLATE: &str = "e9a42b02-d5df-448d-aa00-03f14749eb61";

fn read_dword(path: &str, name: &str) -> Option<u64> {
    crate::registry::get_value(path, name)
        .ok()
        .and_then(|v| v["Value"].as_u64())
}

fn reg_setting_state(setting: &RegSetting) -> Value {
    let current = read_dword(setting.path, setting.name);
    json!({
        "id": setting.id, "label": setting.label, "path": setting.path, "name": setting.name,
        "current": current, "recommended": setting.recommended,
        "ok": current == Some(u64::from(setting.recommended)), "requiresAdmin": setting.admin, "requiresReboot": setting.reboot,
    })
}

pub(crate) fn game_mode() -> Result<Value, SubsystemError> {
    let mut state = reg_setting_state(&PROFILE[0]);
    // Absent value means the Windows 11 default (Game Mode on).
    if state["current"].is_null() {
        state["ok"] = json!(true);
        state["effective"] = json!("default (enabled)");
    }
    state["allowAutoGameMode"] = json!(read_dword(
        r"HKCU:\Software\Microsoft\GameBar",
        "AllowAutoGameMode"
    ));
    Ok(state)
}

pub(crate) fn background_apps() -> Result<Value, SubsystemError> {
    let mut state = reg_setting_state(&PROFILE[2]);
    let policy = read_dword(
        r"HKLM:\SOFTWARE\Policies\Microsoft\Windows\AppPrivacy",
        "LetAppsRunInBackground",
    );
    state["policyLetAppsRunInBackground"] = json!(policy);
    state["policyMeaning"] = json!(match policy {
        Some(0) => "user in control",
        Some(1) => "force allow",
        Some(2) => "force deny",
        _ => "no policy",
    });
    if policy == Some(2) {
        state["ok"] = json!(true);
    }
    Ok(state)
}

pub(crate) fn game_bar_capture() -> Result<Value, SubsystemError> {
    let dvr = reg_setting_state(&PROFILE[3]);
    let capture = reg_setting_state(&PROFILE[4]);
    let policy = read_dword(
        r"HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR",
        "AllowGameDVR",
    );
    let ok = (dvr["ok"].as_bool().unwrap_or(false) && capture["ok"].as_bool().unwrap_or(false))
        || policy == Some(0);
    Ok(
        json!({"ok": ok, "gameDvr": dvr, "appCapture": capture, "policyAllowGameDvr": policy,
              "gameBarPresenceWriter": read_dword(r"HKLM:\SOFTWARE\Microsoft\WindowsRuntime\ActivatableClassId\Windows.Gaming.GameBar.PresenceServer.Internal.PresenceWriter", "ActivationType")}),
    )
}

pub(crate) fn timer_resolution() -> Result<Value, SubsystemError> {
    #[cfg(windows)]
    {
        let (mut coarsest, mut finest, mut current) = (0u32, 0u32, 0u32);
        // Safety: three valid out-pointers; the call only reads kernel timer state.
        let status = unsafe {
            windows::Wdk::System::SystemInformation::NtQueryTimerResolution(
                &mut coarsest,
                &mut finest,
                &mut current,
            )
        };
        if status.is_err() {
            return Err(failed(format!(
                "NtQueryTimerResolution failed: 0x{:08X}",
                status.0
            )));
        }
        let ms = |v: u32| round2(f64::from(v) / 10_000.0);
        let mut state = reg_setting_state(&PROFILE[5]);
        state["currentMs"] = json!(ms(current));
        state["finestMs"] = json!(ms(finest));
        state["coarsestMs"] = json!(ms(coarsest));
        state["note"] = json!(
            "The current resolution is the finest one any process requests; games request ~0.5-1 ms themselves."
        );
        Ok(state)
    }
    #[cfg(not(windows))]
    {
        Err(SubsystemError::Unavailable(
            "timer resolution is a Windows kernel setting".into(),
        ))
    }
}

pub(crate) fn gpu_info() -> Result<Value, SubsystemError> {
    #[cfg(windows)]
    {
        use aphrody_proc::NoWindow as _;
        let smi = std::env::var("SystemRoot")
            .map(|root| std::path::PathBuf::from(root).join(r"System32\nvidia-smi.exe"))
            .ok()
            .filter(|p| p.is_file());
        let fields = "name,driver_version,pstate,power.limit,power.default_limit,power.draw,clocks.gr,clocks.max.gr,clocks.mem,temperature.gpu,utilization.gpu,memory.used,memory.total,pcie.link.gen.current,pcie.link.width.current";
        let nvidia = smi.as_ref().and_then(|smi| {
            let output = std::process::Command::new(smi)
                .no_window()
                .args([
                    format!("--query-gpu={fields}"),
                    "--format=csv,noheader,nounits".into(),
                ])
                .output()
                .ok()?;
            let text = String::from_utf8_lossy(&output.stdout);
            let gpus: Vec<Value> = text
                .lines()
                .filter(|l| !l.trim().is_empty())
                .map(|line| {
                    let mut gpu = serde_json::Map::new();
                    for (key, value) in fields.split(',').zip(line.split(',')) {
                        let value = value.trim();
                        let parsed = if key == "driver_version" {
                            None
                        } else {
                            value.parse::<f64>().ok()
                        };
                        gpu.insert(
                            key.into(),
                            parsed.map_or_else(|| json!(value), |n| json!(n)),
                        );
                    }
                    Value::Object(gpu)
                })
                .collect();
            Some(gpus)
        });
        Ok(json!({
            "nvidia": {"source": "nvidia-smi (NVML)", "available": nvidia.is_some(), "gpus": nvidia.unwrap_or_default()},
            "hags": crate::registry::get_hags_mode().unwrap_or(Value::Null),
            "gpuPreferences": crate::registry::get_gpu_preferences().ok().map(|v| v["Values"].clone()),
            "note": "packages/bun-windows-wnvapi binds wnvapi.dll (Windows Network Virtualization), not NVIDIA NVAPI; NVIDIA state is read through nvidia-smi.",
        }))
    }
    #[cfg(not(windows))]
    {
        let output = std::process::Command::new("nvidia-smi")
            .args([
                "--query-gpu=name,driver_version,pstate",
                "--format=csv,noheader",
            ])
            .output();
        Ok(
            json!({"nvidia": {"available": output.as_ref().is_ok_and(|o| o.status.success()),
                  "raw": output.ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned())}}),
        )
    }
}

fn power_state() -> Value {
    let plans = crate::system::list_power_plans().ok();
    let active = plans
        .as_ref()
        .and_then(|p| p.plans.iter().find(|plan| plan.is_active).cloned());
    let high_listed = plans.as_ref().is_some_and(|p| {
        p.plans
            .iter()
            .any(|plan| plan.guid.eq_ignore_ascii_case(HIGH_PERFORMANCE))
    });
    let ok = active.as_ref().is_some_and(|plan| {
        plan.guid.eq_ignore_ascii_case(HIGH_PERFORMANCE)
            || plan.name.to_ascii_lowercase().contains("ultimate")
            || plan.name.to_ascii_lowercase().contains("performance")
    });
    json!({
        "id": "powerPlan", "label": "Power plan", "active": active.map(|p| json!({"guid": p.guid, "name": p.name})),
        "recommended": "High performance (or Ultimate Performance)", "highPerformanceListed": high_listed, "ok": ok,
        "requiresAdmin": false, "requiresReboot": false,
    })
}

/// PowerShell one-liner applying every non-compliant item (run in an elevated shell when an item
/// requires admin). Built from the same table the checks read.
fn apply_command(states: &[Value], power: &Value) -> String {
    let mut parts = Vec::new();
    for (setting, state) in PROFILE.iter().zip(states) {
        if state["ok"].as_bool().unwrap_or(false) {
            continue;
        }
        let key = setting.path.replacen(':', "", 1);
        parts.push(format!(
            "reg add '{key}' /v {} /t REG_DWORD /d {} /f",
            setting.name, setting.recommended
        ));
    }
    if !power["ok"].as_bool().unwrap_or(false) {
        if power["highPerformanceListed"].as_bool().unwrap_or(false) {
            parts.push(format!("powercfg /setactive {HIGH_PERFORMANCE}"));
        } else {
            parts.push(format!(
                "powercfg /setactive ((powercfg /duplicatescheme {ULTIMATE_TEMPLATE}) -replace '.*([0-9a-f-]{{36}}).*','$1')"
            ));
        }
    }
    parts.join("; ")
}

fn profile_states() -> (Vec<Value>, Value) {
    let mut states: Vec<Value> = PROFILE.iter().map(reg_setting_state).collect();
    // Absent Game Mode value is the enabled default.
    if states[0]["current"].is_null() {
        states[0]["ok"] = json!(true);
    }
    (states, power_state())
}

pub(crate) fn profile_status() -> Result<Value, SubsystemError> {
    let (states, power) = profile_states();
    let command = apply_command(&states, &power);
    let pending: Vec<&str> = states
        .iter()
        .chain(std::iter::once(&power))
        .filter(|s| !s["ok"].as_bool().unwrap_or(false))
        .filter_map(|s| s["id"].as_str())
        .collect();
    Ok(json!({
        "platform": backend::NAME,
        "settings": states, "powerPlan": power,
        "gameMode": game_mode().ok(), "backgroundApps": background_apps().ok(), "gameBarCapture": game_bar_capture().ok(),
        "timerResolution": timer_resolution().ok(), "gpu": gpu_info().ok(),
        "pending": pending, "compliant": pending.is_empty(),
        "applyCommand": if command.is_empty() { Value::Null } else { json!(command) },
        "applyNote": "Read-only check. Run applyCommand (or gaming_profile_apply with confirm=true) in an elevated PowerShell; HAGS and timer changes need a reboot.",
    }))
}

/// Applies the pending profile items. Mutates the registry and the power plan: owner-run only.
pub(crate) fn profile_apply(args: &Value) -> Result<Value, SubsystemError> {
    let (states, power) = profile_states();
    let command = apply_command(&states, &power);
    let dry_run = args.get("dryRun").and_then(Value::as_bool).unwrap_or(false);
    if dry_run || command.is_empty() {
        return Ok(json!({"applied": false, "dryRun": dry_run, "command": command}));
    }
    if args.get("confirm").and_then(Value::as_bool) != Some(true) {
        return Err(invalid(
            "gaming_profile_apply changes Windows settings; pass confirm=true (owner only) or dryRun=true",
        ));
    }
    let mut applied = Vec::new();
    for (setting, state) in PROFILE.iter().zip(&states) {
        if !state["ok"].as_bool().unwrap_or(false) {
            crate::registry::set_value(
                setting.path,
                setting.name,
                &setting.recommended.to_string(),
                "DWord",
            )
            .map_err(|error| failed(format!("{}: {error}", setting.id)))?;
            applied.push(setting.id);
        }
    }
    if !power["ok"].as_bool().unwrap_or(false)
        && power["highPerformanceListed"].as_bool().unwrap_or(false)
    {
        crate::system::set_active_power_plan(HIGH_PERFORMANCE).map_err(failed)?;
        applied.push("powerPlan");
    }
    Ok(
        json!({"applied": true, "items": applied, "rebootRecommended": PROFILE.iter().any(|s| s.reboot && applied.contains(&s.id))}),
    )
}
