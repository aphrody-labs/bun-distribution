// SPDX-License-Identifier: Apache-2.0
//! GPU window capture through Windows.Graphics.Capture (WGC) on a Direct3D 11 hardware device.
//!
//! WGC receives the window's composed surface from DWM on the GPU, so it works for occluded,
//! DirectX and Vulkan windows (games) where GDI `PrintWindow` returns black or stale pixels. Every
//! delivered frame carries the DWM present timestamp (`SystemRelativeTime`), which is what
//! [`frame_pacing`] uses to observe a game's frame rate and frame times without any hook.
//!
//! Frames stay on the GPU until a reader asks for pixels: the newest frame is copied into one
//! CPU-readable staging texture, mapped and cropped to the content size.

#![deny(unsafe_op_in_unsafe_fn)]

use std::time::{Duration, Instant};

use windows::{
    Graphics::{
        Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession},
        DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
    },
    Win32::{
        Foundation::{HMODULE, HWND},
        Graphics::{
            Direct3D::D3D_DRIVER_TYPE_HARDWARE,
            Direct3D11::{
                D3D11_BIND_FLAG, D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                D3D11_MAP_READ, D3D11_MAPPED_SUBRESOURCE, D3D11_RESOURCE_MISC_FLAG,
                D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING, D3D11CreateDevice,
                ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
            },
            Dxgi::IDXGIDevice,
        },
        System::WinRT::{
            Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess},
            Graphics::Capture::IGraphicsCaptureItemInterop,
            RO_INIT_MULTITHREADED, RoInitialize,
        },
    },
    core::Interface,
};

use crate::{CaptureError, RawFrame, Result};

fn win(error: windows::core::Error) -> CaptureError {
    CaptureError::Win32(error.to_string())
}

/// Frame cadence of a window observed from WGC present timestamps.
#[derive(Debug, Clone, Default)]
pub struct FramePacing {
    /// Frames delivered by DWM during the window.
    pub frames: u32,
    pub duration_ms: f64,
    /// Average presented frames per second.
    pub fps: f64,
    pub frame_time_avg_ms: f64,
    pub frame_time_p50_ms: f64,
    pub frame_time_p95_ms: f64,
    pub frame_time_p99_ms: f64,
    pub frame_time_min_ms: f64,
    pub frame_time_max_ms: f64,
    /// Frame-time standard deviation (pacing jitter).
    pub jitter_ms: f64,
    /// Average fps over the slowest 1 % of frames.
    pub one_percent_low_fps: f64,
    pub width: u32,
    pub height: u32,
}

/// Throughput of on-demand GPU capture with CPU readback (what an agent loop pays per frame).
#[derive(Debug, Clone, Default)]
pub struct CaptureBenchmark {
    pub backend: &'static str,
    /// Frames read back to system memory.
    pub grabs: u32,
    /// New frames DWM delivered during the run (content changes).
    pub delivered_frames: u32,
    pub duration_ms: f64,
    pub grab_fps: f64,
    pub delivered_fps: f64,
    pub grab_avg_ms: f64,
    pub grab_p95_ms: f64,
    pub grab_max_ms: f64,
    pub width: u32,
    pub height: u32,
}

/// Running WGC capture of one top-level window.
pub struct WindowCapture {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
    staging: Option<(ID3D11Texture2D, u32, u32)>,
    content: (u32, u32),
    /// Present timestamp (100 ns units) of the newest frame copied to staging.
    last_time: Option<i64>,
}

impl WindowCapture {
    /// Starts capturing `handle` (an HWND as `usize`).
    pub fn new(handle: usize) -> Result<Self> {
        // WinRT activation needs an apartment; an already initialised thread keeps its own.
        let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
        if !GraphicsCaptureSession::IsSupported().map_err(win)? {
            return Err(CaptureError::Win32(
                "Windows.Graphics.Capture is not supported".into(),
            ));
        }
        let mut device = None;
        let mut context = None;
        // Safety: out-pointers reference live locals; no adapter means the default hardware one.
        unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
        }
        .map_err(win)?;
        let device: ID3D11Device =
            device.ok_or_else(|| CaptureError::Win32("D3D11CreateDevice: no device".into()))?;
        let context = context
            .ok_or_else(|| CaptureError::Win32("D3D11CreateDevice: no immediate context".into()))?;
        let dxgi: IDXGIDevice = device.cast().map_err(win)?;
        // Safety: `dxgi` is a live DXGI device of the D3D11 device created above.
        let inspectable = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi) }.map_err(win)?;
        let winrt_device: IDirect3DDevice = inspectable.cast().map_err(win)?;

        let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
            .map_err(win)?;
        // Safety: an invalid HWND makes CreateForWindow fail with an error, never UB.
        let item: GraphicsCaptureItem =
            unsafe { interop.CreateForWindow(HWND(handle as *mut _)) }.map_err(win)?;
        let size = item.Size().map_err(win)?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &winrt_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            size,
        )
        .map_err(win)?;
        let session = pool.CreateCaptureSession(&item).map_err(win)?;
        // Optional on older builds; the yellow border and cursor are not part of a game frame.
        let _ = session.SetIsCursorCaptureEnabled(false);
        let _ = session.SetIsBorderRequired(false);
        session.StartCapture().map_err(win)?;
        Ok(Self {
            device,
            context,
            pool,
            session,
            staging: None,
            content: (size.Width.max(1) as u32, size.Height.max(1) as u32),
            last_time: None,
        })
    }

    /// Drains every pending frame; the newest one is copied into the staging texture.
    /// Returns the present timestamps (100 ns units) of all drained frames, oldest first.
    pub fn poll(&mut self) -> Result<Vec<i64>> {
        let mut times = Vec::new();
        let mut newest = None;
        while let Ok(frame) = self.pool.TryGetNextFrame() {
            let time = frame.SystemRelativeTime().map_err(win)?.Duration;
            times.push(time);
            if let Some(previous) = newest.replace((frame.clone(), time)) {
                let _ = previous.0.Close();
            }
        }
        if let Some((frame, time)) = newest {
            let size = frame.ContentSize().map_err(win)?;
            let access: IDirect3DDxgiInterfaceAccess =
                frame.Surface().map_err(win)?.cast().map_err(win)?;
            // Safety: the surface of a live frame is a D3D11 texture of our device.
            let texture: ID3D11Texture2D = unsafe { access.GetInterface() }.map_err(win)?;
            self.copy_to_staging(&texture)?;
            self.content = (size.Width.max(1) as u32, size.Height.max(1) as u32);
            self.last_time = Some(time);
            let _ = frame.Close();
        }
        Ok(times)
    }

    fn copy_to_staging(&mut self, texture: &ID3D11Texture2D) -> Result<()> {
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        // Safety: `desc` is a valid out-parameter.
        unsafe { texture.GetDesc(&mut desc) };
        let reuse =
            matches!(&self.staging, Some((_, w, h)) if *w == desc.Width && *h == desc.Height);
        if !reuse {
            desc.Usage = D3D11_USAGE_STAGING;
            desc.BindFlags = D3D11_BIND_FLAG(0).0 as u32;
            desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
            desc.MiscFlags = D3D11_RESOURCE_MISC_FLAG(0).0 as u32;
            let mut staging = None;
            // Safety: `desc` describes a valid staging texture; out-pointer is a live local.
            unsafe { self.device.CreateTexture2D(&desc, None, Some(&mut staging)) }.map_err(win)?;
            let staging = staging
                .ok_or_else(|| CaptureError::Win32("CreateTexture2D returned no texture".into()))?;
            self.staging = Some((staging, desc.Width, desc.Height));
        }
        if let Some((staging, _, _)) = &self.staging {
            // Safety: both resources belong to `self.device` and have identical dimensions/format.
            unsafe { self.context.CopyResource(staging, texture) };
        }
        Ok(())
    }

    /// Waits until at least one frame has been delivered since the capture started.
    pub fn wait_first_frame(&mut self, timeout: Duration) -> Result<()> {
        let deadline = Instant::now() + timeout;
        while self.last_time.is_none() {
            self.poll()?;
            if self.last_time.is_some() {
                break;
            }
            if Instant::now() >= deadline {
                return Err(CaptureError::Win32(
                    "no WGC frame delivered before timeout".into(),
                ));
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        Ok(())
    }

    /// Reads the newest delivered frame back as top-down BGRA, cropped to the content size.
    pub fn read_bgra(&mut self) -> Result<RawFrame> {
        let Some((staging, tex_w, tex_h)) = &self.staging else {
            return Err(CaptureError::Win32("no frame captured yet".into()));
        };
        let width = self.content.0.min(*tex_w);
        let height = self.content.1.min(*tex_h);
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        // Safety: the staging texture was created with CPU read access on this context.
        unsafe {
            self.context
                .Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
        }
        .map_err(win)?;
        let row = width as usize * 4;
        let mut bgra = Vec::with_capacity(row * height as usize);
        for y in 0..height as usize {
            // Safety: `pData` spans `RowPitch * tex_h` bytes while mapped; `y < tex_h` and
            // `row <= RowPitch`.
            let line = unsafe {
                std::slice::from_raw_parts(
                    (mapped.pData as *const u8).add(y * mapped.RowPitch as usize),
                    row,
                )
            };
            bgra.extend_from_slice(line);
        }
        // Safety: balances the successful Map above.
        unsafe { self.context.Unmap(staging, 0) };
        Ok(RawFrame {
            origin_x: 0,
            origin_y: 0,
            width,
            height,
            bgra,
        })
    }

    /// Content size of the newest frame.
    #[must_use]
    pub fn size(&self) -> (u32, u32) {
        self.content
    }
}

impl Drop for WindowCapture {
    fn drop(&mut self) {
        let _ = self.session.Close();
        let _ = self.pool.Close();
    }
}

/// One-shot GPU capture of a window to top-down BGRA.
pub fn capture_window_raw(handle: usize) -> Result<RawFrame> {
    let mut capture = WindowCapture::new(handle)?;
    capture.wait_first_frame(Duration::from_secs(2))?;
    capture.read_bgra()
}

/// One-shot GPU capture of a window to PNG.
pub fn capture_window_png(handle: usize) -> Result<Vec<u8>> {
    let mut frame = capture_window_raw(handle)?;
    crate::bgra_to_rgba(&mut frame.bgra);
    crate::capture_impl::encode_rgba_to_png(&frame.bgra, frame.width, frame.height)
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let rank = ((p / 100.0) * (sorted.len() - 1) as f64).round() as usize;
    sorted[rank.min(sorted.len() - 1)]
}

/// Frame-time statistics from present timestamps in 100 ns units.
#[must_use]
pub fn pacing_from_timestamps(times: &[i64], duration: Duration) -> FramePacing {
    let mut deltas: Vec<f64> = times
        .windows(2)
        .map(|pair| (pair[1] - pair[0]) as f64 / 10_000.0)
        .collect();
    let frames = times.len() as u32;
    let duration_ms = duration.as_secs_f64() * 1000.0;
    let mut pacing = FramePacing {
        frames,
        duration_ms,
        ..FramePacing::default()
    };
    if deltas.is_empty() {
        pacing.fps = if duration_ms > 0.0 {
            f64::from(frames) * 1000.0 / duration_ms
        } else {
            0.0
        };
        return pacing;
    }
    let avg = deltas.iter().sum::<f64>() / deltas.len() as f64;
    let variance = deltas.iter().map(|d| (d - avg).powi(2)).sum::<f64>() / deltas.len() as f64;
    deltas.sort_by(f64::total_cmp);
    let worst = (deltas.len() / 100).max(1);
    let worst_avg = deltas[deltas.len() - worst..].iter().sum::<f64>() / worst as f64;
    pacing.fps = if avg > 0.0 { 1000.0 / avg } else { 0.0 };
    pacing.frame_time_avg_ms = avg;
    pacing.frame_time_p50_ms = percentile(&deltas, 50.0);
    pacing.frame_time_p95_ms = percentile(&deltas, 95.0);
    pacing.frame_time_p99_ms = percentile(&deltas, 99.0);
    pacing.frame_time_min_ms = deltas[0];
    pacing.frame_time_max_ms = deltas[deltas.len() - 1];
    pacing.jitter_ms = variance.sqrt();
    pacing.one_percent_low_fps = if worst_avg > 0.0 {
        1000.0 / worst_avg
    } else {
        0.0
    };
    pacing
}

/// Observes the window's presented frames for `duration` (no readback): fps and frame times.
pub fn frame_pacing(handle: usize, duration: Duration) -> Result<FramePacing> {
    let mut capture = WindowCapture::new(handle)?;
    // The first frame is the current surface, not a present; start timing after it.
    capture.wait_first_frame(Duration::from_secs(2))?;
    let started = Instant::now();
    let mut times = Vec::new();
    while started.elapsed() < duration {
        times.extend(capture.poll()?);
        std::thread::sleep(Duration::from_micros(500));
    }
    let mut pacing = pacing_from_timestamps(&times, started.elapsed());
    (pacing.width, pacing.height) = capture.size();
    Ok(pacing)
}

/// Captures and reads back the window as fast as possible for `duration`.
pub fn capture_benchmark(handle: usize, duration: Duration) -> Result<CaptureBenchmark> {
    let mut capture = WindowCapture::new(handle)?;
    capture.wait_first_frame(Duration::from_secs(2))?;
    let started = Instant::now();
    let mut grabs = 0u32;
    let mut delivered = 0u32;
    let mut costs = Vec::new();
    while started.elapsed() < duration {
        let grab_start = Instant::now();
        delivered += capture.poll()?.len() as u32;
        let frame = capture.read_bgra()?;
        std::hint::black_box(&frame.bgra);
        costs.push(grab_start.elapsed().as_secs_f64() * 1000.0);
        grabs += 1;
    }
    let elapsed = started.elapsed().as_secs_f64();
    let (width, height) = capture.size();
    let avg = if costs.is_empty() {
        0.0
    } else {
        costs.iter().sum::<f64>() / costs.len() as f64
    };
    costs.sort_by(f64::total_cmp);
    Ok(CaptureBenchmark {
        backend: "windows-graphics-capture",
        grabs,
        delivered_frames: delivered,
        duration_ms: elapsed * 1000.0,
        grab_fps: f64::from(grabs) / elapsed,
        delivered_fps: f64::from(delivered) / elapsed,
        grab_avg_ms: avg,
        grab_p95_ms: percentile(&costs, 95.0),
        grab_max_ms: costs.last().copied().unwrap_or(0.0),
        width,
        height,
    })
}
