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
pub const EASING_EMPHASIZED: Easing =
    Easing { name: "emphasized", cubic_bezier: "cubic-bezier(0.2, 0.0, 0, 1.0)" };

/// Emphasized decelerate — for elements entering the screen.
pub const EASING_EMPHASIZED_DECELERATE: Easing =
    Easing { name: "emphasized-decelerate", cubic_bezier: "cubic-bezier(0.05, 0.7, 0.1, 1.0)" };

/// Emphasized accelerate — for elements leaving the screen.
pub const EASING_EMPHASIZED_ACCELERATE: Easing =
    Easing { name: "emphasized-accelerate", cubic_bezier: "cubic-bezier(0.3, 0.0, 0.8, 0.15)" };

/// Standard — general-purpose easing for components that stay on screen.
pub const EASING_STANDARD: Easing =
    Easing { name: "standard", cubic_bezier: "cubic-bezier(0.2, 0.0, 0, 1.0)" };

/// Standard decelerate — entering or expanding element with standard curve.
pub const EASING_STANDARD_DECELERATE: Easing =
    Easing { name: "standard-decelerate", cubic_bezier: "cubic-bezier(0, 0, 0, 1)" };

/// Standard accelerate — exiting or collapsing element with standard curve.
pub const EASING_STANDARD_ACCELERATE: Easing =
    Easing { name: "standard-accelerate", cubic_bezier: "cubic-bezier(0.3, 0, 1, 1)" };

/// Linear — constant rate; for continuous indicators (progress, scrubbing).
pub const EASING_LINEAR: Easing =
    Easing { name: "linear", cubic_bezier: "cubic-bezier(0, 0, 1, 1)" };

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
pub const DURATION_SHORT1: Duration = Duration { name: "short1", ms: 50 };

/// Short2 — 100 ms.  Small component responses (checkbox, radio).
pub const DURATION_SHORT2: Duration = Duration { name: "short2", ms: 100 };

/// Short3 — 150 ms.  Default for simple component transitions (FAB collapse).
pub const DURATION_SHORT3: Duration = Duration { name: "short3", ms: 150 };

/// Short4 — 200 ms.  Tooltip, menu appear.
pub const DURATION_SHORT4: Duration = Duration { name: "short4", ms: 200 };

/// Medium1 — 250 ms.  Card expansion, dialog reveal.
pub const DURATION_MEDIUM1: Duration = Duration { name: "medium1", ms: 250 };

/// Medium2 — 300 ms.  Navigation transition, sheet.
pub const DURATION_MEDIUM2: Duration = Duration { name: "medium2", ms: 300 };

/// Medium3 — 350 ms.  Complex component transitions.
pub const DURATION_MEDIUM3: Duration = Duration { name: "medium3", ms: 350 };

/// Medium4 — 400 ms.  Larger component transitions.
pub const DURATION_MEDIUM4: Duration = Duration { name: "medium4", ms: 400 };

/// Long1 — 450 ms.  Complex layout transitions.
pub const DURATION_LONG1: Duration = Duration { name: "long1", ms: 450 };

/// Long2 — 500 ms.  Full-screen transitions.
pub const DURATION_LONG2: Duration = Duration { name: "long2", ms: 500 };

/// Long3 — 550 ms.
pub const DURATION_LONG3: Duration = Duration { name: "long3", ms: 550 };

/// Long4 — 600 ms.
pub const DURATION_LONG4: Duration = Duration { name: "long4", ms: 600 };

/// Extra-long1 — 700 ms.  Large expressive transitions.
pub const DURATION_EXTRA_LONG1: Duration = Duration { name: "extra-long1", ms: 700 };

/// Extra-long2 — 800 ms.
pub const DURATION_EXTRA_LONG2: Duration = Duration { name: "extra-long2", ms: 800 };

/// Extra-long3 — 900 ms.
pub const DURATION_EXTRA_LONG3: Duration = Duration { name: "extra-long3", ms: 900 };

/// Extra-long4 — 1000 ms.  Largest expressive transitions.
pub const DURATION_EXTRA_LONG4: Duration = Duration { name: "extra-long4", ms: 1000 };

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
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum MotionScheme {
    /// Hero motion with visible bounce on spatial springs (M3 default).
    #[default]
    Expressive,
    /// Utilitarian motion with minimal bounce.
    Standard,
}

/// A physical spring (unit mass) described by an M3 damping ratio and stiffness.
///
/// Values come from the MDC-Android `motionSpring*` attributes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct M3Spring {
    /// Damping ratio. `1.0` is critically damped (no overshoot).
    pub damping: f32,
    /// Stiffness for a unit mass.
    pub stiffness: f32,
}

/// `md.sys.motion.spring.fast.spatial` (expressive).
pub const FAST_SPATIAL: M3Spring = M3Spring { damping: 0.9, stiffness: 1400.0 };
/// `md.sys.motion.spring.fast.effects`.
pub const FAST_EFFECTS: M3Spring = M3Spring { damping: 1.0, stiffness: 3800.0 };
/// `md.sys.motion.spring.default.spatial` (expressive).
pub const DEFAULT_SPATIAL: M3Spring = M3Spring { damping: 0.9, stiffness: 700.0 };
/// `md.sys.motion.spring.default.effects`.
pub const DEFAULT_EFFECTS: M3Spring = M3Spring { damping: 1.0, stiffness: 1600.0 };
/// `md.sys.motion.spring.slow.spatial` (expressive).
pub const SLOW_SPATIAL: M3Spring = M3Spring { damping: 0.9, stiffness: 300.0 };
/// `md.sys.motion.spring.slow.effects`.
pub const SLOW_EFFECTS: M3Spring = M3Spring { damping: 1.0, stiffness: 800.0 };

/// Damping ratio of spatial springs in the standard scheme (no bounce).
pub const STANDARD_SPATIAL_DAMPING: f32 = 1.0;

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
        let base = match (speed, family) {
            (SpringSpeed::Fast, SpringFamily::Spatial) => FAST_SPATIAL,
            (SpringSpeed::Fast, SpringFamily::Effects) => FAST_EFFECTS,
            (SpringSpeed::Default, SpringFamily::Spatial) => DEFAULT_SPATIAL,
            (SpringSpeed::Default, SpringFamily::Effects) => DEFAULT_EFFECTS,
            (SpringSpeed::Slow, SpringFamily::Spatial) => SLOW_SPATIAL,
            (SpringSpeed::Slow, SpringFamily::Effects) => SLOW_EFFECTS,
        };
        match (scheme, family) {
            (MotionScheme::Standard, SpringFamily::Spatial) => {
                Self { damping: STANDARD_SPATIAL_DAMPING, stiffness: base.stiffness }
            },
            _ => base,
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
    WebSpring { name, curve: CubicBezier { x1, y1, x2, y2 }, ms }
}

/// Spring to web conversions from <https://m3.material.io/styles/motion/overview/specs>.
///
/// Ordered expressive then standard; within a scheme, spatial fast/default/slow
/// then effects fast/default/slow.
pub const WEB_SPRINGS: [WebSpring; 12] = [
    web("expressive-fast-spatial", 0.42, 1.67, 0.21, 0.90, 350),
    web("expressive-default-spatial", 0.38, 1.21, 0.22, 1.00, 500),
    web("expressive-slow-spatial", 0.39, 1.29, 0.35, 0.98, 650),
    web("expressive-fast-effects", 0.31, 0.94, 0.34, 1.00, 150),
    web("expressive-default-effects", 0.34, 0.80, 0.34, 1.00, 200),
    web("expressive-slow-effects", 0.34, 0.88, 0.34, 1.00, 300),
    web("standard-fast-spatial", 0.27, 1.06, 0.18, 1.00, 350),
    web("standard-default-spatial", 0.27, 1.06, 0.18, 1.00, 500),
    web("standard-slow-spatial", 0.27, 1.06, 0.18, 1.00, 750),
    web("standard-fast-effects", 0.31, 0.94, 0.34, 1.00, 150),
    web("standard-default-effects", 0.34, 0.80, 0.34, 1.00, 200),
    web("standard-slow-effects", 0.34, 0.88, 0.34, 1.00, 300),
];

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
            assert!(window[0].ms <= window[1].ms, "durations must be non-decreasing");
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
        (0..=3000_u16).map(|ms| spring.sample(f32::from(ms) / 1000.0)).fold(0.0, f32::max)
    }

    #[test]
    fn effects_springs_never_overshoot() {
        for spring in [FAST_EFFECTS, DEFAULT_EFFECTS, SLOW_EFFECTS] {
            assert!(peak(spring) <= 1.0 + 1e-4, "{spring:?} overshoots");
        }
    }

    #[test]
    fn expressive_spatial_springs_overshoot() {
        for spring in [FAST_SPATIAL, DEFAULT_SPATIAL, SLOW_SPATIAL] {
            assert!(peak(spring) > 1.0, "{spring:?} must overshoot");
        }
    }

    #[test]
    fn springs_settle_on_target() {
        for speed in SPEEDS {
            for family in [SpringFamily::Spatial, SpringFamily::Effects] {
                let spring = M3Spring::token(MotionScheme::Expressive, speed, family);
                assert!((spring.sample(3.0) - 1.0).abs() < 1e-3, "{spring:?} did not settle");
            }
        }
    }

    #[test]
    fn standard_scheme_removes_spatial_bounce() {
        for speed in SPEEDS {
            let spring = M3Spring::token(MotionScheme::Standard, speed, SpringFamily::Spatial);
            assert!(peak(spring) <= 1.0 + 1e-4, "{spring:?} overshoots");
        }
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
        let t =
            WebSpring::token(MotionScheme::Expressive, SpringSpeed::Slow, SpringFamily::Effects);
        assert_eq!(t.name, "expressive-slow-effects");
        let t =
            WebSpring::token(MotionScheme::Standard, SpringSpeed::Default, SpringFamily::Spatial);
        assert_eq!(t.name, "standard-default-spatial");
        assert_eq!(t.ms, 500);
    }

    #[test]
    fn bezier_endpoints_and_overshoot() {
        for token in &WEB_SPRINGS {
            assert!(token.curve.eval(0.0).abs() < 1e-5, "{}", token.name);
            assert!((token.curve.eval(1.0) - 1.0).abs() < 1e-5, "{}", token.name);
        }
        let fast =
            WebSpring::token(MotionScheme::Expressive, SpringSpeed::Fast, SpringFamily::Spatial);
        let max = (0..=100_u8).map(|i| fast.curve.eval(f32::from(i) / 100.0)).fold(0.0, f32::max);
        assert!(max > 1.0, "expressive fast spatial curve must overshoot");
        let linear = CubicBezier { x1: 0.0, y1: 0.0, x2: 1.0, y2: 1.0 };
        assert!((linear.eval(0.37) - 0.37).abs() < 1e-4);
    }

    #[test]
    fn sqrt_matches_std() {
        for v in [0.0_f32, 0.25, 2.0, 300.0, 3800.0] {
            assert!((sqrt_f32(v) - v.sqrt()).abs() < 1e-3);
        }
    }
}
