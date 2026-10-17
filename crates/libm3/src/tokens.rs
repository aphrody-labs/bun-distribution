// SPDX-License-Identifier: Apache-2.0
//! Renderer types adapted from Material's native token owner.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum TypeRole {
    DisplayLarge,
    DisplayMedium,
    DisplaySmall,
    HeadlineLarge,
    HeadlineMedium,
    HeadlineSmall,
    TitleLarge,
    TitleMedium,
    TitleSmall,
    BodyLarge,
    BodyMedium,
    BodySmall,
    LabelLarge,
    LabelMedium,
    LabelSmall,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TypeStyle {
    pub family: &'static str,
    pub size: f32,
    pub line_height: f32,
    pub tracking: f32,
    pub weight: u16,
}

const fn type_style(value: m3_tokens::typography::TypeStyle) -> TypeStyle {
    TypeStyle {
        family: value.font,
        size: value.size_dp,
        line_height: value.line_height_dp,
        tracking: value.letter_spacing_dp,
        weight: value.weight,
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Typography(pub [TypeStyle; 15]);

impl Typography {
    pub const fn get(self, role: TypeRole) -> TypeStyle {
        self.0[role as usize]
    }
    /// The host loads the font; changing the family never performs font discovery.
    pub fn with_family(mut self, family: &'static str) -> Self {
        for style in &mut self.0 {
            style.family = family;
        }
        self
    }
}

const fn typography() -> Typography {
    let mut values = [type_style(m3_tokens::typography::ALL[0]); 15];
    let mut index = 0;
    while index < values.len() {
        values[index] = type_style(m3_tokens::typography::ALL[index]);
        index += 1;
    }
    Typography(values)
}

pub const TYPOGRAPHY: Typography = typography();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ShapeRole {
    None,
    ExtraSmall,
    Small,
    Medium,
    Large,
    LargeIncreased,
    ExtraLarge,
    ExtraLargeIncreased,
    ExtraExtraLarge,
    Full,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shapes(pub [u16; 10]);

impl Shapes {
    pub const fn get(self, role: ShapeRole) -> u16 {
        self.0[role as usize]
    }
    pub fn radius(self, role: ShapeRole, shortest_side: f32) -> f32 {
        f32::from(self.get(role)).min(shortest_side.max(0.0) / 2.0)
    }
}

const fn shapes() -> Shapes {
    let mut values = [0; 10];
    let mut index = 0;
    while index < values.len() {
        values[index] = m3_tokens::shape::ALL[index].dp;
        index += 1;
    }
    Shapes(values)
}
pub const SHAPES: Shapes = shapes();

const fn elevations() -> [u16; 6] {
    let mut values = [0; 6];
    let mut index = 0;
    while index < values.len() {
        values[index] = m3_tokens::elevation::dp(index) as u16;
        index += 1;
    }
    values
}
pub const ELEVATION_DP: [u16; 6] = elevations();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Motion {
    Reduced,
    Standard,
    Expressive,
}

impl Motion {
    pub const fn duration_ms(self, entering: bool) -> u16 {
        match self {
            Self::Reduced => 0,
            Self::Standard => {
                if entering {
                    m3_tokens::motion::DURATION_SHORT4.ms
                } else {
                    m3_tokens::motion::DURATION_SHORT3.ms
                }
            }
            Self::Expressive => {
                if entering {
                    m3_tokens::motion::DURATION_MEDIUM3.ms
                } else {
                    m3_tokens::motion::DURATION_SHORT4.ms
                }
            }
        }
    }
}

/// Parse an M3 easing token (`cubic-bezier(x1, y1, x2, y2)`) into an evaluable curve, so
/// renderers animate with the owner's token instead of restating its control points.
pub fn easing_curve(easing: m3_tokens::motion::Easing) -> Option<m3_tokens::motion::CubicBezier> {
    let inner = easing
        .cubic_bezier
        .trim()
        .strip_prefix("cubic-bezier(")?
        .strip_suffix(')')?;
    let mut values = inner.split(',').map(|v| v.trim().parse::<f32>());
    let mut next = || values.next().and_then(Result::ok);
    let curve = m3_tokens::motion::CubicBezier {
        x1: next()?,
        y1: next()?,
        x2: next()?,
        y2: next()?,
    };
    Some(curve)
}
