// SPDX-License-Identifier: Apache-2.0
//! M3 motion values sourced from the canonical token crate.

pub use crate::facade::motion::{CubicBezier, M3Spring, SpringState};
pub use crate::facade::motion::{curve_rms_error, fit_cubic_bezier, settling_time_ms};

#[cfg(test)]
mod tests {
    use super::{M3Spring, SpringState, settling_time_ms};

    #[test]
    fn canonical_spring_has_finite_settling_time() {
        let spring = M3Spring {
            damping: 1.0,
            stiffness: 1600.0,
        };
        let milliseconds = settling_time_ms(spring);
        assert!(milliseconds > 0);
        let mut state = SpringState::default();
        spring.step(&mut state, 1.0, 1.0 / 60.0);
        assert!(state.value.is_finite());
    }
}
