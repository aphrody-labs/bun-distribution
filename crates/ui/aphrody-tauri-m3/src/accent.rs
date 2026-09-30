// SPDX-License-Identifier: Apache-2.0
//! The operating system accent colour, used as the dynamic-colour seed of native apps (the
//! desktop equivalent of Android's wallpaper-based Material You).
//!
//! | OS | Source |
//! | --- | --- |
//! | Windows | DWM colorization colour (`DwmGetColorizationColor`), the Settings accent |
//! | Linux | XDG Settings portal `org.freedesktop.appearance accent-color`; GNOME 47+ `gsettings` when no portal is reachable |
//! | macOS, others | none: callers fall back to their configured seed |

/// Opaque ARGB accent colour of the desktop, when the OS exposes one.
#[must_use]
pub fn system_accent() -> Option<u32> {
    imp::system_accent()
}

/// GNOME accent names and the colours of the GNOME/libadwaita palette.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const GNOME_ACCENTS: &[(&str, u32)] = &[
    ("blue", 0xFF35_84E4),
    ("teal", 0xFF21_90A4),
    ("green", 0xFF3A_944A),
    ("yellow", 0xFFC8_8800),
    ("orange", 0xFFED_5B00),
    ("red", 0xFFE6_2D42),
    ("pink", 0xFFD5_6199),
    ("purple", 0xFF91_41AC),
    ("slate", 0xFF6F_8396),
];

/// The colour of a `gsettings get` accent value such as `'blue'`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn gnome_accent(value: &str) -> Option<u32> {
    let name = value.trim().trim_matches('\'');
    GNOME_ACCENTS.iter().find(|(n, _)| *n == name).map(|(_, argb)| *argb)
}

/// The colour of an XDG portal `accent-color` value: sRGB components in `[0, 1]`.
/// Components outside that range mean "no accent configured" per the portal spec.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn portal_accent_rgb((r, g, b): (f64, f64, f64)) -> Option<u32> {
    let channel = |c: f64| {
        // Truncation is intended: the value is rounded and clamped to 0..=255 first.
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        (0.0..=1.0).contains(&c).then(|| (c * 255.0).round() as u32)
    };
    Some(0xFF00_0000 | channel(r)? << 16 | channel(g)? << 8 | channel(b)?)
}

#[cfg(windows)]
mod imp {
    use windows::Win32::Graphics::Dwm::DwmGetColorizationColor;

    pub(super) fn system_accent() -> Option<u32> {
        let mut color = 0_u32;
        let mut opaque = windows::core::BOOL::default();
        // SAFETY: both out-pointers reference live locals for the duration of the call.
        unsafe { DwmGetColorizationColor(&raw mut color, &raw mut opaque) }.ok()?;
        // Drop the colorization alpha: M3 seeds are opaque.
        Some(0xFF00_0000 | (color & 0x00FF_FFFF))
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use zbus::zvariant::{OwnedValue, Value};

    const PORTAL_DEST: &str = "org.freedesktop.portal.Desktop";
    const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
    const SETTINGS_IFACE: &str = "org.freedesktop.portal.Settings";
    const KEY: (&str, &str) = ("org.freedesktop.appearance", "accent-color");

    pub(super) fn system_accent() -> Option<u32> {
        match portal_accent() {
            // The portal answered: honour it, including "no accent configured".
            Ok(accent) => accent,
            // No session bus or no Settings portal: fall back to GNOME's gsettings.
            Err(_) => gsettings_accent(),
        }
    }

    /// `org.freedesktop.appearance accent-color` from the XDG Settings portal.
    fn portal_accent() -> zbus::Result<Option<u32>> {
        let conn = zbus::blocking::Connection::session()?;
        let reply = conn
            .call_method(Some(PORTAL_DEST), PORTAL_PATH, Some(SETTINGS_IFACE), "ReadOne", &KEY)
            .or_else(|_| {
                // Settings portal < v2 only has the deprecated `Read`.
                conn.call_method(Some(PORTAL_DEST), PORTAL_PATH, Some(SETTINGS_IFACE), "Read", &KEY)
            })?;
        let value: OwnedValue = reply.body().deserialize()?;
        // `Read` wraps the value in one more variant layer than `ReadOne`.
        let value = match &*value {
            Value::Value(inner) => OwnedValue::try_from(&**inner)?,
            _ => value,
        };
        let rgb: (f64, f64, f64) = value.try_into()?;
        Ok(super::portal_accent_rgb(rgb))
    }

    fn gsettings_accent() -> Option<u32> {
        let output = std::process::Command::new("gsettings")
            .args(["get", "org.gnome.desktop.interface", "accent-color"])
            .output()
            .ok()?;
        output
            .status
            .success()
            .then(|| super::gnome_accent(&String::from_utf8_lossy(&output.stdout)))?
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
mod imp {
    pub(super) const fn system_accent() -> Option<u32> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portal_accent_components() {
        assert_eq!(portal_accent_rgb((0.0, 0.0, 0.0)), Some(0xFF00_0000));
        assert_eq!(portal_accent_rgb((1.0, 0.5, 0.0)), Some(0xFFFF_8000));
        assert_eq!(portal_accent_rgb((-1.0, 0.2, 0.2)), None);
        assert_eq!(portal_accent_rgb((0.2, 0.2, 1.5)), None);
    }

    #[test]
    fn gnome_accent_names() {
        assert_eq!(gnome_accent("'blue'\n"), Some(0xFF35_84E4));
        assert_eq!(gnome_accent("'slate'"), Some(0xFF6F_8396));
        assert_eq!(gnome_accent("'mauve'"), None);
    }

    #[test]
    fn system_accent_is_opaque_when_present() {
        if let Some(argb) = system_accent() {
            assert_eq!(argb >> 24, 0xFF);
        }
    }
}
