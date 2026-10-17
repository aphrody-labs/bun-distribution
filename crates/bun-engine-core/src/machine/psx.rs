//! PlayStation on StarPSX (`vendor/starpsx/core`). Needs a 512 KiB BIOS: the free PCSX-Redux
//! OpenBIOS (`bep add free-firmware openbios`) or a caller-supplied dump. Boots PS-EXE files by
//! sideloading them at the shell entry, and disc images (BIN/ISO) through the CD-ROM drive.

use starpsx_core::{Media, PSXBuilder, System};

use super::{Input, Machine, Screen, Step, keys};

pub struct Psx {
    system: Box<System>,
    screen: Screen,
}

impl Psx {
    pub fn new(bios: &[u8], media: &[u8]) -> Result<Self, String> {
        let bios: Box<[u8; 0x80000]> = bios
            .to_vec()
            .into_boxed_slice()
            .try_into()
            .map_err(|_| "PlayStation BIOS must be exactly 512 KiB".to_string())?;
        let media = if media.starts_with(b"PS-X EXE") {
            Media::Executable(media.to_vec())
        } else {
            Media::Binary(media.to_vec())
        };
        let system = PSXBuilder::new(bios).with_media(media).build().map_err(|e| format!("PlayStation: {e}"))?;
        Ok(Self { system: Box::new(system), screen: Screen { width: 320, height: 240, rgb: vec![0; 320 * 240 * 3] } })
    }
}

// Digital pad bits (active-low): Select, L3, R3, Start, Up, Right, Down, Left, L2, R2, L1, R1,
// Triangle, Circle, Cross, Square.
const PAD: [(u32, u16); 12] = [
    (keys::SELECT, 0),
    (keys::START, 3),
    (keys::UP, 4),
    (keys::RIGHT, 5),
    (keys::DOWN, 6),
    (keys::LEFT, 7),
    (keys::L, 10),
    (keys::R, 11),
    (keys::X, 12),
    (keys::A, 13),
    (keys::B, 14),
    (keys::Y, 15),
];

impl Machine for Psx {
    fn name(&self) -> &'static str {
        "sony-playstation"
    }

    fn run_frame(&mut self) -> Step {
        self.system.run_frame(false);
        if let Some(frame) = self.system.frame_buffer.take() {
            let [width, height] = frame.resolution;
            let rgb = frame.rgba.iter().flat_map(|c| [c.r, c.g, c.b]).collect();
            self.screen = Screen { width, height, rgb };
        }
        Step::Frame
    }

    fn set_input(&mut self, input: Input) {
        let mut pressed = 0_u16;
        for (bit, pad) in PAD {
            if input.keys & bit != 0 {
                pressed |= 1 << pad;
            }
        }
        self.system.gamepad_mut().set_buttons(!pressed);
    }

    fn screens(&self) -> Vec<Screen> {
        vec![Screen { width: self.screen.width, height: self.screen.height, rgb: self.screen.rgb.clone() }]
    }
}
