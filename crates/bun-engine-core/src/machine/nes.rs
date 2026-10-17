//! NES on TetaNES (`vendor/tetanes/tetanes-core`): cycle-accurate CPU/PPU/APU, iNES and NES 2.0
//! cartridges, one 256x240 screen.

use tetanes_core::{
    control_deck::ControlDeck,
    input::{JoypadBtn, Player},
};

use super::{Input, Machine, Screen, Step, keys};

pub struct Nes {
    deck: ControlDeck,
    failed: bool,
}

impl Nes {
    pub fn from_rom(name: &str, rom: &[u8]) -> Result<Self, String> {
        let mut deck = ControlDeck::new();
        deck.load_rom(name, &mut std::io::Cursor::new(rom)).map_err(|e| format!("NES ROM: {e}"))?;
        Ok(Self { deck, failed: false })
    }
}

const BUTTONS: [(u32, JoypadBtn); 8] = [
    (keys::A, JoypadBtn::A),
    (keys::B, JoypadBtn::B),
    (keys::SELECT, JoypadBtn::Select),
    (keys::START, JoypadBtn::Start),
    (keys::UP, JoypadBtn::Up),
    (keys::DOWN, JoypadBtn::Down),
    (keys::LEFT, JoypadBtn::Left),
    (keys::RIGHT, JoypadBtn::Right),
];

impl Machine for Nes {
    fn name(&self) -> &'static str {
        "nintendo-nes"
    }

    fn run_frame(&mut self) -> Step {
        if self.failed {
            return Step::Shutdown;
        }
        match self.deck.clock_frame() {
            Ok(_) => Step::Frame,
            Err(_) => {
                self.failed = true;
                Step::Shutdown
            }
        }
    }

    fn set_input(&mut self, input: Input) {
        let pad = self.deck.joypad_mut(Player::One);
        for (bit, button) in BUTTONS {
            pad.set_button(button, input.keys & bit != 0);
        }
    }

    fn screens(&self) -> Vec<Screen> {
        let mut rgba = Box::new([0_u8; tetanes_core::video::Frame::SIZE]);
        self.deck.frame_buffer_into(&mut rgba);
        let rgb = rgba.chunks_exact(4).flat_map(|px| [px[0], px[1], px[2]]).collect();
        vec![Screen { width: 256, height: 240, rgb }]
    }
}
