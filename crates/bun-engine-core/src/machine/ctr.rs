//! Nintendo 3DS on Zakuro (`vendor/zakuro`), an HLE 3DS emulator with a software PICA renderer.
//!
//! Zakuro boots decrypted CXI/CCI/CIA titles. Homebrew `.3dsx` executables are converted in
//! memory to a NoCrypto CXI: the three segments are relocated to 0x0010_0000 as the Homebrew
//! Launcher would, the data segment carries its BSS, an exheader allows every SVC, and an
//! embedded RomFS gets the IVFC header retail titles have. The guest then runs as a regular
//! application (libctru's `__service_ptr` stays null).

use std::path::{Path, PathBuf};

use zakuro_common::Screen as CtrScreen;
use zakuro_core::services::hid::{InputState, PadState};
use zakuro_core::{Config, FrameOutcome, System, loader};

use super::{Input, Machine, Screen, Step};

/// 3DS DSP output rate (268,111,856 Hz / 8,192).
const SAMPLE_RATE: u32 = zakuro_core::AUDIO_SAMPLE_RATE as u32;
/// 268,111,856 Hz ARM11 clock / `CYCLES_PER_FRAME`.
const REFRESH_RATE: f64 = 268_111_856.0 / zakuro_core::CYCLES_PER_FRAME as f64;

pub struct Ctr {
    system: Box<System>,
    screens: Vec<Screen>,
    printed: usize,
    stopped: Option<String>,
    /// DSP output not yet taken by the host (interleaved stereo, bounded to one second).
    samples: Vec<f32>,
    // Dropped after `system`, which maps the converted image.
    _converted: Option<TempImage>,
}

struct TempImage(PathBuf);

impl Drop for TempImage {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

impl Ctr {
    /// Boots `path`: a `.3dsx` (converted to a CXI) or anything Zakuro loads (CXI, CCI, CIA).
    /// Boots an image held in memory (browser hosts): a `.3dsx` (converted to a CXI) or a
    /// CXI/CCI/CIA, without touching the file system.
    pub fn from_image(name: &str, image: &[u8]) -> Result<Self, String> {
        let bytes = if image.get(..4) == Some(b"3DSX") {
            cxi_from_3dsx(image, name)?
        } else {
            image.to_vec()
        };
        let config = Config {
            data_dir: data_dir(),
            ..Config::default()
        };
        let system = loader::load_bytes(name, bytes, config).map_err(|e| format!("3DS: {e}"))?;
        let mut machine = Self {
            system: Box::new(system),
            screens: Vec::new(),
            printed: 0,
            stopped: None,
            samples: Vec::new(),
            _converted: None,
        };
        machine.capture();
        Ok(machine)
    }

    pub fn from_path(path: &Path, image: &[u8]) -> Result<Self, String> {
        let converted = if image.get(..4) == Some(b"3DSX") {
            let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("3dsx");
            let cxi = cxi_from_3dsx(image, name)?;
            let file =
                std::env::temp_dir().join(format!("bun-engine-{}-{name}.cxi", std::process::id()));
            std::fs::write(&file, cxi).map_err(|e| format!("{}: {e}", file.display()))?;
            Some(TempImage(file))
        } else {
            None
        };
        let boot = converted.as_ref().map_or(path, |t| t.0.as_path());
        let config = Config {
            data_dir: data_dir(),
            ..Config::default()
        };
        let system = loader::load(boot, config).map_err(|e| format!("3DS: {e}"))?;
        let mut machine = Self {
            system: Box::new(system),
            screens: Vec::new(),
            printed: 0,
            stopped: None,
            samples: Vec::new(),
            _converted: converted,
        };
        machine.capture();
        Ok(machine)
    }

    fn capture(&mut self) {
        self.screens = [CtrScreen::Top, CtrScreen::Bottom]
            .into_iter()
            .map(|which| {
                let (rgba, width, height) = self.system.read_screen_scaled(which);
                let rgb = rgba
                    .chunks_exact(4)
                    .flat_map(|p| [p[0], p[1], p[2]])
                    .collect();
                Screen {
                    width: width as usize,
                    height: height as usize,
                    rgb,
                }
            })
            .collect();
    }
}

impl Machine for Ctr {
    fn name(&self) -> &'static str {
        "nintendo-3ds"
    }

    fn run_frame(&mut self) -> Step {
        if self.stopped.is_some() {
            return Step::Shutdown;
        }
        let outcome = self.system.run_frame();
        // Keep the DSP output for the host's sink, bounded to one second when nobody drains it.
        if self.samples.len() > SAMPLE_RATE as usize * 2 {
            self.samples.clear();
        }
        let pcm = self.system.take_audio();
        self.samples
            .extend(pcm.iter().flat_map(|pair| pair.map(|s| f32::from(s) / 32768.0)));
        self.capture();
        match outcome {
            FrameOutcome::Completed => Step::Frame,
            FrameOutcome::Exited => {
                self.stopped = Some("the title called svcExitProcess".into());
                Step::Shutdown
            }
            FrameOutcome::Faulted => {
                let fatal = self.system.fatal_errors.last().cloned().unwrap_or_default();
                self.stopped = Some(
                    format!("guest fault (svcBreak or unknown instruction) {fatal}")
                        .trim_end()
                        .to_owned(),
                );
                Step::Shutdown
            }
        }
    }

    fn screens(&self) -> Vec<Screen> {
        self.screens
            .iter()
            .map(|s| Screen {
                width: s.width,
                height: s.height,
                rgb: s.rgb.clone(),
            })
            .collect()
    }

    fn set_input(&mut self, input: Input) {
        self.system.set_input(InputState {
            buttons: PadState::from_bits_truncate(input.keys & 0xFFF),
            touch: input.touch,
            ..InputState::default()
        });
    }

    fn diagnostic(&self) -> Option<String> {
        self.stopped.clone()
    }

    fn refresh_rate(&self) -> f64 {
        REFRESH_RATE
    }

    fn sample_rate(&self) -> u32 {
        SAMPLE_RATE
    }

    fn audio(&mut self, out: &mut Vec<f32>) {
        out.append(&mut self.samples);
    }

    fn console(&mut self) -> Vec<u8> {
        let out = &self.system.debug_output;
        let new = out
            .get(self.printed..)
            .unwrap_or_default()
            .as_bytes()
            .to_vec();
        self.printed = out.len();
        new
    }
}

/// Saves, SD card and mods: `$BUN_ENGINE_DATA/3ds`, else the user data directory
/// (`%APPDATA%\bun-engine\3ds`, `$XDG_DATA_HOME/bun-engine/3ds` or `~/.local/share/bun-engine/3ds`).
/// Without it Zakuro would write into the working directory.
fn data_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("BUN_ENGINE_DATA") {
        return Some(PathBuf::from(dir).join("3ds"));
    }
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(|home| PathBuf::from(home).join(".local").join("share"))
            })
    };
    base.map(|base| base.join("bun-engine").join("3ds"))
}

const BASE: u32 = 0x0010_0000;
const PAGE: usize = 0x1000;
const MEDIA: usize = 0x200;

fn align(value: usize, to: usize) -> usize {
    value.div_ceil(to) * to
}

fn u32_at(data: &[u8], at: usize) -> Result<u32, String> {
    data.get(at..at + 4)
        .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
        .ok_or_else(|| "3DSX: truncated".to_owned())
}

/// Relocates a 3DSX image and wraps it in a NoCrypto CXI.
pub fn cxi_from_3dsx(file: &[u8], name: &str) -> Result<Vec<u8>, String> {
    let header_size = u16::from_le_bytes([file[4], file[5]]) as usize;
    let reloc_header_size = u16::from_le_bytes([file[6], file[7]]) as usize;
    let sizes = [
        u32_at(file, 0x10)? as usize,
        u32_at(file, 0x14)? as usize,
        u32_at(file, 0x18)? as usize,
    ];
    let bss = u32_at(file, 0x1C)? as usize;
    let (smdh, romfs) = if header_size >= 0x2C {
        let (smdh_offset, smdh_size, fs_offset) = (
            u32_at(file, 0x20)? as usize,
            u32_at(file, 0x24)? as usize,
            u32_at(file, 0x28)? as usize,
        );
        (
            file.get(smdh_offset..smdh_offset + smdh_size)
                .filter(|_| smdh_size != 0),
            file.get(fs_offset..).filter(|_| fs_offset != 0),
        )
    } else {
        (None, None)
    };
    if sizes[2] < bss {
        return Err("3DSX: BSS larger than the data segment".into());
    }

    let mut relocs = [[0u32; 2]; 3];
    for (i, r) in relocs.iter_mut().enumerate() {
        let at = header_size + i * reloc_header_size;
        *r = [u32_at(file, at)?, u32_at(file, at + 4)?];
    }
    // Page-aligned segments laid out flat from BASE, BSS included in data.
    let spans = sizes.map(|s| align(s, PAGE));
    let starts = [0, spans[0], spans[0] + spans[1]];
    let mut image = vec![0u8; spans.iter().sum()];
    let mut at = header_size + 3 * reloc_header_size;
    for (i, &size) in sizes.iter().enumerate() {
        let len = if i == 2 { size - bss } else { size };
        let bytes = file.get(at..at + len).ok_or("3DSX: truncated segment")?;
        image[starts[i]..starts[i] + len].copy_from_slice(bytes);
        at += len;
    }

    let translate = |flat: u32| -> u32 {
        let flat = flat as usize;
        let seg = if flat < starts[1] {
            0
        } else if flat < starts[2] {
            1
        } else {
            2
        };
        BASE + (starts[seg] + flat - [0, starts[1], starts[2]][seg]) as u32
    };
    for seg in 0..3 {
        let end = starts[seg] + spans[seg];
        for (table, &count) in relocs[seg].iter().enumerate() {
            let mut pos = starts[seg];
            for n in 0..count as usize {
                let entry = at + n * 4;
                let skip = u16::from_le_bytes(
                    file.get(entry..entry + 2)
                        .ok_or("3DSX: truncated relocations")?
                        .try_into()
                        .unwrap(),
                ) as usize;
                let patch =
                    u16::from_le_bytes(file[entry + 2..entry + 4].try_into().unwrap()) as usize;
                pos += skip * 4;
                for _ in 0..patch {
                    if pos + 4 > end {
                        break;
                    }
                    let word = u32::from_le_bytes(image[pos..pos + 4].try_into().unwrap());
                    let sub_type = word >> 28;
                    if sub_type >= 3 {
                        return Err(format!("3DSX: bad relocation target {word:#x}"));
                    }
                    let addr = translate(word & 0x0FFF_FFFF);
                    let value = if table == 0 {
                        addr
                    } else {
                        let here = BASE + pos as u32;
                        let rel = addr.wrapping_sub(here);
                        if sub_type == 1 { rel & !(1 << 31) } else { rel }
                    };
                    image[pos..pos + 4].copy_from_slice(&value.to_le_bytes());
                    pos += 4;
                }
            }
            at += count as usize * 4;
        }
    }

    let program_id = 0x0004_0000_0FF3_D500u64;
    let mut exheader = vec![0u8; 0x800];
    let title = name.as_bytes();
    exheader[..title.len().min(8)].copy_from_slice(&title[..title.len().min(8)]);
    exheader[0x0D] = 0x02; // SD application
    for (i, off) in [0x10usize, 0x20, 0x30].into_iter().enumerate() {
        exheader[off..off + 4].copy_from_slice(&(BASE + starts[i] as u32).to_le_bytes());
        exheader[off + 4..off + 8].copy_from_slice(&((spans[i] / PAGE) as u32).to_le_bytes());
        exheader[off + 8..off + 12].copy_from_slice(&(sizes[i] as u32).to_le_bytes());
    }
    exheader[0x1C..0x20].copy_from_slice(&0x1_0000u32.to_le_bytes()); // stack
    // BSS lives inside the data segment already (bss_size at 0x3C stays 0).
    let aci = 0x200;
    exheader[aci..aci + 8].copy_from_slice(&program_id.to_le_bytes());
    exheader[aci + 8..aci + 12].copy_from_slice(&2u32.to_le_bytes());
    exheader[aci + 0x0E] = 1 << 2; // ideal processor 0, affinity mask 1, Prod system mode
    exheader[aci + 0x0F] = 0x30;
    const SERVICES: [&str; 32] = [
        "APT:U", "ac:u", "am:net", "boss:U", "cam:u", "cecd:u", "cfg:nor", "cfg:u", "csnd:SND",
        "dsp::DSP", "frd:u", "fs:USER", "gsp::Gpu", "gsp::Lcd", "hid:USER", "http:C", "ir:rst",
        "ir:u", "ir:USER", "mic:u", "ndm:u", "news:s", "nwm::UDS", "ptm:u", "ptm:sysm", "pxi:dev",
        "soc:U", "ssl:C", "y2r:u", "ldr:ro", "mvd:STD", "qtm:u",
    ];
    for (i, service) in SERVICES.iter().enumerate() {
        let at = aci + 0x50 + i * 8;
        exheader[at..at + service.len()].copy_from_slice(service.as_bytes());
    }
    let mut caps = vec![0xFFFF_FFFFu32; 28];
    for (i, cap) in caps.iter_mut().take(6).enumerate() {
        *cap = 0xF0FF_FFFF | (i as u32) << 24; // every SVC
    }
    caps[6] = 0xFC00_0220; // kernel 2.32
    caps[7] = 0xFE00_0200; // handle table
    caps[8] = 0xFF00_0100; // APPLICATION memory
    for (i, cap) in caps.iter().enumerate() {
        let at = aci + 0x170 + i * 4;
        exheader[at..at + 4].copy_from_slice(&cap.to_le_bytes());
    }

    // ExeFS: .code, plus the SMDH as icon.
    let mut files: Vec<(&str, &[u8])> = vec![(".code", &image)];
    if let Some(smdh) = smdh {
        files.push(("icon", smdh));
    }
    let mut exefs = vec![0u8; 0x200];
    for (i, (name, data)) in files.iter().enumerate() {
        let offset = exefs.len() - 0x200;
        exefs[i * 0x10..i * 0x10 + name.len()].copy_from_slice(name.as_bytes());
        exefs[i * 0x10 + 8..i * 0x10 + 12].copy_from_slice(&(offset as u32).to_le_bytes());
        exefs[i * 0x10 + 12..i * 0x10 + 16].copy_from_slice(&(data.len() as u32).to_le_bytes());
        exefs.extend_from_slice(data);
        exefs.resize(align(exefs.len(), MEDIA), 0);
    }

    let exefs_offset = 0x200 + 0x800;
    let mut cxi = vec![0u8; exefs_offset];
    cxi[0x200..0xA00].copy_from_slice(&exheader);
    cxi.extend_from_slice(&exefs);
    let romfs_offset = align(cxi.len(), PAGE);
    if let Some(level3) = romfs {
        cxi.resize(romfs_offset, 0);
        // Minimal IVFC header: no master hash, level 3 at 0x1000 with 4 KiB blocks.
        let mut ivfc = vec![0u8; PAGE];
        ivfc[..4].copy_from_slice(b"IVFC");
        ivfc[4..8].copy_from_slice(&0x1_0000u32.to_le_bytes());
        for level in 0..3 {
            ivfc[0x0C + level * 0x18 + 0x10..0x0C + level * 0x18 + 0x14]
                .copy_from_slice(&12u32.to_le_bytes());
        }
        ivfc[0x0C + 2 * 0x18 + 8..0x0C + 2 * 0x18 + 16]
            .copy_from_slice(&(level3.len() as u64).to_le_bytes());
        ivfc[0x5C..0x60].copy_from_slice(&0x60u32.to_le_bytes());
        cxi.extend_from_slice(&ivfc);
        cxi.extend_from_slice(level3);
    }
    cxi.resize(align(cxi.len(), MEDIA), 0);

    let h = 0x100;
    let total = cxi.len();
    let mu = |v: usize| ((v / MEDIA) as u32).to_le_bytes();
    cxi[h..h + 4].copy_from_slice(b"NCCH");
    cxi[h + 4..h + 8].copy_from_slice(&mu(total));
    cxi[h + 8..h + 16].copy_from_slice(&program_id.to_le_bytes());
    cxi[h + 0x10..h + 0x12].copy_from_slice(b"00");
    cxi[h + 0x12..h + 0x14].copy_from_slice(&2u16.to_le_bytes());
    cxi[h + 0x18..h + 0x20].copy_from_slice(&program_id.to_le_bytes());
    cxi[h + 0x50..h + 0x5A].copy_from_slice(b"CTR-P-3DSX");
    cxi[h + 0x80..h + 0x84].copy_from_slice(&0x400u32.to_le_bytes());
    cxi[h + 0x88 + 4] = 1; // CTR platform
    cxi[h + 0x88 + 5] = 0x03; // data + executable
    cxi[h + 0x88 + 7] = if romfs.is_some() { 0x04 } else { 0x06 }; // NoCrypto (| NoMountRomFs)
    cxi[h + 0xA0..h + 0xA4].copy_from_slice(&mu(exefs_offset));
    cxi[h + 0xA4..h + 0xA8].copy_from_slice(&mu(exefs.len()));
    cxi[h + 0xA8..h + 0xAC].copy_from_slice(&mu(MEDIA));
    if romfs.is_some() {
        cxi[h + 0xB0..h + 0xB4].copy_from_slice(&mu(romfs_offset));
        cxi[h + 0xB4..h + 0xB8].copy_from_slice(&mu(total - romfs_offset));
        cxi[h + 0xB8..h + 0xBC].copy_from_slice(&mu(MEDIA));
    }
    Ok(cxi)
}
