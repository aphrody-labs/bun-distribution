//! Presentation of decoded NV12 frames through the shared FSR1 pass (`runtime::fsr1`): EASU fused
//! with NV12 -> RGB from the stream resolution to the letterboxed viewport, RCAS into the camera
//! output, and the HUD overlay. The decoder ring is sampled in place (zero copy).

use aphrody_gpu_backend::wgpu;

use super::decode::{ImportedRing, SharedSet};
use super::hud::{HUD_HEIGHT, HUD_WIDTH};
use crate::runtime::fsr1::{Fsr1, Fsr1Source, letterbox};

/// What the next redraw samples.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Ring(usize),
    Cpu,
}

struct CpuPlanes {
    luma: wgpu::Texture,
    chroma: wgpu::Texture,
    group: wgpu::BindGroup,
    size: (u32, u32),
}

pub struct Presenter {
    fsr: Fsr1,
    ring: Option<ImportedRing>,
    ring_groups: Vec<wgpu::BindGroup>,
    cpu: Option<CpuPlanes>,
    pub source: Option<Source>,
}

impl Presenter {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat, sharpness_stops: f32) -> Self {
        let mut fsr = Fsr1::new(device, format, (HUD_WIDTH, HUD_HEIGHT));
        fsr.sharpness_stops = sharpness_stops;
        Self { fsr, ring: None, ring_groups: Vec::new(), cpu: None, source: None }
    }

    pub fn target_format(&self) -> wgpu::TextureFormat {
        self.fsr.target_format()
    }

    /// Import a new shared ring announced by the decoder.
    pub fn import(&mut self, device: &wgpu::Device, set: &SharedSet) -> Result<(), String> {
        let ring = ImportedRing::import(device, set)?;
        self.ring_groups = ring
            .textures
            .iter()
            .map(|t| {
                let luma = t.create_view(&wgpu::TextureViewDescriptor {
                    label: Some("luma"),
                    format: Some(wgpu::TextureFormat::R8Unorm),
                    aspect: wgpu::TextureAspect::Plane0,
                    ..Default::default()
                });
                let chroma = t.create_view(&wgpu::TextureViewDescriptor {
                    label: Some("chroma"),
                    format: Some(wgpu::TextureFormat::Rg8Unorm),
                    aspect: wgpu::TextureAspect::Plane1,
                    ..Default::default()
                });
                self.fsr.planes_group(device, &luma, &chroma)
            })
            .collect();
        self.ring = Some(ring);
        if matches!(self.source, Some(Source::Ring(_))) {
            self.source = None;
        }
        Ok(())
    }

    pub fn ring(&self) -> Option<&ImportedRing> {
        self.ring.as_ref()
    }

    /// Upload a CPU NV12 picture (fallback path when NV12 sharing is unavailable).
    pub fn upload_cpu(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, width: u32, height: u32, pitch: u32, nv12: &[u8]) {
        if self.cpu.as_ref().is_none_or(|c| c.size != (width, height)) {
            let plane = |label, w, h, format| {
                device.create_texture(&wgpu::TextureDescriptor {
                    label: Some(label),
                    size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                })
            };
            let luma = plane("luma", width, height, wgpu::TextureFormat::R8Unorm);
            let chroma = plane("chroma", width / 2, height / 2, wgpu::TextureFormat::Rg8Unorm);
            let group =
                self.fsr.planes_group(device, &luma.create_view(&Default::default()), &chroma.create_view(&Default::default()));
            self.cpu = Some(CpuPlanes { luma, chroma, group, size: (width, height) });
        }
        let cpu = self.cpu.as_ref().unwrap();
        let write = |texture: &wgpu::Texture, offset: u64, w: u32, h: u32| {
            queue.write_texture(
                wgpu::TexelCopyTextureInfo { texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
                nv12,
                wgpu::TexelCopyBufferLayout { offset, bytes_per_row: Some(pitch), rows_per_image: Some(h) },
                wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            );
        };
        write(&cpu.luma, 0, width, height);
        write(&cpu.chroma, u64::from(pitch) * u64::from(height), width / 2, height / 2);
        self.source = Some(Source::Cpu);
    }

    pub fn upload_hud(&self, queue: &wgpu::Queue, rgba: &[u8]) {
        self.fsr.upload_hud(queue, rgba);
    }

    /// Stream size of the current source.
    pub fn stream_size(&self) -> Option<(u32, u32)> {
        match self.source? {
            Source::Ring(_) => self.ring.as_ref().map(|r| (r.width, r.height)),
            Source::Cpu => self.cpu.as_ref().map(|c| c.size),
        }
    }

    /// Output viewport (x, y, w, h) of the stream inside a `target` sized surface.
    pub fn viewport(&self, target: (u32, u32)) -> Option<(f32, f32, f32, f32)> {
        self.stream_size().map(|size| letterbox(target, size))
    }

    /// Record EASU + RCAS + HUD into `target`.
    pub fn encode(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        target_size: (u32, u32),
        show_hud: bool,
    ) {
        let group = match self.source {
            Some(Source::Ring(slot)) => self.ring_groups.get(slot),
            Some(Source::Cpu) => self.cpu.as_ref().map(|c| &c.group),
            None => None,
        };
        let source = group.zip(self.stream_size()).map(|(g, size)| (Fsr1Source::Nv12(g), size));
        self.fsr.encode(device, queue, encoder, source, target, target_size, show_hud);
    }
}
