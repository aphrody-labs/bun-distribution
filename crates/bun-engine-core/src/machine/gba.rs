//! Game Boy Advance on RustBoyAdvance-NG (`vendor/rustboyadvance-ng/core`). It boots through
//! Normmatt's open-source BIOS replacement shipped by that project, or a caller-supplied BIOS.

use rustboyadvance_core::prelude::{GameBoyAdvance, GamepakBuilder, NullAudio};

use super::{Input, Machine, Screen, Step};

/// Normmatt's free GBA BIOS replacement, as vendored by RustBoyAdvance-NG.
const FREE_BIOS: &[u8] =
    include_bytes!("../../../../vendor/rustboyadvance-ng/core/benches/roms/normatt_gba_bios.bin");

pub struct Gba {
    gba: Box<GameBoyAdvance>,
}

impl Gba {
    pub fn from_rom(rom: &[u8], bios: Option<&[u8]>) -> Result<Self, String> {
        let cartridge = GamepakBuilder::new()
            .buffer(rom)
            .without_backup_to_file()
            .build()
            .map_err(|e| format!("GBA ROM: {e:?}"))?;
        let bios = bios.unwrap_or(FREE_BIOS).to_vec().into_boxed_slice();
        let mut gba = Box::new(GameBoyAdvance::new(bios, cartridge, NullAudio::new()));
        gba.skip_bios();
        Ok(Self { gba })
    }

    /// Install the dispatcher of statically recompiled code (`crate::recomp::gba`); `None`
    /// restores pure interpretation.
    pub fn set_cpu_runner(&mut self, runner: Option<rustboyadvance_core::gba::CpuRunner>) {
        self.gba.set_cpu_runner(runner);
    }
}

impl Machine for Gba {
    fn name(&self) -> &'static str {
        "nintendo-game-boy-advance"
    }

    fn run_frame(&mut self) -> Step {
        self.gba.frame();
        Step::Frame
    }

    fn set_input(&mut self, input: Input) {
        // KEYINPUT is active-low and uses the same bit order as `keys`.
        *self.gba.get_key_state_mut() = !(input.keys as u16) & 0x3ff;
    }

    fn save_state(&mut self) -> Option<Vec<u8>> {
        self.gba.save_state().ok()
    }

    fn load_state(&mut self, state: &[u8]) -> Result<(), String> {
        self.gba
            .restore_state(state)
            .map_err(|e| format!("GBA state: {e}"))
    }

    fn screens(&self) -> Vec<Screen> {
        let rgb = self
            .gba
            .get_frame_buffer()
            .iter()
            .flat_map(|px| [(px >> 16) as u8, (px >> 8) as u8, *px as u8])
            .collect();
        vec![Screen {
            width: 240,
            height: 160,
            rgb,
        }]
    }
}
