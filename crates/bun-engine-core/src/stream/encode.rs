//! H.264 encoder for the loopback self-test: Media Foundation's H.264 encoder MFT in low-latency
//! CBR mode, fed NV12 frames from system memory, producing Annex B access units.

use std::{mem::ManuallyDrop, ptr::null_mut};

use windows::{
    Win32::{
        Foundation::VARIANT_TRUE,
        Media::MediaFoundation::{
            CLSID_MSH264EncoderMFT, CODECAPI_AVEncCommonMeanBitRate, CODECAPI_AVEncCommonRateControlMode,
            CODECAPI_AVEncMPVGOPSize, CODECAPI_AVEncVideoForceKeyFrame, CODECAPI_AVLowLatencyMode,
            ICodecAPI, IMFTransform, MF_E_TRANSFORM_NEED_MORE_INPUT, MF_E_TRANSFORM_STREAM_CHANGE,
            MF_MT_AVG_BITRATE, MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE, MF_MT_INTERLACE_MODE,
            MF_MT_MPEG2_PROFILE, MFCreateMemoryBuffer, MFCreateSample, MFMediaType_Video,
            MFSampleExtension_CleanPoint, MFT_MESSAGE_NOTIFY_BEGIN_STREAMING,
            MFT_MESSAGE_NOTIFY_START_OF_STREAM, MFT_OUTPUT_DATA_BUFFER,
            MFT_OUTPUT_STREAM_PROVIDES_SAMPLES, MFVideoFormat_H264, MFVideoFormat_NV12,
            MFVideoInterlace_Progressive, eAVEncCommonRateControlMode_CBR, eAVEncH264VProfile_Base,
        },
        System::{
            Com::{CLSCTX_INPROC_SERVER, CoCreateInstance},
            Variant::{VARIANT, VT_BOOL, VT_UI4},
        },
    },
    core::Interface,
};

use super::decode::{media_foundation_startup, pack};

fn hr(context: &str) -> impl FnOnce(windows::core::Error) -> String + '_ {
    move |e| format!("{context}: {e}")
}

fn variant_u32(value: u32) -> VARIANT {
    let mut v = VARIANT::default();
    // SAFETY: writing the active union members of a zeroed VARIANT.
    unsafe {
        (*v.Anonymous.Anonymous).vt = VT_UI4;
        (*v.Anonymous.Anonymous).Anonymous.ulVal = value;
    }
    v
}

fn variant_true() -> VARIANT {
    let mut v = VARIANT::default();
    // SAFETY: as above.
    unsafe {
        (*v.Anonymous.Anonymous).vt = VT_BOOL;
        (*v.Anonymous.Anonymous).Anonymous.boolVal = VARIANT_TRUE;
    }
    v
}

pub struct Encoder {
    transform: IMFTransform,
    codec: Option<ICodecAPI>,
    width: u32,
    height: u32,
    fps: u32,
    provides_samples: bool,
    output_bytes: u32,
    frame: i64,
}

// SAFETY: created and used on the loopback server thread only.
unsafe impl Send for Encoder {}

impl Encoder {
    pub fn new(width: u32, height: u32, fps: u32, bitrate_kbps: u32) -> Result<Self, String> {
        media_foundation_startup()?;
        // SAFETY: COM object creation and media-type configuration of the H.264 encoder MFT.
        unsafe {
            let transform: IMFTransform =
                CoCreateInstance(&CLSID_MSH264EncoderMFT, None, CLSCTX_INPROC_SERVER).map_err(hr("H.264 encoder MFT"))?;
            let codec = transform.cast::<ICodecAPI>().ok();
            if let Some(api) = codec.as_ref() {
                let _ = api.SetValue(&CODECAPI_AVLowLatencyMode, &variant_true());
                let _ = api.SetValue(&CODECAPI_AVEncCommonRateControlMode, &variant_u32(eAVEncCommonRateControlMode_CBR.0 as u32));
                let _ = api.SetValue(&CODECAPI_AVEncCommonMeanBitRate, &variant_u32(bitrate_kbps * 1000));
                let _ = api.SetValue(&CODECAPI_AVEncMPVGOPSize, &variant_u32(fps * 4));
            }
            let output = super::decode::media_type(MFMediaType_Video, MFVideoFormat_H264)?;
            output.SetUINT32(&MF_MT_AVG_BITRATE, bitrate_kbps * 1000).map_err(hr("bitrate"))?;
            output.SetUINT64(&MF_MT_FRAME_SIZE, pack(width, height)).map_err(hr("frame size"))?;
            output.SetUINT64(&MF_MT_FRAME_RATE, pack(fps, 1)).map_err(hr("frame rate"))?;
            output.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32).map_err(hr("interlace"))?;
            output.SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_Base.0 as u32).map_err(hr("profile"))?;
            transform.SetOutputType(0, &output, 0).map_err(hr("SetOutputType(H.264)"))?;
            let input = super::decode::media_type(MFMediaType_Video, MFVideoFormat_NV12)?;
            input.SetUINT64(&MF_MT_FRAME_SIZE, pack(width, height)).map_err(hr("frame size"))?;
            input.SetUINT64(&MF_MT_FRAME_RATE, pack(fps, 1)).map_err(hr("frame rate"))?;
            input.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32).map_err(hr("interlace"))?;
            transform.SetInputType(0, &input, 0).map_err(hr("SetInputType(NV12)"))?;
            let info = transform.GetOutputStreamInfo(0).map_err(hr("GetOutputStreamInfo"))?;
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0).map_err(hr("BEGIN_STREAMING"))?;
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0).map_err(hr("START_OF_STREAM"))?;
            Ok(Self {
                transform,
                codec,
                width,
                height,
                fps,
                provides_samples: info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32 != 0,
                output_bytes: info.cbSize.max(width * height * 3 / 2),
                frame: 0,
            })
        }
    }

    /// Encode one NV12 frame; returns the access units produced and whether they start an IDR.
    pub fn encode(&mut self, nv12: &[u8], force_idr: bool) -> Result<Vec<(Vec<u8>, bool)>, String> {
        let expected = (self.width * self.height * 3 / 2) as usize;
        if nv12.len() < expected {
            return Err("short NV12 frame".into());
        }
        let duration = 10_000_000 / i64::from(self.fps);
        // SAFETY: MF sample construction, transform calls and buffer locking on our own objects.
        unsafe {
            if force_idr && let Some(api) = self.codec.as_ref() {
                let _ = api.SetValue(&CODECAPI_AVEncVideoForceKeyFrame, &variant_u32(1));
            }
            let sample = MFCreateSample().map_err(hr("MFCreateSample"))?;
            let buffer = MFCreateMemoryBuffer(expected as u32).map_err(hr("MFCreateMemoryBuffer"))?;
            let mut ptr = null_mut();
            buffer.Lock(&mut ptr, None, None).map_err(hr("Lock"))?;
            std::ptr::copy_nonoverlapping(nv12.as_ptr(), ptr, expected);
            buffer.Unlock().map_err(hr("Unlock"))?;
            buffer.SetCurrentLength(expected as u32).map_err(hr("SetCurrentLength"))?;
            sample.AddBuffer(&buffer).map_err(hr("AddBuffer"))?;
            sample.SetSampleTime(self.frame * duration).map_err(hr("SetSampleTime"))?;
            sample.SetSampleDuration(duration).map_err(hr("SetSampleDuration"))?;
            self.frame += 1;
            self.transform.ProcessInput(0, &sample, 0).map_err(hr("ProcessInput"))?;
            let mut units = Vec::new();
            loop {
                let provided = if self.provides_samples {
                    None
                } else {
                    let s = MFCreateSample().map_err(hr("MFCreateSample"))?;
                    let b = MFCreateMemoryBuffer(self.output_bytes).map_err(hr("MFCreateMemoryBuffer"))?;
                    s.AddBuffer(&b).map_err(hr("AddBuffer"))?;
                    Some(s)
                };
                let mut buffers = [MFT_OUTPUT_DATA_BUFFER {
                    dwStreamID: 0,
                    pSample: ManuallyDrop::new(provided),
                    dwStatus: 0,
                    pEvents: ManuallyDrop::new(None),
                }];
                let mut status = 0u32;
                let result = self.transform.ProcessOutput(0, &mut buffers, &mut status);
                let out = ManuallyDrop::take(&mut buffers[0].pSample);
                drop(ManuallyDrop::take(&mut buffers[0].pEvents));
                match result {
                    Ok(()) => {
                        let Some(out) = out else { continue };
                        let key = out.GetUINT32(&MFSampleExtension_CleanPoint).unwrap_or(0) != 0;
                        let contiguous = out.ConvertToContiguousBuffer().map_err(hr("ConvertToContiguousBuffer"))?;
                        let mut data = null_mut();
                        let mut len = 0u32;
                        contiguous.Lock(&mut data, None, Some(&mut len)).map_err(hr("Lock"))?;
                        units.push((std::slice::from_raw_parts(data, len as usize).to_vec(), key));
                        let _ = contiguous.Unlock();
                    }
                    Err(e) if e.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => return Ok(units),
                    Err(e) if e.code() == MF_E_TRANSFORM_STREAM_CHANGE => {
                        let t = self.transform.GetOutputAvailableType(0, 0).map_err(hr("GetOutputAvailableType"))?;
                        self.transform.SetOutputType(0, &t, 0).map_err(hr("SetOutputType"))?;
                    }
                    Err(e) => return Err(format!("ProcessOutput: {e}")),
                }
            }
        }
    }
}
