// SPDX-License-Identifier: Apache-2.0
//! FFmpeg-backed single-frame extraction and streaming video indexing.

use aphrody_proc::NoWindow as _;
use std::{
    io::{BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use serde::Deserialize;

use crate::{
    descriptor::{ColorLayoutVector, extract_color_layout},
    error::{FramesError, Result},
    index::{FramesIndex, MediaMeta},
};

const WIDTH: u32 = 128;
const HEIGHT: u32 = 128;
const RGB_FRAME_BYTES: usize = WIDTH as usize * HEIGHT as usize * 3;

pub fn extract_vector(path: impl AsRef<Path>, at_ms: Option<u64>) -> Result<ColorLayoutVector> {
    let path = path.as_ref();
    let (width, height) = probe_dimensions(path)?;
    let frame_bytes = checked_rgb_bytes(width, height)?;
    let mut command = Command::new("ffmpeg").no_window();
    command.args(["-v", "error", "-nostdin"]);
    if let Some(ms) = at_ms {
        command.args(["-ss", &format_time(ms)]);
    }
    let output = command
        .args([
            "-i",
            &path.to_string_lossy(),
            "-an",
            "-sn",
            "-frames:v",
            "1",
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "-",
        ])
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| ffmpeg_error("ffmpeg", path, e.to_string()))?;
    if !output.status.success() {
        return Err(ffmpeg_error(
            "ffmpeg",
            path,
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    if output.stdout.len() != frame_bytes {
        return Err(FramesError::Ffmpeg(format!(
            "expected {frame_bytes} RGB bytes, got {}",
            output.stdout.len()
        )));
    }
    extract_color_layout(width, height, &output.stdout)
}

#[derive(Debug, Clone, Deserialize)]
struct ProbeOutput {
    #[serde(default)]
    format: ProbeFormat,
}
#[derive(Debug, Clone, Default, Deserialize)]
struct ProbeFormat {
    #[serde(default)]
    duration: Option<String>,
}

/// Indexes frames at a fixed sampling rate without buffering the video in memory.
pub fn index_video(
    index: &mut FramesIndex,
    video: impl AsRef<Path>,
    meta: MediaMeta,
    fps: f64,
    force: bool,
) -> Result<usize> {
    let video = video.as_ref();
    if !fps.is_finite() || !(0.1..=10.0).contains(&fps) {
        return Err(FramesError::InvalidRequest("index fps must be between 0.1 and 10".into()));
    }
    if index.find_media(&meta.source)?.is_some() && !force {
        return Err(FramesError::InvalidRequest(format!(
            "{} is already indexed; pass --force to replace its frames",
            meta.source
        )));
    }
    let probed_duration = probe_duration(video)?;
    let duration_ms = if meta.duration_ms > 0 { meta.duration_ms } else { probed_duration };
    if duration_ms <= 0 {
        return Err(FramesError::InvalidRequest(
            "video duration must be available and positive".into(),
        ));
    }
    let meta = MediaMeta { duration_ms, fps, ..meta };

    let fps_filter = format!("fps={fps},scale=128:128:flags=area");
    let mut child = Command::new("ffmpeg").no_window()
        .args([
            "-v",
            "error",
            "-nostdin",
            "-i",
            &video.to_string_lossy(),
            "-an",
            "-sn",
            "-vf",
            &fps_filter,
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "-",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| ffmpeg_error("ffmpeg", video, e.to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| FramesError::Ffmpeg("ffmpeg stdout unavailable".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| FramesError::Ffmpeg("ffmpeg stderr unavailable".into()))?;
    let stderr_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = std::io::Read::read_to_end(&mut std::io::BufReader::new(stderr), &mut bytes);
        bytes
    });
    let mut reader = BufReader::with_capacity(RGB_FRAME_BYTES, stdout);
    let interval = (1000.0 / fps).round() as i64;
    let mut sampled = Vec::new();
    let mut frame = vec![0_u8; RGB_FRAME_BYTES];
    loop {
        let mut offset = 0;
        while offset < RGB_FRAME_BYTES {
            match reader.read(&mut frame[offset..]) {
                Ok(0) => break,
                Ok(count) => offset += count,
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stderr_reader.join();
                    return Err(ffmpeg_error("ffmpeg", video, error.to_string()));
                },
            }
        }
        if offset == 0 {
            break;
        }
        if offset != RGB_FRAME_BYTES {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stderr_reader.join();
            return Err(ffmpeg_error("ffmpeg", video, "incomplete RGB frame".into()));
        }
        let timestamp = sampled.len() as i64 * interval;
        match extract_color_layout(WIDTH, HEIGHT, &frame) {
            Ok(vector) => sampled.push((timestamp, vector)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stderr_reader.join();
                return Err(error);
            },
        }
    }
    let status = child.wait().map_err(|e| ffmpeg_error("ffmpeg", video, e.to_string()))?;
    let stderr = stderr_reader.join().unwrap_or_default();
    if !status.success() {
        return Err(ffmpeg_error(
            "ffmpeg",
            video,
            String::from_utf8_lossy(&stderr).trim().to_owned(),
        ));
    }
    if sampled.is_empty() {
        return Err(FramesError::Ffmpeg(
            "ffmpeg produced no frames; previous index was preserved".into(),
        ));
    }
    let (_, count) = index.replace_media_frames(&meta, sampled)?;
    Ok(count)
}

fn probe_duration(path: &Path) -> Result<i64> {
    let output = Command::new("ffprobe").no_window()
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            &path.to_string_lossy(),
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| ffmpeg_error("ffprobe", path, e.to_string()))?;
    if !output.status.success() {
        return Err(ffmpeg_error(
            "ffprobe",
            path,
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    let parsed: ProbeOutput = serde_json::from_slice(&output.stdout)?;
    let duration = parsed
        .format
        .duration
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or_else(|| {
            FramesError::Ffmpeg(format!(
                "ffprobe did not report a valid positive duration for {}",
                path.display()
            ))
        })?;
    Ok((duration * 1000.0).round() as i64)
}

#[derive(Debug, Deserialize)]
struct ProbeStreams {
    #[serde(default)]
    streams: Vec<ProbeStream>,
}
#[derive(Debug, Deserialize)]
struct ProbeStream {
    width: u32,
    height: u32,
}
fn probe_dimensions(path: &Path) -> Result<(u32, u32)> {
    let output = Command::new("ffprobe").no_window()
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
            &path.to_string_lossy(),
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| ffmpeg_error("ffprobe", path, e.to_string()))?;
    if !output.status.success() {
        return Err(ffmpeg_error(
            "ffprobe",
            path,
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    let parsed: ProbeStreams = serde_json::from_slice(&output.stdout)?;
    let stream = parsed
        .streams
        .first()
        .ok_or_else(|| FramesError::InvalidRequest("input contains no video stream".into()))?;
    checked_rgb_bytes(stream.width, stream.height)?;
    Ok((stream.width, stream.height))
}

fn checked_rgb_bytes(width: u32, height: u32) -> Result<usize> {
    if width == 0 || height == 0 || width < 8 || height < 8 {
        return Err(FramesError::InvalidRequest("video frame must be at least 8×8 pixels".into()));
    }
    let bytes = (width as usize)
        .checked_mul(height as usize)
        .and_then(|value| value.checked_mul(3))
        .ok_or_else(|| {
            FramesError::InvalidRequest("video dimensions overflow RGB buffer size".into())
        })?;
    if bytes > 256 * 1024 * 1024 {
        return Err(FramesError::InvalidRequest("video frame exceeds 256 MiB safety limit".into()));
    }
    Ok(bytes)
}

fn format_time(ms: u64) -> String {
    format!("{:.3}", ms as f64 / 1000.0)
}
fn ffmpeg_error(tool: &str, path: &Path, reason: String) -> FramesError {
    FramesError::Ffmpeg(format!("{tool} failed for {}: {reason}", PathBuf::from(path).display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_seek_timestamp_without_shell_interpolation() {
        assert_eq!(format_time(12_345), "12.345");
        assert_eq!(format_time(0), "0.000");
    }

    #[test]
    fn failed_forced_reindex_preserves_the_previous_sqlite_media_and_frames() {
        if Command::new("ffprobe").arg("-version").output().is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let video = dir.path().join("invalid-video.bin");
        std::fs::write(&video, b"not a video stream").unwrap();
        let db = dir.path().join("frames.sqlite");
        let mut index = FramesIndex::open(db).unwrap();
        let meta = MediaMeta {
            source: video.display().to_string(),
            title: "existing episode".into(),
            season: Some(1),
            episode: Some(2),
            duration_ms: 5_000,
            fps: 1.0,
        };
        index.replace_media_frames(&meta, [(0, [7_u8; 33])]).unwrap();

        let replacement = MediaMeta { title: "replacement title".into(), ..meta.clone() };
        assert!(index_video(&mut index, &video, replacement, 1.0, true).is_err());
        let rows = index.list(None).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "existing episode");
        assert_eq!(rows[0].frame_count, 1);
        assert_eq!(index.search(&[7_u8; 33], Default::default()).unwrap()[0].similarity, 1.0);
    }
}
