// SPDX-License-Identifier: Apache-2.0
//! Material Design 3 motion tokens.
//!
//! Provides standard easing curves and duration values that define the M3
//! motion system.  Use these tokens instead of ad-hoc `cubic-bezier` or
//! hand-picked millisecond values.
//!
//! Reference: <https://m3.material.io/styles/motion/easing-and-duration/tokens-specs>

// ── Easing curves ────────────────────────────────────────────────────────────

/// A named M3 easing curve expressed as a CSS `cubic-bezier(...)` string.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Easing {
    /// Human-readable name matching the M3 specification token name.
    pub name: &'static str,
    /// CSS `cubic-bezier(x1, y1, x2, y2)` string, ready for insertion into
    /// a `transition-timing-function` or `animation-timing-function` property.
    pub cubic_bezier: &'static str,
}

/// Emphasized — the default easing for most M3 transitions.
///
/// Produces a deceleration curve that starts fast and eases out, appropriate
/// for elements entering the screen or responding to user input.
///
/// The canonical emphasized curve is a two-segment path interpolator that has
/// no single `cubic-bezier` form; M3 recommends the standard curve as the CSS
/// fallback, so this value intentionally equals [`EASING_STANDARD`].
pub const EASING_EMPHASIZED: Easing = Easing {
    name: "emphasized",
    cubic_bezier: "cubic-bezier(0.2, 0, 0, 1)",
};

/// Emphasized decelerate — for elements entering the screen.
pub const EASING_EMPHASIZED_DECELERATE: Easing = Easing {
    name: "emphasized-decelerate",
    cubic_bezier: "cubic-bezier(0.05, 0.7, 0.1, 1)",
};

/// Emphasized accelerate — for elements leaving the screen.
pub const EASING_EMPHASIZED_ACCELERATE: Easing = Easing {
    name: "emphasized-accelerate",
    cubic_bezier: "cubic-bezier(0.3, 0, 0.8, 0.15)",
};

/// Standard — general-purpose easing for components that stay on screen.
pub const EASING_STANDARD: Easing = Easing {
    name: "standard",
    cubic_bezier: "cubic-bezier(0.2, 0, 0, 1)",
};

/// Standard decelerate — entering or expanding element with standard curve.
pub const EASING_STANDARD_DECELERATE: Easing = Easing {
    name: "standard-decelerate",
    cubic_bezier: "cubic-bezier(0, 0, 0, 1)",
};

/// Standard accelerate — exiting or collapsing element with standard curve.
pub const EASING_STANDARD_ACCELERATE: Easing = Easing {
    name: "standard-accelerate",
    cubic_bezier: "cubic-bezier(0.3, 0, 1, 1)",
};

/// Linear — constant rate; for continuous indicators (progress, scrubbing).
pub const EASING_LINEAR: Easing = Easing {
    name: "linear",
    cubic_bezier: "cubic-bezier(0, 0, 1, 1)",
};

/// Legacy (M2) easing, still served by material-web v2.5.0 and Gemini web.
pub const EASING_LEGACY: Easing = Easing {
    name: "legacy",
    cubic_bezier: "cubic-bezier(0.4, 0, 0.2, 1)",
};

/// Legacy accelerate.
pub const EASING_LEGACY_ACCELERATE: Easing = Easing {
    name: "legacy-accelerate",
    cubic_bezier: "cubic-bezier(0.4, 0, 1, 1)",
};

/// Legacy decelerate.
pub const EASING_LEGACY_DECELERATE: Easing = Easing {
    name: "legacy-decelerate",
    cubic_bezier: "cubic-bezier(0, 0, 0.2, 1)",
};

/// All seven M3 easing curves in spec order.
pub const ALL_EASINGS: [Easing; 7] = [
    EASING_EMPHASIZED,
    EASING_EMPHASIZED_DECELERATE,
    EASING_EMPHASIZED_ACCELERATE,
    EASING_STANDARD,
    EASING_STANDARD_DECELERATE,
    EASING_STANDARD_ACCELERATE,
    EASING_LINEAR,
];

// ── Durations ────────────────────────────────────────────────────────────────

/// Duration token pairing a name with a millisecond value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Duration {
    /// Specification token name (e.g. `"short1"`).
    pub name: &'static str,
    /// Duration in milliseconds.
    pub ms: u16,
}

/// Short1 — 50 ms.  Micro-interactions, icon state changes.
pub const DURATION_SHORT1: Duration = Duration {
    name: "short1",
    ms: 50,
};

/// Short2 — 100 ms.  Small component responses (checkbox, radio).
pub const DURATION_SHORT2: Duration = Duration {
    name: "short2",
    ms: 100,
};

/// Short3 — 150 ms.  Default for simple component transitions (FAB collapse).
pub const DURATION_SHORT3: Duration = Duration {
    name: "short3",
    ms: 150,
};

/// Short4 — 200 ms.  Tooltip, menu appear.
pub const DURATION_SHORT4: Duration = Duration {
    name: "short4",
    ms: 200,
};

/// Medium1 — 250 ms.  Card expansion, dialog reveal.
pub const DURATION_MEDIUM1: Duration = Duration {
    name: "medium1",
    ms: 250,
};

/// Medium2 — 300 ms.  Navigation transition, sheet.
pub const DURATION_MEDIUM2: Duration = Duration {
    name: "medium2",
    ms: 300,
};

/// Medium3 — 350 ms.  Complex component transitions.
pub const DURATION_MEDIUM3: Duration = Duration {
    name: "medium3",
    ms: 350,
};

/// Medium4 — 400 ms.  Larger component transitions.
pub const DURATION_MEDIUM4: Duration = Duration {
    name: "medium4",
    ms: 400,
};

/// Long1 — 450 ms.  Complex layout transitions.
pub const DURATION_LONG1: Duration = Duration {
    name: "long1",
    ms: 450,
};

/// Long2 — 500 ms.  Full-screen transitions.
pub const DURATION_LONG2: Duration = Duration {
    name: "long2",
    ms: 500,
};

/// Long3 — 550 ms.
pub const DURATION_LONG3: Duration = Duration {
    name: "long3",
    ms: 550,
};

/// Long4 — 600 ms.
pub const DURATION_LONG4: Duration = Duration {
    name: "long4",
    ms: 600,
};

/// Extra-long1 — 700 ms.  Large expressive transitions.
pub const DURATION_EXTRA_LONG1: Duration = Duration {
    name: "extra-long1",
    ms: 700,
};

/// Extra-long2 — 800 ms.
pub const DURATION_EXTRA_LONG2: Duration = Duration {
    name: "extra-long2",
    ms: 800,
};

/// Extra-long3 — 900 ms.
pub const DURATION_EXTRA_LONG3: Duration = Duration {
    name: "extra-long3",
    ms: 900,
};

/// Extra-long4 — 1000 ms.  Largest expressive transitions.
pub const DURATION_EXTRA_LONG4: Duration = Duration {
    name: "extra-long4",
    ms: 1000,
};

/// All 16 M3 duration tokens in ascending order (short1 → extra-long4).
pub const ALL_DURATIONS: [Duration; 16] = [
    DURATION_SHORT1,
    DURATION_SHORT2,
    DURATION_SHORT3,
    DURATION_SHORT4,
    DURATION_MEDIUM1,
    DURATION_MEDIUM2,
    DURATION_MEDIUM3,
    DURATION_MEDIUM4,
    DURATION_LONG1,
    DURATION_LONG2,
    DURATION_LONG3,
    DURATION_LONG4,
    DURATION_EXTRA_LONG1,
    DURATION_EXTRA_LONG2,
    DURATION_EXTRA_LONG3,
    DURATION_EXTRA_LONG4,
];

/// The six primary M3 duration values in milliseconds (50/150/200/250/300/400).
///
/// These are the durations most frequently referenced in the M3 motion guide
/// and correspond to the six archetypal use-cases.
pub const PRIMARY_DURATIONS_MS: [u16; 6] = [50, 150, 200, 250, 300, 400];

// ── Springs (M3 Expressive) ──────────────────────────────────────────────────

/// Spring token family: what kind of property the spring animates.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpringFamily {
    /// Position, rotation, size, corners.  Overshoot is allowed.
    Spatial,
    /// Color and opacity.  Never overshoots (damping ratio 1.0).
    Effects,
}

/// Spring token speed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpringSpeed {
    /// Small components (switch, button).
    Fast,
    /// Partial-screen surfaces (bottom sheet, navigation drawer).
    Default,
    /// Full-screen transitions.
    Slow,
}

/// M3 motion scheme.
///
/// Spring values come from Compose `ExpressiveMotionTokens` / `StandardMotionTokens`
/// (androidx `compose/material3`, `MotionScheme.expressive()` / `standard()`). The
/// `material-web` v2.5.0 token set (`_md-sys-motion.scss`, design system 34.0.21) ships a single
/// spring set that equals the Compose *Standard* scheme, so web targets default to
/// [`MotionScheme::Standard`] and native targets to [`MotionScheme::Expressive`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MotionScheme {
    /// Hero motion with visible bounce on spatial springs (Compose expressive tokens).
    Expressive,
    /// Utilitarian motion with minimal bounce (Compose standard tokens, material-web v2.5.0).
    Standard,
}

impl MotionScheme {
    /// Default on web targets: material-web v2.5.0 only carries the Standard set.
    pub const WEB_DEFAULT: Self = Self::Standard;
    /// Default on native targets (Compose, Aphrody GUI hosts): Expressive.
    pub const NATIVE_DEFAULT: Self = Self::Expressive;
    /// Default for the compilation target: [`Self::WEB_DEFAULT`] on `wasm32`, otherwise
    /// [`Self::NATIVE_DEFAULT`].
    pub const TARGET_DEFAULT: Self = if cfg!(target_arch = "wasm32") {
        Self::WEB_DEFAULT
    } else {
        Self::NATIVE_DEFAULT
    };
}

impl Default for MotionScheme {
    fn default() -> Self {
        Self::TARGET_DEFAULT
    }
}

/// A physical spring (unit mass) described by an M3 damping ratio and stiffness.
///
/// Values come from the Compose motion tokens (see [`MotionScheme`]).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct M3Spring {
    /// Damping ratio. `1.0` is critically damped (no overshoot).
    pub damping: f32,
    /// Stiffness for a unit mass.
    pub stiffness: f32,
}

/// `md.sys.motion.spring.fast.spatial`, Expressive (CMP `ExpressiveMotionTokens`): 0.6 / 800.
pub const EXPRESSIVE_FAST_SPATIAL: M3Spring = M3Spring {
    damping: 0.6,
    stiffness: 800.0,
};
/// `md.sys.motion.spring.default.spatial`, Expressive: 0.8 / 380.
pub const EXPRESSIVE_DEFAULT_SPATIAL: M3Spring = M3Spring {
    damping: 0.8,
    stiffness: 380.0,
};
/// `md.sys.motion.spring.slow.spatial`, Expressive: 0.8 / 200.
pub const EXPRESSIVE_SLOW_SPATIAL: M3Spring = M3Spring {
    damping: 0.8,
    stiffness: 200.0,
};
/// `md.sys.motion.spring.fast.spatial`, Standard (CMP `StandardMotionTokens`, material-web
/// v2.5.0): 0.9 / 1400.
pub const STANDARD_FAST_SPATIAL: M3Spring = M3Spring {
    damping: 0.9,
    stiffness: 1400.0,
};
/// `md.sys.motion.spring.default.spatial`, Standard: 0.9 / 700.
pub const STANDARD_DEFAULT_SPATIAL: M3Spring = M3Spring {
    damping: 0.9,
    stiffness: 700.0,
};
/// `md.sys.motion.spring.slow.spatial`, Standard: 0.9 / 300.
pub const STANDARD_SLOW_SPATIAL: M3Spring = M3Spring {
    damping: 0.9,
    stiffness: 300.0,
};
/// `md.sys.motion.spring.fast.effects` (both schemes): 1.0 / 3800.
pub const FAST_EFFECTS: M3Spring = M3Spring {
    damping: 1.0,
    stiffness: 3800.0,
};
/// `md.sys.motion.spring.default.effects` (both schemes): 1.0 / 1600.
pub const DEFAULT_EFFECTS: M3Spring = M3Spring {
    damping: 1.0,
    stiffness: 1600.0,
};
/// `md.sys.motion.spring.slow.effects` (both schemes): 1.0 / 800.
pub const SLOW_EFFECTS: M3Spring = M3Spring {
    damping: 1.0,
    stiffness: 800.0,
};

/// Square root through Newton iterations; keeps the module `no_std` without `libm`.
fn sqrt_f32(value: f32) -> f32 {
    if value <= 0.0 {
        return 0.0;
    }
    let mut guess = if value > 1.0 { value / 2.0 } else { 1.0 };
    for _ in 0..64 {
        let next = 0.5 * (guess + value / guess);
        if (next - guess).abs() <= f32::EPSILON * next {
            return next;
        }
        guess = next;
    }
    guess
}

impl M3Spring {
    /// Resolves the spring token for `scheme`, `speed` and `family`.
    #[must_use]
    pub const fn token(scheme: MotionScheme, speed: SpringSpeed, family: SpringFamily) -> Self {
        match (family, scheme, speed) {
            (SpringFamily::Effects, _, SpringSpeed::Fast) => FAST_EFFECTS,
            (SpringFamily::Effects, _, SpringSpeed::Default) => DEFAULT_EFFECTS,
            (SpringFamily::Effects, _, SpringSpeed::Slow) => SLOW_EFFECTS,
            (SpringFamily::Spatial, MotionScheme::Expressive, SpringSpeed::Fast) => {
                EXPRESSIVE_FAST_SPATIAL
            }
            (SpringFamily::Spatial, MotionScheme::Expressive, SpringSpeed::Default) => {
                EXPRESSIVE_DEFAULT_SPATIAL
            }
            (SpringFamily::Spatial, MotionScheme::Expressive, SpringSpeed::Slow) => {
                EXPRESSIVE_SLOW_SPATIAL
            }
            (SpringFamily::Spatial, MotionScheme::Standard, SpringSpeed::Fast) => {
                STANDARD_FAST_SPATIAL
            }
            (SpringFamily::Spatial, MotionScheme::Standard, SpringSpeed::Default) => {
                STANDARD_DEFAULT_SPATIAL
            }
            (SpringFamily::Spatial, MotionScheme::Standard, SpringSpeed::Slow) => {
                STANDARD_SLOW_SPATIAL
            }
        }
    }

    /// Advances `state` by `dt` seconds towards `target` (semi-implicit Euler).
    pub fn step(self, state: &mut SpringState, target: f32, dt: f32) {
        let omega = sqrt_f32(self.stiffness);
        let accel =
            -self.stiffness * (state.value - target) - 2.0 * self.damping * omega * state.velocity;
        state.velocity += accel * dt;
        state.value += state.velocity * dt;
    }

    /// Samples the normalized response (0 to 1) `t` seconds after release from rest.
    ///
    /// Integrates with a 1 ms substep, which is stable for every M3 token.
    #[must_use]
    pub fn sample(self, t: f32) -> f32 {
        const DT: f32 = 1.0 / 1000.0;
        let mut state = SpringState::default();
        let mut elapsed = 0.0;
        while elapsed + DT <= t {
            self.step(&mut state, 1.0, DT);
            elapsed += DT;
        }
        if t > elapsed {
            self.step(&mut state, 1.0, t - elapsed);
        }
        state.value
    }
}

/// Position and velocity of a value driven by an [`M3Spring`].
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct SpringState {
    /// Current value.
    pub value: f32,
    /// Current velocity in units per second.
    pub velocity: f32,
}

// ── Spring to cubic-bezier web conversion ────────────────────────────────────

/// Cubic Bézier approximation of a spring for targets without native springs
/// (CSS, wasm canvas).  Control points follow `cubic-bezier(x1, y1, x2, y2)`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CubicBezier {
    /// First control point x.
    pub x1: f32,
    /// First control point y (values above 1.0 encode overshoot).
    pub y1: f32,
    /// Second control point x.
    pub x2: f32,
    /// Second control point y.
    pub y2: f32,
}

impl CubicBezier {
    fn axis(p1: f32, p2: f32, u: f32) -> f32 {
        let v = 1.0 - u;
        3.0 * v * v * u * p1 + 3.0 * v * u * u * p2 + u * u * u
    }

    fn axis_derivative(p1: f32, p2: f32, u: f32) -> f32 {
        let v = 1.0 - u;
        3.0 * v * v * p1 + 6.0 * v * u * (p2 - p1) + 3.0 * u * u * (1.0 - p2)
    }

    /// Evaluates the eased progress for linear time `x` in `[0, 1]`.
    #[must_use]
    pub fn eval(self, x: f32) -> f32 {
        let x = x.clamp(0.0, 1.0);
        // Newton-Raphson on x(u) = x, then bisection when the slope vanishes.
        let mut u = x;
        for _ in 0..8 {
            let err = Self::axis(self.x1, self.x2, u) - x;
            if err.abs() < 1e-6 {
                return Self::axis(self.y1, self.y2, u);
            }
            let slope = Self::axis_derivative(self.x1, self.x2, u);
            if slope.abs() < 1e-6 {
                break;
            }
            u = (u - err / slope).clamp(0.0, 1.0);
        }
        let (mut lo, mut hi) = (0.0_f32, 1.0_f32);
        u = x;
        for _ in 0..32 {
            let value = Self::axis(self.x1, self.x2, u);
            if (value - x).abs() < 1e-6 {
                break;
            }
            if value < x {
                lo = u;
            } else {
                hi = u;
            }
            u = 0.5 * (lo + hi);
        }
        Self::axis(self.y1, self.y2, u)
    }
}

/// A spring token converted to a web curve plus duration.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WebSpring {
    /// Token name, e.g. `"expressive-fast-spatial"`.
    pub name: &'static str,
    /// Curve mimicking the spring.
    pub curve: CubicBezier,
    /// Duration in milliseconds.
    pub ms: u16,
}

const fn web(name: &'static str, x1: f32, y1: f32, x2: f32, y2: f32, ms: u16) -> WebSpring {
    WebSpring {
        name,
        curve: CubicBezier { x1, y1, x2, y2 },
        ms,
    }
}

/// Spring to web conversions: least-squares cubic-bezier fits of the step response of each
/// spring token, over its settling time (see [`fit_cubic_bezier`] and [`settling_time_ms`]).
///
/// The numbers are produced by the same coordinate-descent fit as [`fit_cubic_bezier`] (four
/// starts, 64 samples) and are checked against it by the `web_springs_match_fit` test. They
/// replace the earlier values that were derived from the wrong (0.9/700) expressive base.
/// Ordered expressive then standard; within a scheme, spatial fast/default/slow then effects
/// fast/default/slow. Effects springs are identical in both schemes.
#[allow(
    clippy::approx_constant,
    reason = "fitted bezier coefficient, not 1/pi"
)]
pub const WEB_SPRINGS: [WebSpring; 12] = [
    web("expressive-fast-spatial", 0.475, 1.498, 0.084, 1.000, 320),
    web(
        "expressive-default-spatial",
        0.318,
        0.475,
        0.143,
        1.149,
        370,
    ),
    web("expressive-slow-spatial", 0.312, 0.461, 0.146, 1.154, 510),
    web("expressive-fast-effects", 0.317, 0.573, 0.151, 0.990, 130),
    web(
        "expressive-default-effects",
        0.213,
        0.224,
        0.114,
        1.059,
        200,
    ),
    web("expressive-slow-effects", 0.194, 0.135, 0.124, 1.057, 270),
    web("standard-fast-spatial", 0.236, 0.172, 0.217, 1.031, 160),
    web("standard-default-spatial", 0.236, 0.158, 0.231, 1.019, 220),
    web("standard-slow-spatial", 0.231, 0.132, 0.237, 1.013, 330),
    web("standard-fast-effects", 0.317, 0.573, 0.151, 0.990, 130),
    web("standard-default-effects", 0.213, 0.224, 0.114, 1.059, 200),
    web("standard-slow-effects", 0.194, 0.135, 0.124, 1.057, 270),
];

/// Settling time of `spring` in whole milliseconds, rounded up to 10 ms: the first instant after
/// which the step response stays within 0.5 % of the target (capped at 6 s).
#[must_use]
pub fn settling_time_ms(spring: M3Spring) -> u16 {
    let mut state = SpringState::default();
    let mut last_outside = 0_u16;
    for ms in 1..=6000_u16 {
        spring.step(&mut state, 1.0, 1.0 / 1000.0);
        if (state.value - 1.0).abs() > 0.005 {
            last_outside = ms;
        }
    }
    last_outside.div_ceil(10) * 10
}

/// Number of samples (intervals) used by [`fit_cubic_bezier`].
const FIT_INTERVALS: usize = 64;

/// Root-mean-square error of `curve` against the step response of `spring` over `ms`.
#[must_use]
#[allow(clippy::cast_precision_loss)]
pub fn curve_rms_error(curve: CubicBezier, spring: M3Spring, ms: u16) -> f32 {
    let samples = response_samples(spring, ms);
    sqrt_f32(squared_error(curve, &samples) / (FIT_INTERVALS + 1) as f32)
}

#[allow(clippy::cast_possible_truncation)]
fn response_samples(spring: M3Spring, ms: u16) -> [f32; FIT_INTERVALS + 1] {
    let mut out = [0.0_f32; FIT_INTERVALS + 1];
    let mut state = SpringState::default();
    let mut elapsed_ms = 0_u32;
    for (i, slot) in out.iter_mut().enumerate() {
        let n = FIT_INTERVALS as u32;
        let target_ms = (i as u32 * u32::from(ms) + n / 2) / n;
        while elapsed_ms < target_ms {
            spring.step(&mut state, 1.0, 1.0 / 1000.0);
            elapsed_ms += 1;
        }
        *slot = state.value;
    }
    out
}

#[allow(clippy::cast_precision_loss)]
fn squared_error(curve: CubicBezier, samples: &[f32; FIT_INTERVALS + 1]) -> f32 {
    samples
        .iter()
        .enumerate()
        .map(|(i, target)| {
            let d = curve.eval(i as f32 / FIT_INTERVALS as f32) - target;
            d * d
        })
        .sum()
}

/// Least-squares cubic-bezier fit of the unit step response of `spring` over `ms` milliseconds.
///
/// Coordinate descent on the four control coordinates (`x1`, `x2` kept in `[0, 1]`, as CSS
/// requires) from four fixed starting curves, keeping the best result. Deterministic.
#[must_use]
pub fn fit_cubic_bezier(spring: M3Spring, ms: u16) -> CubicBezier {
    const STARTS: [[f32; 4]; 4] = [
        [0.3, 0.9, 0.3, 1.0],
        [0.5, 0.0, 0.2, 1.0],
        [0.2, 1.2, 0.2, 1.0],
        [0.4, 0.5, 0.1, 1.1],
    ];
    let samples = response_samples(spring, ms);
    let mut best = (
        CubicBezier {
            x1: 0.0,
            y1: 0.0,
            x2: 1.0,
            y2: 1.0,
        },
        f32::INFINITY,
    );
    for start in STARTS {
        let mut p = start;
        let build = |p: [f32; 4]| CubicBezier {
            x1: p[0],
            y1: p[1],
            x2: p[2],
            y2: p[3],
        };
        let mut err = squared_error(build(p), &samples);
        let mut step = 0.25_f32;
        for _ in 0..60 {
            let mut improved = false;
            for j in 0..4 {
                for delta in [step, -step] {
                    let mut q = p;
                    q[j] += delta;
                    if j == 0 || j == 2 {
                        q[j] = q[j].clamp(0.0, 1.0);
                    }
                    let e = squared_error(build(q), &samples);
                    if e < err - 1e-9 {
                        p = q;
                        err = e;
                        improved = true;
                    }
                }
            }
            if !improved {
                step *= 0.5;
            }
        }
        if err < best.1 {
            best = (build(p), err);
        }
    }
    best.0
}

impl WebSpring {
    /// Returns the web conversion of a spring token.
    #[must_use]
    pub const fn token(scheme: MotionScheme, speed: SpringSpeed, family: SpringFamily) -> Self {
        let scheme_offset = match scheme {
            MotionScheme::Expressive => 0,
            MotionScheme::Standard => 6,
        };
        let family_offset = match family {
            SpringFamily::Spatial => 0,
            SpringFamily::Effects => 3,
        };
        let speed_offset = match speed {
            SpringSpeed::Fast => 0,
            SpringSpeed::Default => 1,
            SpringSpeed::Slow => 2,
        };
        WEB_SPRINGS[scheme_offset + family_offset + speed_offset]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seven_standard_easings() {
        assert_eq!(ALL_EASINGS.len(), 7);
        assert_eq!(EASING_LINEAR.cubic_bezier, "cubic-bezier(0, 0, 1, 1)");
    }

    #[test]
    fn all_easings_have_cubic_bezier() {
        for e in &ALL_EASINGS {
            assert!(
                e.cubic_bezier.starts_with("cubic-bezier("),
                "easing '{}' must use cubic-bezier notation",
                e.name
            );
        }
    }

    #[test]
    fn primary_durations_are_in_spec_order() {
        assert_eq!(PRIMARY_DURATIONS_MS, [50, 150, 200, 250, 300, 400]);
    }

    #[test]
    fn all_durations_ascending() {
        for window in ALL_DURATIONS.windows(2) {
            assert!(
                window[0].ms <= window[1].ms,
                "durations must be non-decreasing"
            );
        }
    }

    #[test]
    fn long_and_extra_long_match_spec() {
        assert_eq!(DURATION_LONG1.ms, 450);
        assert_eq!(DURATION_LONG2.ms, 500);
        assert_eq!(DURATION_EXTRA_LONG4.ms, 1000);
        assert_eq!(ALL_DURATIONS.len(), 16);
    }

    const SPEEDS: [SpringSpeed; 3] = [SpringSpeed::Fast, SpringSpeed::Default, SpringSpeed::Slow];

    fn peak(spring: M3Spring) -> f32 {
        (0..=3000_u16)
            .map(|ms| spring.sample(f32::from(ms) / 1000.0))
            .fold(0.0, f32::max)
    }

    #[test]
    fn effects_springs_never_overshoot() {
        for spring in [FAST_EFFECTS, DEFAULT_EFFECTS, SLOW_EFFECTS] {
            assert!(peak(spring) <= 1.0 + 1e-4, "{spring:?} overshoots");
        }
    }

    #[test]
    fn expressive_spatial_springs_overshoot() {
        for spring in [
            EXPRESSIVE_FAST_SPATIAL,
            EXPRESSIVE_DEFAULT_SPATIAL,
            EXPRESSIVE_SLOW_SPATIAL,
        ] {
            assert!(peak(spring) > 1.0, "{spring:?} must overshoot");
        }
    }

    #[test]
    fn springs_settle_on_target() {
        for speed in SPEEDS {
            for family in [SpringFamily::Spatial, SpringFamily::Effects] {
                let spring = M3Spring::token(MotionScheme::Expressive, speed, family);
                assert!(
                    (spring.sample(3.0) - 1.0).abs() < 1e-3,
                    "{spring:?} did not settle"
                );
            }
        }
    }

    #[test]
    fn standard_scheme_is_nearly_bounce_free() {
        // Damping 0.9 overshoots by ~0.2 %, far below the expressive 1.4 % to 9.5 %.
        for speed in SPEEDS {
            let spring = M3Spring::token(MotionScheme::Standard, speed, SpringFamily::Spatial);
            assert!(peak(spring) < 1.005, "{spring:?} bounces");
        }
    }

    #[test]
    fn spring_tokens_match_compose() {
        use SpringFamily::{Effects, Spatial};
        use SpringSpeed::{Default as Def, Fast, Slow};
        let t = M3Spring::token;
        let e = MotionScheme::Expressive;
        let s = MotionScheme::Standard;
        assert_eq!(
            (t(e, Fast, Spatial).damping, t(e, Fast, Spatial).stiffness),
            (0.6, 800.0)
        );
        assert_eq!(
            (t(e, Def, Spatial).damping, t(e, Def, Spatial).stiffness),
            (0.8, 380.0)
        );
        assert_eq!(
            (t(e, Slow, Spatial).damping, t(e, Slow, Spatial).stiffness),
            (0.8, 200.0)
        );
        assert_eq!(
            (t(s, Fast, Spatial).damping, t(s, Fast, Spatial).stiffness),
            (0.9, 1400.0)
        );
        assert_eq!(
            (t(s, Def, Spatial).damping, t(s, Def, Spatial).stiffness),
            (0.9, 700.0)
        );
        assert_eq!(
            (t(s, Slow, Spatial).damping, t(s, Slow, Spatial).stiffness),
            (0.9, 300.0)
        );
        for scheme in [e, s] {
            assert_eq!(
                t(scheme, Fast, Effects),
                M3Spring {
                    damping: 1.0,
                    stiffness: 3800.0
                }
            );
            assert_eq!(
                t(scheme, Def, Effects),
                M3Spring {
                    damping: 1.0,
                    stiffness: 1600.0
                }
            );
            assert_eq!(
                t(scheme, Slow, Effects),
                M3Spring {
                    damping: 1.0,
                    stiffness: 800.0
                }
            );
        }
    }

    #[test]
    fn scheme_defaults_per_target() {
        assert_eq!(MotionScheme::WEB_DEFAULT, MotionScheme::Standard);
        assert_eq!(MotionScheme::NATIVE_DEFAULT, MotionScheme::Expressive);
        assert_eq!(MotionScheme::default(), MotionScheme::TARGET_DEFAULT);
    }

    #[test]
    fn web_springs_match_fit() {
        for token in &WEB_SPRINGS {
            let (scheme, rest) = token.name.split_once('-').unwrap();
            let (speed, family) = rest.split_once('-').unwrap();
            let scheme = if scheme == "expressive" {
                MotionScheme::Expressive
            } else {
                MotionScheme::Standard
            };
            let speed = match speed {
                "fast" => SpringSpeed::Fast,
                "default" => SpringSpeed::Default,
                _ => SpringSpeed::Slow,
            };
            let family = if family == "spatial" {
                SpringFamily::Spatial
            } else {
                SpringFamily::Effects
            };
            let spring = M3Spring::token(scheme, speed, family);
            let settle = settling_time_ms(spring);
            assert!(
                token.ms.abs_diff(settle) <= 10,
                "{} settling {settle} ms",
                token.name
            );
            let shipped = curve_rms_error(token.curve, spring, token.ms);
            let fitted = fit_cubic_bezier(spring, token.ms);
            let best = curve_rms_error(fitted, spring, token.ms);
            assert!(shipped < 0.03, "{} rms {shipped}", token.name);
            assert!(
                shipped <= best + 0.003,
                "{} shipped {shipped} vs fit {best}",
                token.name
            );
        }
    }

    #[test]
    fn fit_recovers_a_bezier_response() {
        // A critically damped spring is fitted far better than a linear ramp.
        let spring = DEFAULT_EFFECTS;
        let ms = settling_time_ms(spring);
        let fit = fit_cubic_bezier(spring, ms);
        let linear = CubicBezier {
            x1: 0.0,
            y1: 0.0,
            x2: 1.0,
            y2: 1.0,
        };
        assert!(curve_rms_error(fit, spring, ms) < 0.02);
        assert!(curve_rms_error(linear, spring, ms) > 0.1);
        assert!((0.0..=1.0).contains(&fit.x1) && (0.0..=1.0).contains(&fit.x2));
    }

    #[test]
    fn stiffness_decreases_fast_to_slow() {
        for family in [SpringFamily::Spatial, SpringFamily::Effects] {
            let s = SPEEDS
                .map(|speed| M3Spring::token(MotionScheme::Expressive, speed, family).stiffness);
            assert!(s[0] > s[1] && s[1] > s[2]);
        }
    }

    #[test]
    fn web_token_lookup_matches_names() {
        let t = WebSpring::token(
            MotionScheme::Expressive,
            SpringSpeed::Slow,
            SpringFamily::Effects,
        );
        assert_eq!(t.name, "expressive-slow-effects");
        let t = WebSpring::token(
            MotionScheme::Standard,
            SpringSpeed::Default,
            SpringFamily::Spatial,
        );
        assert_eq!(t.name, "standard-default-spatial");
        assert_eq!(t.ms, 220);
    }

    #[test]
    fn bezier_endpoints_and_overshoot() {
        for token in &WEB_SPRINGS {
            assert!(token.curve.eval(0.0).abs() < 1e-5, "{}", token.name);
            assert!((token.curve.eval(1.0) - 1.0).abs() < 1e-5, "{}", token.name);
        }
        let fast = WebSpring::token(
            MotionScheme::Expressive,
            SpringSpeed::Fast,
            SpringFamily::Spatial,
        );
        let max = (0..=100_u8)
            .map(|i| fast.curve.eval(f32::from(i) / 100.0))
            .fold(0.0, f32::max);
        assert!(max > 1.0, "expressive fast spatial curve must overshoot");
        let linear = CubicBezier {
            x1: 0.0,
            y1: 0.0,
            x2: 1.0,
            y2: 1.0,
        };
        assert!((linear.eval(0.37) - 0.37).abs() < 1e-4);
    }

    #[test]
    fn sqrt_matches_std() {
        for v in [0.0_f32, 0.25, 2.0, 300.0, 3800.0] {
            assert!((sqrt_f32(v) - v.sqrt()).abs() < 1e-3);
        }
    }
}
