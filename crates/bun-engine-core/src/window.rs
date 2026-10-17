//! Shared gamepad layout. The window, surface, event loop and input layer are Bevy's
//! (`crate::runtime`); this module keeps the XInput pad state that the GameStream protocol and
//! Steam Input exchange.

/// Gamepad state in XInput layout (the Moonlight wire layout uses the same button bits).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Pad {
    pub buttons: u16,
    pub left_trigger: u8,
    pub right_trigger: u8,
    pub left_stick: (i16, i16),
    pub right_stick: (i16, i16),
}

/// XInput button bits.
pub mod pad_buttons {
    pub const DPAD_UP: u16 = 0x0001;
    pub const DPAD_DOWN: u16 = 0x0002;
    pub const DPAD_LEFT: u16 = 0x0004;
    pub const DPAD_RIGHT: u16 = 0x0008;
    pub const START: u16 = 0x0010;
    pub const BACK: u16 = 0x0020;
    pub const LEFT_THUMB: u16 = 0x0040;
    pub const RIGHT_THUMB: u16 = 0x0080;
    pub const LEFT_SHOULDER: u16 = 0x0100;
    pub const RIGHT_SHOULDER: u16 = 0x0200;
    pub const GUIDE: u16 = 0x0400;
    pub const A: u16 = 0x1000;
    pub const B: u16 = 0x2000;
    pub const X: u16 = 0x4000;
    pub const Y: u16 = 0x8000;
}

/// A Bevy gamepad in XInput layout.
#[cfg(feature = "gamepad")]
pub fn pad_from_bevy(pad: &crate::bevy::input::gamepad::Gamepad) -> Pad {
    use crate::bevy::input::gamepad::{GamepadAxis as A, GamepadButton as B};
    const MAP: [(B, u16); 15] = [
        (B::DPadUp, pad_buttons::DPAD_UP),
        (B::DPadDown, pad_buttons::DPAD_DOWN),
        (B::DPadLeft, pad_buttons::DPAD_LEFT),
        (B::DPadRight, pad_buttons::DPAD_RIGHT),
        (B::Start, pad_buttons::START),
        (B::Select, pad_buttons::BACK),
        (B::LeftThumb, pad_buttons::LEFT_THUMB),
        (B::RightThumb, pad_buttons::RIGHT_THUMB),
        (B::LeftTrigger, pad_buttons::LEFT_SHOULDER),
        (B::RightTrigger, pad_buttons::RIGHT_SHOULDER),
        (B::Mode, pad_buttons::GUIDE),
        (B::South, pad_buttons::A),
        (B::East, pad_buttons::B),
        (B::West, pad_buttons::X),
        (B::North, pad_buttons::Y),
    ];
    let axis = |a: A| (pad.get(a).unwrap_or(0.0).clamp(-1.0, 1.0) * 32767.0) as i16;
    let trigger = |b: B| (pad.get(b).unwrap_or(0.0).clamp(0.0, 1.0) * 255.0) as u8;
    Pad {
        buttons: MAP
            .iter()
            .filter(|(b, _)| pad.pressed(*b))
            .fold(0, |acc, (_, bit)| acc | bit),
        left_trigger: trigger(B::LeftTrigger2),
        right_trigger: trigger(B::RightTrigger2),
        left_stick: (axis(A::LeftStickX), axis(A::LeftStickY)),
        right_stick: (axis(A::RightStickX), axis(A::RightStickY)),
    }
}
