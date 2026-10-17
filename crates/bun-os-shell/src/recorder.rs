//! Game recording through Media Foundation's sink writer with hardware transforms enabled, which
//! selects the GPU vendor's H.264 encoder MFT (NVENC on NVIDIA). Frames come from the Bun Engine
//! machine (RGBA), are scaled to at least 720 lines and converted to NV12 on a worker thread.

use std::path::PathBuf;
use std::sync::mpsc::{Sender, channel};
use std::thread::JoinHandle;

pub struct Recorder {
    tx: Option<Sender<(u32, u32, Vec<u8>)>>,
    thread: Option<JoinHandle<Result<String, String>>>,
    pub path: PathBuf,
}

/// Hardware video encoders Media Foundation exposes (friendly names), e.g. "NVIDIA H.264 Encoder MFT".
#[cfg(windows)]
pub fn hardware_encoders() -> Vec<String> {
    use windows::Win32::Media::MediaFoundation::{
        IMFActivate, MF_VERSION, MFMediaType_Video, MFSTARTUP_FULL, MFStartup,
        MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE, MFT_ENUM_FLAG_SORTANDFILTER,
        MFT_FRIENDLY_NAME_Attribute, MFT_REGISTER_TYPE_INFO, MFTEnumEx, MFVideoFormat_H264,
        MFVideoFormat_HEVC,
    };
    use windows::Win32::System::Com::CoTaskMemFree;
    let mut names = Vec::new();
    // SAFETY: MFTEnumEx returns a CoTaskMem array of activation objects that we release.
    unsafe {
        let _ = MFStartup(MF_VERSION, MFSTARTUP_FULL);
        for subtype in [MFVideoFormat_H264, MFVideoFormat_HEVC] {
            let output = MFT_REGISTER_TYPE_INFO {
                guidMajorType: MFMediaType_Video,
                guidSubtype: subtype,
            };
            let mut activates: *mut Option<IMFActivate> = std::ptr::null_mut();
            let mut count = 0u32;
            if MFTEnumEx(
                MFT_CATEGORY_VIDEO_ENCODER,
                MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
                None,
                Some(&output),
                &mut activates,
                &mut count,
            )
            .is_err()
            {
                continue;
            }
            for i in 0..count as usize {
                if let Some(activate) = (*activates.add(i)).take() {
                    let mut name = windows::core::PWSTR::null();
                    let mut len = 0;
                    if activate
                        .GetAllocatedString(&MFT_FRIENDLY_NAME_Attribute, &mut name, &mut len)
                        .is_ok()
                    {
                        let s = name.to_string().unwrap_or_default();
                        CoTaskMemFree(Some(name.0.cast()));
                        if !names.contains(&s) {
                            names.push(s);
                        }
                    }
                }
            }
            CoTaskMemFree(Some(activates.cast()));
        }
    }
    names
}

#[cfg(not(windows))]
pub fn hardware_encoders() -> Vec<String> {
    Vec::new()
}

fn scale_nearest(w: u32, h: u32, rgba: &[u8]) -> (u32, u32, Vec<u8>) {
    let factor = (720 / h.max(1)).max(1);
    let (ow, oh) = ((w * factor) & !1, (h * factor) & !1);
    let mut out = vec![0u8; (ow * oh * 4) as usize];
    for y in 0..oh {
        let sy = (y / factor).min(h - 1);
        for x in 0..ow {
            let sx = (x / factor).min(w - 1);
            let s = ((sy * w + sx) * 4) as usize;
            let d = ((y * ow + x) * 4) as usize;
            out[d..d + 4].copy_from_slice(&rgba[s..s + 4]);
        }
    }
    (ow, oh, out)
}

fn nv12(w: u32, h: u32, rgba: &[u8]) -> Vec<u8> {
    let (w, h) = (w as usize, h as usize);
    let mut out = vec![0u8; w * h * 3 / 2];
    let (luma, chroma) = out.split_at_mut(w * h);
    for y in 0..h {
        for x in 0..w {
            let p = &rgba[(y * w + x) * 4..];
            let (r, g, b) = (f32::from(p[0]), f32::from(p[1]), f32::from(p[2]));
            luma[y * w + x] = (16.0 + 0.1826 * r + 0.6142 * g + 0.0620 * b).round() as u8;
            if y % 2 == 0 && x % 2 == 0 {
                let c = (y / 2) * w + x;
                chroma[c] = (128.0 - 0.1006 * r - 0.3386 * g + 0.4392 * b)
                    .round()
                    .clamp(0.0, 255.0) as u8;
                chroma[c + 1] = (128.0 + 0.4392 * r - 0.3989 * g - 0.0403 * b)
                    .round()
                    .clamp(0.0, 255.0) as u8;
            }
        }
    }
    out
}

#[cfg(windows)]
fn encode(
    path: PathBuf,
    fps: u32,
    rx: std::sync::mpsc::Receiver<(u32, u32, Vec<u8>)>,
) -> Result<String, String> {
    use windows::Win32::Media::MediaFoundation::*;
    use windows::core::{HSTRING, Interface};

    let err = |what: &'static str| move |e: windows::core::Error| format!("{what}: {e}");
    let Ok(first) = rx.recv() else {
        return Err("no frames".into());
    };
    let (w, h, _) = scale_nearest(first.0, first.1, &first.2);
    let pack = |hi: u32, lo: u32| (u64::from(hi) << 32) | u64::from(lo);
    // SAFETY: Media Foundation sink-writer setup and sample submission with owned COM objects.
    unsafe {
        MFStartup(MF_VERSION, MFSTARTUP_FULL).map_err(err("MFStartup"))?;
        let mut attributes = None;
        MFCreateAttributes(&mut attributes, 2).map_err(err("attributes"))?;
        let attributes = attributes.ok_or("attributes")?;
        attributes
            .SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1)
            .map_err(err("hardware transforms"))?;
        attributes
            .SetUINT32(&MF_SINK_WRITER_DISABLE_THROTTLING, 1)
            .map_err(err("throttling"))?;
        let writer = MFCreateSinkWriterFromURL(&HSTRING::from(path.as_os_str()), None, &attributes)
            .map_err(err("sink writer"))?;
        let output = MFCreateMediaType().map_err(err("media type"))?;
        output
            .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
            .map_err(err("major"))?;
        output
            .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)
            .map_err(err("subtype"))?;
        output
            .SetUINT32(&MF_MT_AVG_BITRATE, 12_000_000)
            .map_err(err("bitrate"))?;
        output
            .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
            .map_err(err("interlace"))?;
        output
            .SetUINT64(&MF_MT_FRAME_SIZE, pack(w, h))
            .map_err(err("size"))?;
        output
            .SetUINT64(&MF_MT_FRAME_RATE, pack(fps, 1))
            .map_err(err("rate"))?;
        output
            .SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack(1, 1))
            .map_err(err("par"))?;
        let stream = writer.AddStream(&output).map_err(err("stream"))?;
        let input = MFCreateMediaType().map_err(err("media type"))?;
        input
            .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
            .map_err(err("major"))?;
        input
            .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)
            .map_err(err("subtype"))?;
        input
            .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
            .map_err(err("interlace"))?;
        input
            .SetUINT64(&MF_MT_FRAME_SIZE, pack(w, h))
            .map_err(err("size"))?;
        input
            .SetUINT64(&MF_MT_FRAME_RATE, pack(fps, 1))
            .map_err(err("rate"))?;
        input
            .SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack(1, 1))
            .map_err(err("par"))?;
        writer
            .SetInputMediaType(stream, &input, None)
            .map_err(err("input type"))?;
        writer.BeginWriting().map_err(err("begin"))?;
        let mut encoder = String::from("Media Foundation H.264");
        if let Ok(ex) = writer.cast::<IMFSinkWriterEx>() {
            let mut index = 0;
            loop {
                let mut category = windows::core::GUID::zeroed();
                let mut transform = None;
                if ex
                    .GetTransformForStream(stream, index, Some(&mut category), &mut transform)
                    .is_err()
                {
                    break;
                }
                if category == MFT_CATEGORY_VIDEO_ENCODER
                    && let Some(t) = transform.and_then(|t: IMFTransform| t.GetAttributes().ok())
                {
                    let mut name = windows::core::PWSTR::null();
                    let mut len = 0;
                    if t.GetAllocatedString(&MFT_FRIENDLY_NAME_Attribute, &mut name, &mut len)
                        .is_ok()
                    {
                        encoder = name.to_string().unwrap_or(encoder);
                        windows::Win32::System::Com::CoTaskMemFree(Some(name.0.cast()));
                    }
                }
                index += 1;
            }
        }
        let duration = 10_000_000i64 / i64::from(fps);
        let mut time = 0i64;
        let mut frame = Some(first);
        while let Some((fw, fh, rgba)) = frame.take().or_else(|| rx.recv().ok()) {
            let (sw, sh, scaled) = scale_nearest(fw, fh, &rgba);
            if (sw, sh) != (w, h) {
                continue;
            }
            let data = nv12(w, h, &scaled);
            let buffer = MFCreateMemoryBuffer(data.len() as u32).map_err(err("buffer"))?;
            let mut ptr = std::ptr::null_mut();
            buffer.Lock(&mut ptr, None, None).map_err(err("lock"))?;
            std::ptr::copy_nonoverlapping(data.as_ptr(), ptr, data.len());
            buffer.Unlock().map_err(err("unlock"))?;
            buffer
                .SetCurrentLength(data.len() as u32)
                .map_err(err("length"))?;
            let sample = MFCreateSample().map_err(err("sample"))?;
            sample.AddBuffer(&buffer).map_err(err("add"))?;
            sample.SetSampleTime(time).map_err(err("time"))?;
            sample
                .SetSampleDuration(duration)
                .map_err(err("duration"))?;
            writer.WriteSample(stream, &sample).map_err(err("write"))?;
            time += duration;
        }
        writer.Finalize().map_err(err("finalize"))?;
        Ok(encoder)
    }
}

impl Recorder {
    pub fn start(path: PathBuf, fps: u32) -> Self {
        let (tx, rx) = channel();
        let target = path.clone();
        let thread = std::thread::Builder::new()
            .name("recorder".into())
            .spawn(move || {
                #[cfg(windows)]
                {
                    encode(target, fps.max(1), rx)
                }
                #[cfg(not(windows))]
                {
                    drop((target, rx));
                    Err("recording uses Media Foundation (Windows)".into())
                }
            })
            .ok();
        Self {
            tx: Some(tx),
            thread,
            path,
        }
    }

    pub fn push(&self, w: u32, h: u32, rgba: Vec<u8>) {
        if let Some(tx) = &self.tx {
            let _ = tx.send((w, h, rgba));
        }
    }

    /// Stops and finalizes; returns the encoder that produced the file.
    pub fn stop(mut self) -> Result<String, String> {
        self.tx.take();
        self.thread
            .take()
            .map_or(Err("recorder thread did not start".into()), |t| {
                t.join().unwrap_or(Err("recorder panicked".into()))
            })
    }
}
