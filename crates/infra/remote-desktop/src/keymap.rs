// SPDX-License-Identifier: Apache-2.0
//! `KeyboardEvent.code` to Windows virtual-key / scan code / X11 keysym tables.

/// Windows virtual-key code for a `KeyboardEvent.code`.
pub fn code_to_vk(code: &str) -> Option<u8> {
    if let Some(l) = code.strip_prefix("Key") {
        let b = l.as_bytes();
        if b.len() == 1 && b[0].is_ascii_uppercase() {
            return Some(b[0]);
        }
    }
    if let Some(d) = code.strip_prefix("Digit") {
        let b = d.as_bytes();
        if b.len() == 1 && b[0].is_ascii_digit() {
            return Some(b[0]);
        }
    }
    if let Some(n) = fkey_number(code) {
        return Some(0x70 + (n - 1) as u8);
    }
    if let Some(d) = code.strip_prefix("Numpad") {
        let b = d.as_bytes();
        if b.len() == 1 && b[0].is_ascii_digit() {
            return Some(0x60 + (b[0] - b'0'));
        }
    }
    Some(match code {
        "ArrowLeft" => 0x25,
        "ArrowUp" => 0x26,
        "ArrowRight" => 0x27,
        "ArrowDown" => 0x28,
        "ShiftLeft" => 0xA0,
        "ShiftRight" => 0xA1,
        "ControlLeft" => 0xA2,
        "ControlRight" => 0xA3,
        "AltLeft" => 0xA4,
        "AltRight" => 0xA5,
        "MetaLeft" | "OSLeft" => 0x5B,
        "MetaRight" | "OSRight" => 0x5C,
        "ContextMenu" => 0x5D,
        "CapsLock" => 0x14,
        "NumLock" => 0x90,
        "ScrollLock" => 0x91,
        "PrintScreen" => 0x2C,
        "Pause" => 0x13,
        "Enter" | "NumpadEnter" => 0x0D,
        "Escape" => 0x1B,
        "Tab" => 0x09,
        "Backspace" => 0x08,
        "Delete" => 0x2E,
        "Home" => 0x24,
        "End" => 0x23,
        "PageUp" => 0x21,
        "PageDown" => 0x22,
        "Insert" => 0x2D,
        "Space" => 0x20,
        "Minus" => 0xBD,
        "Equal" => 0xBB,
        "BracketLeft" => 0xDB,
        "BracketRight" => 0xDD,
        "Backslash" => 0xDC,
        "Semicolon" => 0xBA,
        "Quote" => 0xDE,
        "Backquote" => 0xC0,
        "Comma" => 0xBC,
        "Period" => 0xBE,
        "Slash" => 0xBF,
        "IntlBackslash" => 0xE2,
        "NumpadMultiply" => 0x6A,
        "NumpadAdd" => 0x6B,
        "NumpadSubtract" => 0x6D,
        "NumpadDecimal" => 0x6E,
        "NumpadDivide" => 0x6F,
        "NumpadEqual" => 0x92,
        _ => return None,
    })
}

/// Hardware scan code for keys that need the extended flag on Windows
/// (so that e.g. arrows are not mistaken for numpad keys).
pub fn code_to_extended_scan(code: &str) -> Option<u16> {
    Some(match code {
        "Insert" => 0x52,
        "Delete" => 0x53,
        "Home" => 0x47,
        "End" => 0x4F,
        "PageUp" => 0x49,
        "PageDown" => 0x51,
        "ArrowUp" => 0x48,
        "ArrowLeft" => 0x4B,
        "ArrowRight" => 0x4D,
        "ArrowDown" => 0x50,
        "ControlRight" => 0x1D,
        "AltRight" => 0x38,
        "NumpadDivide" => 0x35,
        "NumpadEnter" => 0x1C,
        "MetaLeft" | "OSLeft" => 0x5B,
        "MetaRight" | "OSRight" => 0x5C,
        "ContextMenu" => 0x5D,
        _ => return None,
    })
}

/// X11 keysym for a `KeyboardEvent.code` (unshifted meaning).
pub fn code_to_keysym(code: &str) -> Option<u32> {
    if let Some(l) = code.strip_prefix("Key") {
        let b = l.as_bytes();
        if b.len() == 1 && b[0].is_ascii_uppercase() {
            return Some(u32::from(b[0].to_ascii_lowercase()));
        }
    }
    if let Some(d) = code.strip_prefix("Digit") {
        let b = d.as_bytes();
        if b.len() == 1 && b[0].is_ascii_digit() {
            return Some(u32::from(b[0]));
        }
    }
    if let Some(n) = fkey_number(code) {
        return Some(0xFFBE + n - 1);
    }
    if let Some(d) = code.strip_prefix("Numpad") {
        let b = d.as_bytes();
        if b.len() == 1 && b[0].is_ascii_digit() {
            return Some(0xFFB0 + u32::from(b[0] - b'0'));
        }
    }
    Some(match code {
        "ArrowLeft" => 0xFF51,
        "ArrowUp" => 0xFF52,
        "ArrowRight" => 0xFF53,
        "ArrowDown" => 0xFF54,
        "ShiftLeft" => 0xFFE1,
        "ShiftRight" => 0xFFE2,
        "ControlLeft" => 0xFFE3,
        "ControlRight" => 0xFFE4,
        "CapsLock" => 0xFFE5,
        "AltLeft" => 0xFFE9,
        "AltRight" => 0xFFEA,
        "MetaLeft" | "OSLeft" => 0xFFEB,
        "MetaRight" | "OSRight" => 0xFFEC,
        "ContextMenu" => 0xFF67,
        "NumLock" => 0xFF7F,
        "ScrollLock" => 0xFF14,
        "PrintScreen" => 0xFF61,
        "Pause" => 0xFF13,
        "Enter" => 0xFF0D,
        "NumpadEnter" => 0xFF8D,
        "Escape" => 0xFF1B,
        "Tab" => 0xFF09,
        "Backspace" => 0xFF08,
        "Delete" => 0xFFFF,
        "Home" => 0xFF50,
        "End" => 0xFF57,
        "PageUp" => 0xFF55,
        "PageDown" => 0xFF56,
        "Insert" => 0xFF63,
        "Space" => 0x20,
        "Minus" => 0x2D,
        "Equal" => 0x3D,
        "BracketLeft" => 0x5B,
        "BracketRight" => 0x5D,
        "Backslash" => 0x5C,
        "Semicolon" => 0x3B,
        "Quote" => 0x27,
        "Backquote" => 0x60,
        "Comma" => 0x2C,
        "Period" => 0x2E,
        "Slash" => 0x2F,
        "IntlBackslash" => 0x3C,
        "NumpadMultiply" => 0xFFAA,
        "NumpadAdd" => 0xFFAB,
        "NumpadSubtract" => 0xFFAD,
        "NumpadDecimal" => 0xFFAE,
        "NumpadDivide" => 0xFFAF,
        "NumpadEqual" => 0xFFBD,
        _ => return None,
    })
}

fn fkey_number(code: &str) -> Option<u32> {
    let n: u32 = code.strip_prefix('F')?.parse().ok()?;
    (1..=24).contains(&n).then_some(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all_codes() -> Vec<String> {
        let mut v = Vec::new();
        v.extend(('A'..='Z').map(|c| format!("Key{c}")));
        v.extend(('0'..='9').map(|c| format!("Digit{c}")));
        v.extend(('0'..='9').map(|c| format!("Numpad{c}")));
        v.extend((1..=24).map(|n| format!("F{n}")));
        for c in [
            "ArrowLeft",
            "ArrowUp",
            "ArrowRight",
            "ArrowDown",
            "ShiftLeft",
            "ShiftRight",
            "ControlLeft",
            "ControlRight",
            "AltLeft",
            "AltRight",
            "MetaLeft",
            "MetaRight",
            "ContextMenu",
            "CapsLock",
            "NumLock",
            "ScrollLock",
            "PrintScreen",
            "Pause",
            "Enter",
            "NumpadEnter",
            "Escape",
            "Tab",
            "Backspace",
            "Delete",
            "Home",
            "End",
            "PageUp",
            "PageDown",
            "Insert",
            "Space",
            "Minus",
            "Equal",
            "BracketLeft",
            "BracketRight",
            "Backslash",
            "Semicolon",
            "Quote",
            "Backquote",
            "Comma",
            "Period",
            "Slash",
            "IntlBackslash",
            "NumpadMultiply",
            "NumpadAdd",
            "NumpadSubtract",
            "NumpadDecimal",
            "NumpadDivide",
            "NumpadEqual",
        ] {
            v.push(c.to_owned());
        }
        v
    }

    #[test]
    fn every_code_maps_on_both_platforms() {
        for c in all_codes() {
            assert!(code_to_vk(&c).is_some(), "vk missing for {c}");
            assert!(code_to_keysym(&c).is_some(), "keysym missing for {c}");
        }
    }

    #[test]
    fn spot_values() {
        assert_eq!(code_to_vk("KeyA"), Some(0x41));
        assert_eq!(code_to_vk("Digit5"), Some(0x35));
        assert_eq!(code_to_vk("F24"), Some(0x87));
        assert_eq!(code_to_keysym("F1"), Some(0xFFBE));
        assert_eq!(code_to_keysym("KeyQ"), Some(u32::from(b'q')));
        assert_eq!(code_to_vk("F25"), None);
        assert_eq!(code_to_vk("Nope"), None);
        assert_eq!(code_to_extended_scan("ArrowUp"), Some(0x48));
    }
}
