// SPDX-License-Identifier: Apache-2.0
//! ARGB renderer storage over the native Material role owner.

pub use m3_tokens::role::Role;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(transparent)]
pub struct Color(pub u32);

impl Color {
    pub const TRANSPARENT: Self = Self(0);

    pub const fn argb(alpha: u8, red: u8, green: u8, blue: u8) -> Self {
        Self(((alpha as u32) << 24) | ((red as u32) << 16) | ((green as u32) << 8) | blue as u32)
    }

    pub const fn rgba(self) -> [u8; 4] {
        [
            (self.0 >> 16) as u8,
            (self.0 >> 8) as u8,
            self.0 as u8,
            (self.0 >> 24) as u8,
        ]
    }

    /// Source-over an opacity-scaled foreground onto this colour, retaining alpha.
    pub fn overlay(self, foreground: Self, opacity: u8) -> Self {
        let bg = self.rgba();
        let fg = foreground.rgba();
        let fa = u32::from(fg[3]) * u32::from(opacity) / 255;
        let ba = u32::from(bg[3]) * (255 - fa) / 255;
        let alpha = fa + ba;
        if alpha == 0 {
            return Self::TRANSPARENT;
        }
        let channel =
            |i| ((u32::from(fg[i]) * fa + u32::from(bg[i]) * ba + alpha / 2) / alpha) as u8;
        Self::argb(alpha as u8, channel(0), channel(1), channel(2))
    }

    /// Per-channel blend toward `other` in sRGB (alpha included); `t` is clamped to 0..=1.
    /// Hosts use it for scheme re-tints (dynamic color transitions).
    pub fn mix(self, other: Self, t: f32) -> Self {
        let t = if t < 0.0 {
            0.0
        } else if t > 1.0 {
            1.0
        } else {
            t
        };
        let a = self.rgba();
        let b = other.rgba();
        let channel = |i: usize| {
            let (from, to) = (f32::from(a[i]), f32::from(b[i]));
            (from + (to - from) * t + 0.5) as u8
        };
        Self::argb(channel(3), channel(0), channel(1), channel(2))
    }

    /// The same colour with its alpha scaled by `opacity` (0..=1).
    pub fn with_opacity(self, opacity: f32) -> Self {
        let [r, g, b, a] = self.rgba();
        let o = if opacity < 0.0 {
            0.0
        } else if opacity > 1.0 {
            1.0
        } else {
            opacity
        };
        Self::argb((f32::from(a) * o + 0.5) as u8, r, g, b)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ColorScheme(pub [Color; 49]);

impl ColorScheme {
    /// Import every computed role from the native token owner without recalculating its palette.
    pub const fn from_argb(values: [u32; 49]) -> Self {
        let mut colors = [Color::TRANSPARENT; 49];
        let mut index = 0;
        while index < 49 {
            colors[index] = Color(values[index]);
            index += 1;
        }
        Self(colors)
    }

    pub fn get(self, role: Role) -> Color {
        Role::ALL
            .iter()
            .position(|candidate| *candidate == role)
            .map_or(Color::TRANSPARENT, |index| self.0[index])
    }

    /// Blend every role toward `other` (see [`Color::mix`]).
    pub fn mix(self, other: Self, t: f32) -> Self {
        let mut colors = self.0;
        let mut index = 0;
        while index < colors.len() {
            colors[index] = colors[index].mix(other.0[index], t);
            index += 1;
        }
        Self(colors)
    }

    /// Import resolved roles keyed by kebab-case or camel-case name with `#rrggbb` values, as the
    /// Bun OS platform theme files serialize them (`bun-os-theme/1` `color` map). Every role is
    /// required once; unparsable values count as missing.
    #[cfg(feature = "std")]
    pub fn from_hex_roles<'a>(
        values: impl IntoIterator<Item = (&'a str, &'a str)>,
    ) -> Result<Self, SchemeError> {
        let named: std::vec::Vec<(&str, Color)> = values
            .into_iter()
            .filter_map(|(name, hex)| {
                m3_tokens::color_math::argb_from_hex(hex).map(|argb| (name, Color(argb)))
            })
            .collect();
        Self::from_named(&named)
    }

    /// Resolve every role through Material's HCT engine; no local palette is generated.
    #[cfg(feature = "std")]
    pub fn from_dynamic(scheme: &m3_tokens::scheme::DynamicScheme) -> Self {
        Self(Role::ALL.map(|role| Color(scheme.argb(role))))
    }

    /// Require each named role once; duplicates and missing roles never silently get defaults.
    pub fn from_named(values: &[(&str, Color)]) -> Result<Self, SchemeError> {
        let mut colors = [Color::TRANSPARENT; 49];
        let mut seen = 0_u64;
        for &(name, color) in values {
            let role = Role::from_name(name).ok_or(SchemeError::UnknownRole)?;
            let index = Role::ALL
                .iter()
                .position(|candidate| *candidate == role)
                .ok_or(SchemeError::UnknownRole)?;
            let bit = 1_u64 << index;
            if seen & bit != 0 {
                return Err(SchemeError::DuplicateRole(role));
            }
            seen |= bit;
            colors[index] = color;
        }
        if seen != (1_u64 << 49) - 1 {
            return Err(SchemeError::MissingRoles);
        }
        Ok(Self(colors))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SchemeError {
    UnknownRole,
    DuplicateRole(Role),
    MissingRoles,
}
