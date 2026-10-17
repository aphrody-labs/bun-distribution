//! Moonlight input packets (the client side of Moonshine's `control/input` parsers) and the
//! mapping from the engine's input layer (Bevy key codes, raw mouse, XInput pads).

use crate::bevy::input::{keyboard::KeyCode, mouse::MouseButton};

use crate::window::Pad;

/// Control-stream channels (moonlight-common-c `CTRL_CHANNEL_*`).
pub mod channel {
    pub const GENERIC: u8 = 0x00;
    pub const URGENT: u8 = 0x01;
    pub const KEYBOARD: u8 = 0x02;
    pub const MOUSE: u8 = 0x03;
    pub const GAMEPAD_BASE: u8 = 0x10;
    pub const COUNT: usize = 0x30;
}

const KEY_DOWN: u32 = 0x0000_0003;
const KEY_UP: u32 = 0x0000_0004;
const MOUSE_MOVE_REL: u32 = 0x0000_0007;
const MOUSE_BUTTON_DOWN: u32 = 0x0000_0008;
const MOUSE_BUTTON_UP: u32 = 0x0000_0009;
const SCROLL: u32 = 0x0000_000A;
const MULTI_CONTROLLER: u32 = 0x0000_000C;
const HSCROLL: u32 = 0x5500_0001;
const CONTROLLER_ARRIVAL: u32 = 0x5500_0004;

pub const MODIFIER_SHIFT: u8 = 0x01;
pub const MODIFIER_CTRL: u8 = 0x02;
pub const MODIFIER_ALT: u8 = 0x04;
pub const MODIFIER_META: u8 = 0x08;

/// One input event ready for the control stream (`0x0206` payload) and its ENet channel.
#[derive(Clone, Debug)]
pub struct InputPacket {
    pub channel: u8,
    pub reliable: bool,
    pub payload: Vec<u8>,
}

fn packet(channel: u8, reliable: bool, magic: u32, body: &[u8]) -> InputPacket {
    let mut payload = Vec::with_capacity(8 + body.len());
    payload.extend_from_slice(&((4 + body.len()) as u32).to_be_bytes());
    payload.extend_from_slice(&magic.to_le_bytes());
    payload.extend_from_slice(body);
    InputPacket {
        channel,
        reliable,
        payload,
    }
}

/// Keyboard event: Windows virtual-key code with Moonlight's 0x8000 flag.
pub fn key(vk: u8, pressed: bool, modifiers: u8) -> InputPacket {
    let code = 0x8000u16 | u16::from(vk);
    let mut body = [0u8; 6];
    body[1..3].copy_from_slice(&code.to_le_bytes());
    body[3] = modifiers;
    packet(
        channel::KEYBOARD,
        true,
        if pressed { KEY_DOWN } else { KEY_UP },
        &body,
    )
}

pub fn mouse_move(dx: i16, dy: i16) -> InputPacket {
    let mut body = [0u8; 4];
    body[0..2].copy_from_slice(&dx.to_be_bytes());
    body[2..4].copy_from_slice(&dy.to_be_bytes());
    packet(channel::MOUSE, false, MOUSE_MOVE_REL, &body)
}

pub fn mouse_button(button: MouseButton, pressed: bool) -> Option<InputPacket> {
    let id = match button {
        MouseButton::Left => 1,
        MouseButton::Middle => 2,
        MouseButton::Right => 3,
        MouseButton::Back => 4,
        MouseButton::Forward => 5,
        MouseButton::Other(_) => return None,
    };
    Some(packet(
        channel::MOUSE,
        true,
        if pressed {
            MOUSE_BUTTON_DOWN
        } else {
            MOUSE_BUTTON_UP
        },
        &[id],
    ))
}

/// Vertical scroll in WHEEL_DELTA units (120 per notch).
pub fn scroll(amount: i16) -> InputPacket {
    let mut body = [0u8; 6];
    body[0..2].copy_from_slice(&amount.to_be_bytes());
    body[2..4].copy_from_slice(&amount.to_be_bytes());
    packet(channel::MOUSE, true, SCROLL, &body)
}

pub fn hscroll(amount: i16) -> InputPacket {
    packet(channel::MOUSE, true, HSCROLL, &amount.to_be_bytes())
}

/// Sunshine controller arrival (Xbox type, analog triggers + rumble).
pub fn controller_arrival(index: u8) -> InputPacket {
    let mut body = [0u8; 8];
    body[0] = index;
    body[1] = 0x01; // Xbox
    body[2..4].copy_from_slice(&0x03u16.to_le_bytes());
    body[4..8].copy_from_slice(&0x0000_FFFFu32.to_le_bytes());
    packet(
        channel::GAMEPAD_BASE + index,
        true,
        CONTROLLER_ARRIVAL,
        &body,
    )
}

/// Full gamepad state (`NV_MULTI_CONTROLLER_PACKET`).
pub fn gamepad(index: u8, active_mask: u16, pad: &Pad) -> InputPacket {
    let mut body = Vec::with_capacity(26);
    body.extend_from_slice(&0x001Au16.to_le_bytes());
    body.extend_from_slice(&u16::from(index).to_le_bytes());
    body.extend_from_slice(&active_mask.to_le_bytes());
    body.extend_from_slice(&0x0014u16.to_le_bytes());
    body.extend_from_slice(&pad.buttons.to_le_bytes());
    body.push(pad.left_trigger);
    body.push(pad.right_trigger);
    for v in [
        pad.left_stick.0,
        pad.left_stick.1,
        pad.right_stick.0,
        pad.right_stick.1,
    ] {
        body.extend_from_slice(&v.to_le_bytes());
    }
    body.extend_from_slice(&0x009Cu16.to_le_bytes());
    body.extend_from_slice(&0u16.to_le_bytes());
    body.extend_from_slice(&0x0055u16.to_le_bytes());
    packet(channel::GAMEPAD_BASE + index, true, MULTI_CONTROLLER, &body)
}

/// Windows virtual-key code for a physical key.
pub fn virtual_key(code: KeyCode) -> Option<u8> {
    use KeyCode as K;
    let vk = match code {
        K::Backspace => 0x08,
        K::Tab => 0x09,
        K::Enter | K::NumpadEnter => 0x0D,
        K::ShiftLeft => 0xA0,
        K::ShiftRight => 0xA1,
        K::ControlLeft => 0xA2,
        K::ControlRight => 0xA3,
        K::AltLeft => 0xA4,
        K::AltRight => 0xA5,
        K::Pause => 0x13,
        K::CapsLock => 0x14,
        K::Escape => 0x1B,
        K::Space => 0x20,
        K::PageUp => 0x21,
        K::PageDown => 0x22,
        K::End => 0x23,
        K::Home => 0x24,
        K::ArrowLeft => 0x25,
        K::ArrowUp => 0x26,
        K::ArrowRight => 0x27,
        K::ArrowDown => 0x28,
        K::PrintScreen => 0x2C,
        K::Insert => 0x2D,
        K::Delete => 0x2E,
        K::Digit0 => 0x30,
        K::Digit1 => 0x31,
        K::Digit2 => 0x32,
        K::Digit3 => 0x33,
        K::Digit4 => 0x34,
        K::Digit5 => 0x35,
        K::Digit6 => 0x36,
        K::Digit7 => 0x37,
        K::Digit8 => 0x38,
        K::Digit9 => 0x39,
        K::KeyA => 0x41,
        K::KeyB => 0x42,
        K::KeyC => 0x43,
        K::KeyD => 0x44,
        K::KeyE => 0x45,
        K::KeyF => 0x46,
        K::KeyG => 0x47,
        K::KeyH => 0x48,
        K::KeyI => 0x49,
        K::KeyJ => 0x4A,
        K::KeyK => 0x4B,
        K::KeyL => 0x4C,
        K::KeyM => 0x4D,
        K::KeyN => 0x4E,
        K::KeyO => 0x4F,
        K::KeyP => 0x50,
        K::KeyQ => 0x51,
        K::KeyR => 0x52,
        K::KeyS => 0x53,
        K::KeyT => 0x54,
        K::KeyU => 0x55,
        K::KeyV => 0x56,
        K::KeyW => 0x57,
        K::KeyX => 0x58,
        K::KeyY => 0x59,
        K::KeyZ => 0x5A,
        K::SuperLeft => 0x5B,
        K::SuperRight => 0x5C,
        K::ContextMenu => 0x5D,
        K::Numpad0 => 0x60,
        K::Numpad1 => 0x61,
        K::Numpad2 => 0x62,
        K::Numpad3 => 0x63,
        K::Numpad4 => 0x64,
        K::Numpad5 => 0x65,
        K::Numpad6 => 0x66,
        K::Numpad7 => 0x67,
        K::Numpad8 => 0x68,
        K::Numpad9 => 0x69,
        K::NumpadMultiply => 0x6A,
        K::NumpadAdd => 0x6B,
        K::NumpadSubtract => 0x6D,
        K::NumpadDecimal => 0x6E,
        K::NumpadDivide => 0x6F,
        K::F1 => 0x70,
        K::F2 => 0x71,
        K::F3 => 0x72,
        K::F4 => 0x73,
        K::F5 => 0x74,
        K::F6 => 0x75,
        K::F7 => 0x76,
        K::F8 => 0x77,
        K::F9 => 0x78,
        K::F10 => 0x79,
        K::F11 => 0x7A,
        K::F12 => 0x7B,
        K::NumLock => 0x90,
        K::ScrollLock => 0x91,
        K::Semicolon => 0xBA,
        K::Equal => 0xBB,
        K::Comma => 0xBC,
        K::Minus => 0xBD,
        K::Period => 0xBE,
        K::Slash => 0xBF,
        K::Backquote => 0xC0,
        K::BracketLeft => 0xDB,
        K::Backslash => 0xDC,
        K::BracketRight => 0xDD,
        K::Quote => 0xDE,
        K::IntlBackslash => 0xE2,
        _ => return None,
    };
    Some(vk)
}

/// Modifier bit for a modifier key.
pub fn modifier_bit(code: KeyCode) -> u8 {
    match code {
        KeyCode::ShiftLeft | KeyCode::ShiftRight => MODIFIER_SHIFT,
        KeyCode::ControlLeft | KeyCode::ControlRight => MODIFIER_CTRL,
        KeyCode::AltLeft | KeyCode::AltRight => MODIFIER_ALT,
        KeyCode::SuperLeft | KeyCode::SuperRight => MODIFIER_META,
        _ => 0,
    }
}
