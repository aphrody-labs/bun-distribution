//! Clip trimmer. MP4 trims are stream copies through Media Foundation (the owner of the shell's
//! NVENC recordings, `recorder.rs`): the source reader seeks to the key frame at or before the
//! start and delivers compressed samples, the sink writer remuxes them with rebased timestamps, so
//! nothing is re-encoded. GIFs and posters come from `Bun.Video` through the platform service
//! (`media.video.gif`, `files.preview`). `bun-os-shell clip <in> <out> <start> <end>` exposes the
//! same trim to play.aphrody.app on the gaming host.

use std::path::{Path, PathBuf};

/// Trim window in seconds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Window {
    pub start: f32,
    pub end: f32,
}

impl Window {
    pub fn clamp(self, duration: f32) -> Self {
        let end = self.end.clamp(0.0, duration.max(0.0));
        let start = self.start.clamp(0.0, end);
        Self { start, end }
    }
}

/// Output path next to the source: `<stem>-clip-<n>.<ext>`.
pub fn output_for(src: &Path, ext: &str) -> PathBuf {
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let dir = src.parent().unwrap_or(Path::new("."));
    let mut n = 1;
    loop {
        let candidate = dir.join(format!("{stem}-clip-{n}.{ext}"));
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

/// Duration of an MP4 in seconds (Media Foundation presentation descriptor).
#[cfg(windows)]
pub fn duration(path: &Path) -> Result<f32, String> {
    use windows::Win32::Media::MediaFoundation::*;
    use windows::core::HSTRING;
    let err = |what: &'static str| move |e: windows::core::Error| format!("{what}: {e}");
    // SAFETY: Media Foundation source reader over an owned COM object.
    unsafe {
        MFStartup(MF_VERSION, MFSTARTUP_FULL).map_err(err("MFStartup"))?;
        let reader = MFCreateSourceReaderFromURL(&HSTRING::from(path.as_os_str()), None).map_err(err("source reader"))?;
        let value = reader
            .GetPresentationAttribute(MF_SOURCE_READER_MEDIASOURCE.0 as u32, &MF_PD_DURATION)
            .map_err(err("duration"))?;
        let hns = u64::try_from(&value).map_err(err("duration value"))?;
        Ok(hns as f32 / 10_000_000.0)
    }
}

#[cfg(not(windows))]
pub fn duration(_path: &Path) -> Result<f32, String> {
    Err("clip trimming uses Media Foundation (Windows)".into())
}

/// Copy `window` of `src` into `out` without re-encoding (video and audio streams).
#[cfg(windows)]
pub fn trim(src: &Path, out: &Path, window: Window) -> Result<PathBuf, String> {
    use windows::Win32::Media::MediaFoundation::*;
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::core::{GUID, HSTRING};

    let err = |what: &'static str| move |e: windows::core::Error| format!("{what}: {e}");
    let start = (f64::from(window.start) * 10_000_000.0) as i64;
    let end = (f64::from(window.end) * 10_000_000.0) as i64;
    if end <= start {
        return Err("empty trim window".into());
    }
    // SAFETY: Media Foundation reader/writer over owned COM objects, single thread.
    unsafe {
        MFStartup(MF_VERSION, MFSTARTUP_FULL).map_err(err("MFStartup"))?;
        let reader = MFCreateSourceReaderFromURL(&HSTRING::from(src.as_os_str()), None).map_err(err("source reader"))?;
        let writer = MFCreateSinkWriterFromURL(&HSTRING::from(out.as_os_str()), None, None).map_err(err("sink writer"))?;
        // Map every selected source stream to a passthrough writer stream (native media type).
        let mut map: Vec<(u32, u32)> = Vec::new();
        let mut index = 0u32;
        while let Ok(native) = reader.GetNativeMediaType(index, 0) {
            let major = native.GetGUID(&MF_MT_MAJOR_TYPE).unwrap_or(GUID::zeroed());
            if major == MFMediaType_Video || major == MFMediaType_Audio {
                reader.SetStreamSelection(index, true).map_err(err("select"))?;
                let target = writer.AddStream(&native).map_err(err("add stream"))?;
                map.push((index, target));
            } else {
                let _ = reader.SetStreamSelection(index, false);
            }
            index += 1;
        }
        if map.is_empty() {
            return Err("no audio or video stream".into());
        }
        let position = PROPVARIANT::from(start);
        reader.SetCurrentPosition(&GUID::zeroed(), &position).map_err(err("seek"))?;
        writer.BeginWriting().map_err(err("begin"))?;
        let mut base: Option<i64> = None;
        let mut done = vec![false; map.len()];
        while done.iter().any(|d| !d) {
            let mut stream = 0u32;
            let mut flags = 0u32;
            let mut time = 0i64;
            let mut sample: Option<IMFSample> = None;
            reader
                .ReadSample(
                    MF_SOURCE_READER_ANY_STREAM.0 as u32,
                    0,
                    Some(&raw mut stream),
                    Some(&raw mut flags),
                    Some(&raw mut time),
                    Some(&raw mut sample),
                )
                .map_err(err("read"))?;
            let Some(slot) = map.iter().position(|(s, _)| *s == stream) else { continue };
            if flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0 {
                done[slot] = true;
                continue;
            }
            let Some(sample) = sample else { continue };
            if time >= end {
                done[slot] = true;
                continue;
            }
            // The seek lands on the key frame before `start`: rebase on the first sample read.
            let origin = *base.get_or_insert(time);
            sample.SetSampleTime(time - origin).map_err(err("time"))?;
            writer.WriteSample(map[slot].1, &sample).map_err(err("write"))?;
        }
        writer.Finalize().map_err(err("finalize"))?;
    }
    Ok(out.to_path_buf())
}

#[cfg(not(windows))]
pub fn trim(_src: &Path, _out: &Path, _window: Window) -> Result<PathBuf, String> {
    Err("clip trimming uses Media Foundation (Windows)".into())
}

/// `bun-os-shell clip <in> <out> <start-seconds> <end-seconds>`: prints the output path.
pub fn cli(args: &[String]) -> Result<PathBuf, String> {
    let [src, out, start, end] = args else {
        return Err("usage: bun-os-shell clip <in.mp4> <out.mp4> <start-seconds> <end-seconds>".into());
    };
    let parse = |v: &String| v.parse::<f32>().map_err(|e| format!("{v}: {e}"));
    let src = Path::new(src);
    let window = Window {
        start: parse(start)?,
        end: parse(end)?,
    };
    let window = window.clamp(duration(src).unwrap_or(window.end));
    trim(src, Path::new(out), window)
}
