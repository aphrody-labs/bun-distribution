//! Native uncompressed AVI recording for `computer_record_clip`.

use serde_json::Value;

pub fn computer_record_clip(arguments: &Value) -> Result<Value, String> {
    #[cfg(windows)]
    {
        record_windows(arguments)
    }
    #[cfg(not(windows))]
    {
        let _ = arguments;
        Err("computer_record_clip is Windows-only".into())
    }
}

#[cfg(windows)]
fn record_windows(arguments: &Value) -> Result<Value, String> {
    use std::{
        path::PathBuf,
        thread,
        time::{Duration, Instant},
    };

    let window_handle = arguments
        .get("windowHandle")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    if window_handle < 0 {
        return Err("windowHandle must be a non-negative HWND".into());
    }
    let duration_ms = arguments
        .get("durationMs")
        .and_then(Value::as_i64)
        .unwrap_or(5000)
        .clamp(100, 30_000) as u64;
    let fps = arguments
        .get("fps")
        .and_then(Value::as_i64)
        .unwrap_or(10)
        .clamp(1, 30) as u32;
    let path = arguments
        .get("outputPath")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::temp_dir().join(format!("winclean-clip-{}.avi", std::process::id()))
        });
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let target_title = if window_handle == 0 {
        None
    } else {
        let target = aphrody_capture::list_detailed_windows()
            .into_iter()
            .find(|window| window.handle == window_handle as usize)
            .ok_or_else(|| "target window was not found".to_owned())?;
        Some(target.title)
    };
    let interval = Duration::from_secs_f64(1.0 / f64::from(fps));
    let started = Instant::now();
    let mut next = Duration::ZERO;
    let mut frames = Vec::new();
    while next <= Duration::from_millis(duration_ms) {
        let png = match target_title.as_deref() {
            Some(title) => aphrody_capture::capture_window_by_title(title),
            None => aphrody_capture::capture_primary_screen(),
        }
        .map_err(|error| error.to_string())?;
        let image = image::load_from_memory(&png)
            .map_err(|error| error.to_string())?
            .to_rgb8();
        frames.push(image);
        next += interval;
        if let Some(delay) = next.checked_sub(started.elapsed())
            && !delay.is_zero()
        {
            thread::sleep(delay);
        }
    }
    if frames.is_empty() {
        return Err("recording produced no frames".into());
    }
    let width = frames[0].width();
    let height = frames[0].height();
    if width == 0 || height == 0 {
        return Err("recording produced an empty frame".into());
    }
    if frames
        .iter()
        .any(|frame| frame.width() != width || frame.height() != height)
    {
        return Err("capture dimensions changed during recording".into());
    }
    let frame_bytes = bgr24_frames(&frames);
    write_avi(&path, width, height, fps, &frame_bytes).map_err(|error| error.to_string())?;
    Ok(serde_json::json!({
        "success": true,
        "action": "computer_record_clip",
        "path": path,
        "format": "avi",
        "codec": "BI_RGB",
        "frames": frames.len(),
        "fps": fps,
        "width": width,
        "height": height,
        "durationMs": duration_ms
    }))
}

#[cfg(windows)]
fn bgr24_frames(frames: &[image::RgbImage]) -> Vec<Vec<u8>> {
    frames
        .iter()
        .map(|frame| {
            let row_bytes = frame.width() as usize * 3;
            let stride = (row_bytes + 3) & !3;
            let mut data = vec![0u8; stride * frame.height() as usize];
            for y in 0..frame.height() {
                let dst_y = frame.height() - 1 - y;
                let row = &mut data[dst_y as usize * stride..][..row_bytes];
                for x in 0..frame.width() {
                    let pixel = frame.get_pixel(x, y).0;
                    let offset = x as usize * 3;
                    row[offset..offset + 3].copy_from_slice(&[pixel[2], pixel[1], pixel[0]]);
                }
            }
            data
        })
        .collect()
}

#[cfg(windows)]
fn write_avi(
    path: &std::path::Path,
    width: u32,
    height: u32,
    fps: u32,
    frames: &[Vec<u8>],
) -> std::io::Result<()> {
    let frame_count = frames.len() as u32;
    let frame_size = frames[0].len() as u32;
    let max_bytes = frame_size.saturating_mul(fps);
    let mut hdrl = Vec::new();
    chunk(
        b"avih",
        &avih(width, height, fps, frame_count, frame_size, max_bytes),
        &mut hdrl,
    );
    let mut strl = Vec::new();
    chunk(
        b"strh",
        &strh(width, height, fps, frame_count, frame_size),
        &mut strl,
    );
    chunk(b"strf", &strf(width, height, frame_size), &mut strl);
    list(b"strl", &strl, &mut hdrl);
    let mut header = Vec::new();
    list(b"hdrl", &hdrl, &mut header);

    let mut movi = Vec::new();
    let mut index = Vec::with_capacity(frames.len() * 16);
    let mut offset = 4u32;
    for frame in frames {
        chunk(b"00db", frame, &mut movi);
        index.extend_from_slice(b"00db");
        index.extend_from_slice(&0x10u32.to_le_bytes());
        index.extend_from_slice(&offset.to_le_bytes());
        index.extend_from_slice(&(frame.len() as u32).to_le_bytes());
        offset = offset.saturating_add(8 + frame.len() as u32 + frame.len() as u32 % 2);
    }
    let mut body = Vec::new();
    list(b"movi", &movi, &mut body);
    chunk(b"idx1", &index, &mut body);

    let mut riff = Vec::new();
    riff.extend_from_slice(b"RIFF");
    riff.extend_from_slice(&(4u32 + header.len() as u32 + body.len() as u32).to_le_bytes());
    riff.extend_from_slice(b"AVI ");
    riff.extend_from_slice(&header);
    riff.extend_from_slice(&body);
    std::fs::write(path, riff)
}

#[cfg(windows)]
fn chunk(tag: &[u8; 4], data: &[u8], output: &mut Vec<u8>) {
    output.extend_from_slice(tag);
    output.extend_from_slice(&(data.len() as u32).to_le_bytes());
    output.extend_from_slice(data);
    if !data.len().is_multiple_of(2) {
        output.push(0);
    }
}

#[cfg(windows)]
fn list(tag: &[u8; 4], data: &[u8], output: &mut Vec<u8>) {
    let mut payload = Vec::with_capacity(4 + data.len());
    payload.extend_from_slice(tag);
    payload.extend_from_slice(data);
    chunk(b"LIST", &payload, output);
}

#[cfg(windows)]
fn avih(
    width: u32,
    height: u32,
    fps: u32,
    frames: u32,
    frame_size: u32,
    max_bytes: u32,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(56);
    for value in [
        1_000_000 / fps,
        max_bytes,
        0,
        0x10,
        frames,
        0,
        1,
        frame_size,
        width,
        height,
        0,
        0,
        0,
        0,
    ] {
        data.extend_from_slice(&value.to_le_bytes());
    }
    data
}

#[cfg(windows)]
fn strh(width: u32, height: u32, fps: u32, frames: u32, frame_size: u32) -> Vec<u8> {
    let mut data = Vec::with_capacity(56);
    data.extend_from_slice(b"vids");
    data.extend_from_slice(&[0, 0, 0, 0]);
    data.extend_from_slice(&[0; 4]);
    data.extend_from_slice(&0u16.to_le_bytes());
    data.extend_from_slice(&0u16.to_le_bytes());
    data.extend_from_slice(&0u32.to_le_bytes());
    data.extend_from_slice(&1u32.to_le_bytes());
    data.extend_from_slice(&fps.to_le_bytes());
    data.extend_from_slice(&0u32.to_le_bytes());
    data.extend_from_slice(&frames.to_le_bytes());
    data.extend_from_slice(&frame_size.to_le_bytes());
    data.extend_from_slice(&0xffff_ffffu32.to_le_bytes());
    data.extend_from_slice(&0u32.to_le_bytes());
    data.extend_from_slice(&0u16.to_le_bytes());
    data.extend_from_slice(&0u16.to_le_bytes());
    data.extend_from_slice(&width.to_le_bytes());
    data.extend_from_slice(&height.to_le_bytes());
    data
}

#[cfg(windows)]
fn strf(width: u32, height: u32, frame_size: u32) -> Vec<u8> {
    let mut data = Vec::with_capacity(40);
    for value in [40u32, width, height] {
        data.extend_from_slice(&value.to_le_bytes());
    }
    data.extend_from_slice(&1u16.to_le_bytes());
    data.extend_from_slice(&24u16.to_le_bytes());
    data.extend_from_slice(&0u32.to_le_bytes());
    data.extend_from_slice(&frame_size.to_le_bytes());
    data.extend_from_slice(&[0u8; 16]);
    data
}
