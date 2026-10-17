//! The one input layer: Bevy keyboard and gamepads (gilrs) folded into the machine key bitmask
//! ([`crate::machine::keys`]) and the touch point of the second screen.

use crate::bevy::{
    ecs::prelude::*,
    platform::collections::HashMap,
};
#[cfg(feature = "render")]
use crate::bevy::input::{ButtonInput, keyboard::KeyCode};

use crate::machine::{Input, keys};

/// Machine input sampled in `PreUpdate`, read by `Machine::set_input` before every frame.
#[derive(Resource, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EngineInput {
    pub keys: u32,
    /// Touch point on the second screen, in its pixels (DS).
    pub touch: Option<(u16, u16)>,
}

impl EngineInput {
    pub fn machine(&self) -> Input {
        Input { keys: self.keys, touch: self.touch }
    }
}

/// Keys held on pads that do not come from Bevy (Steam Input, the stream client, scripts), by
/// source name. Their bits are OR-ed into [`EngineInput::keys`].
#[derive(Resource, Clone, Debug, Default)]
pub struct ExternalPads(pub HashMap<&'static str, u32>);

/// Keyboard map to machine bits. Defaults: Z/X = A/B, A/S = Y/X, Q/W = L/R, Enter = Start,
/// Right Shift or Backspace = Select, arrows = D-pad.
#[derive(Resource, Clone, Debug)]
pub struct KeyMap {
    #[cfg(feature = "render")]
    pub keys: Vec<(KeyCode, u32)>,
    /// Left-stick dead zone (0..1) for the D-pad bits.
    pub dead_zone: f32,
}

impl Default for KeyMap {
    fn default() -> Self {
        Self {
            #[cfg(feature = "render")]
            keys: vec![
                (KeyCode::KeyZ, keys::A),
                (KeyCode::KeyX, keys::B),
                (KeyCode::KeyA, keys::Y),
                (KeyCode::KeyS, keys::X),
                (KeyCode::KeyQ, keys::L),
                (KeyCode::KeyW, keys::R),
                (KeyCode::Enter, keys::START),
                (KeyCode::ShiftRight, keys::SELECT),
                (KeyCode::Backspace, keys::SELECT),
                (KeyCode::ArrowUp, keys::UP),
                (KeyCode::ArrowDown, keys::DOWN),
                (KeyCode::ArrowLeft, keys::LEFT),
                (KeyCode::ArrowRight, keys::RIGHT),
            ],
            dead_zone: 0.5,
        }
    }
}

/// Machine bits held on one Bevy gamepad (XInput layout: South = A, East = B, West = X, North = Y).
#[cfg(feature = "gamepad")]
pub fn gamepad_keys(pad: &crate::bevy::input::gamepad::Gamepad, dead_zone: f32) -> u32 {
    use crate::bevy::input::gamepad::GamepadButton as B;
    const MAP: [(B, u32); 12] = [
        (B::South, keys::A),
        (B::East, keys::B),
        (B::West, keys::X),
        (B::North, keys::Y),
        (B::LeftTrigger, keys::L),
        (B::RightTrigger, keys::R),
        (B::Start, keys::START),
        (B::Select, keys::SELECT),
        (B::DPadUp, keys::UP),
        (B::DPadDown, keys::DOWN),
        (B::DPadLeft, keys::LEFT),
        (B::DPadRight, keys::RIGHT),
    ];
    let mut bits = MAP.iter().filter(|(b, _)| pad.pressed(*b)).fold(0, |acc, (_, k)| acc | k);
    let stick = pad.left_stick();
    if stick.x < -dead_zone {
        bits |= keys::LEFT;
    } else if stick.x > dead_zone {
        bits |= keys::RIGHT;
    }
    if stick.y > dead_zone {
        bits |= keys::UP;
    } else if stick.y < -dead_zone {
        bits |= keys::DOWN;
    }
    bits
}

/// `PreUpdate`: rebuild [`EngineInput::keys`] from every source. The touch point is owned by the
/// machine view (it needs the camera).
pub(crate) fn gather(
    mut input: ResMut<EngineInput>,
    map: Res<KeyMap>,
    external: Res<ExternalPads>,
    #[cfg(feature = "render")] keyboard: Option<Res<ButtonInput<KeyCode>>>,
    #[cfg(feature = "gamepad")] pads: Query<&crate::bevy::input::gamepad::Gamepad>,
) {
    let mut bits = external.0.values().fold(0, |acc, k| acc | k);
    #[cfg(feature = "render")]
    if let Some(keyboard) = keyboard {
        bits |= map.keys.iter().filter(|(k, _)| keyboard.pressed(*k)).fold(0, |acc, (_, b)| acc | b);
    }
    #[cfg(feature = "gamepad")]
    for pad in &pads {
        bits |= gamepad_keys(pad, map.dead_zone);
    }
    let _ = &map;
    if input.keys != bits {
        input.keys = bits;
    }
}
