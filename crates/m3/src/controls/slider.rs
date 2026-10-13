// SPDX-License-Identifier: Apache-2.0
//! M3 Expressive continuous / stepped slider.

use aphrody_m3_tokens::component::{focus_indicator, slider as sl};
use serde::{Deserialize, Serialize};

use super::{Control, Event};
use crate::a11y::{AccessRole, Accessible, RangeValue};
use crate::interaction::Interaction;
use crate::keyboard::{Key, Orientation};
use crate::visual::{FOCUS_ROLE, Part, Radii, Rect, Tint, focus_ring, pick};

/// Inner track corner beside the handle: Google publishes
/// `md.comp.slider.active-track.inner-corner.corner-size: 0 2px 2px 0`, a per-corner value the
/// typed tables do not carry.
const INNER_CORNER: f32 = 2.0;
/// Keyboard steps of PageUp / PageDown (WAI-ARIA slider pattern).
const PAGE_STEPS: f32 = 10.0;
/// Keyboard step of a continuous slider, as a fraction of the range.
const CONTINUOUS_STEP: f32 = 0.01;

/// Slider.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Slider {
    /// Accessible name.
    pub label: String,
    /// Current value.
    pub value: f32,
    /// Minimum.
    pub min: f32,
    /// Maximum.
    pub max: f32,
    /// Discrete step (`None`: continuous).
    pub step: Option<f32>,
    /// Whether the slider accepts input.
    pub enabled: bool,
    /// Right-to-left (mirrors Left/Right and the track).
    pub rtl: bool,
    /// Track length in dp, set by the host layout.
    pub length: f32,
}

impl Slider {
    /// A continuous slider over `[min, max]`.
    #[must_use]
    pub fn new(label: impl Into<String>, min: f32, max: f32, value: f32) -> Self {
        Self {
            label: label.into(),
            value: value.clamp(min, max),
            min,
            max,
            step: None,
            enabled: true,
            rtl: false,
            length: 0.0,
        }
    }

    fn step(&self) -> f32 {
        self.step.unwrap_or((self.max - self.min) * CONTINUOUS_STEP)
    }

    /// Set the value, snapped to the step and clamped to the range.
    pub fn set(&mut self, value: f32) -> bool {
        let snapped = match self.step {
            Some(step) if step > 0.0 => self.min + ((value - self.min) / step).round() * step,
            _ => value,
        }
        .clamp(self.min, self.max);
        let changed = (snapped - self.value).abs() > f32::EPSILON;
        self.value = snapped;
        changed
    }

    /// Fraction of the range covered by the value.
    #[must_use]
    pub fn fraction(&self) -> f32 {
        if self.max > self.min {
            (self.value - self.min) / (self.max - self.min)
        } else {
            0.0
        }
    }
}

impl Control for Slider {
    fn accessible(&self) -> Accessible {
        let mut node = Accessible::new(AccessRole::Slider, &self.label);
        node.value = Some(RangeValue {
            now: self.value,
            min: self.min,
            max: self.max,
        });
        node.orientation = Some(Orientation::Horizontal);
        node.disabled = !self.enabled;
        node
    }

    fn handle_key(&mut self, key: Key) -> Option<Event> {
        if !self.enabled {
            return None;
        }
        let step = self.step();
        let forward = if self.rtl { -1.0 } else { 1.0 };
        let target = match key {
            Key::ArrowRight => self.value + step * forward,
            Key::ArrowLeft => self.value - step * forward,
            Key::ArrowUp => self.value + step,
            Key::ArrowDown => self.value - step,
            Key::PageUp => self.value + step * PAGE_STEPS,
            Key::PageDown => self.value - step * PAGE_STEPS,
            Key::Home => self.min,
            Key::End => self.max,
            _ => return None,
        };
        self.set(target).then_some(Event::ValueChanged(self.value))
    }

    fn size(&self) -> (f32, f32) {
        (self.length, sl::HANDLE_HEIGHT)
    }

    fn parts(&self, rect: Rect, interaction: Interaction) -> Vec<Part> {
        let interaction = interaction.with_disabled(interaction.disabled || !self.enabled);
        let disabled = interaction.disabled;
        let (_, cy) = rect.center();
        let handle_w = if !disabled && (interaction.pressed || interaction.dragged) {
            sl::PRESSED_HANDLE_WIDTH
        } else if !disabled && interaction.focused {
            sl::FOCUS_HANDLE_WIDTH
        } else {
            sl::HANDLE_WIDTH
        };
        let fraction = if self.rtl {
            1.0 - self.fraction()
        } else {
            self.fraction()
        };
        let handle_cx = rect.x + fraction * rect.w;
        let gap = sl::ACTIVE_HANDLE_PADDING + handle_w / 2.0;
        let track_h = sl::ACTIVE_TRACK_HEIGHT;
        let outer = Radii::shape(sl::ACTIVE_TRACK_SHAPE, f32::INFINITY, track_h).tl;
        let active = pick(
            disabled,
            Tint::solid(sl::ACTIVE_TRACK_COLOR),
            Tint::with(
                sl::DISABLED_ACTIVE_TRACK_COLOR,
                sl::DISABLED_ACTIVE_TRACK_OPACITY,
            ),
        );
        let inactive = pick(
            disabled,
            Tint::solid(sl::INACTIVE_TRACK_COLOR),
            Tint::with(
                sl::DISABLED_INACTIVE_TRACK_COLOR,
                sl::DISABLED_INACTIVE_TRACK_OPACITY,
            ),
        );
        let (start, end) = (rect.x, rect.x + rect.w);
        let (left_tint, right_tint) = if self.rtl {
            (inactive, active)
        } else {
            (active, inactive)
        };
        let mut parts = Vec::new();
        let left_w = handle_cx - gap - start;
        if left_w > 0.0 {
            parts.push(Part::Surface {
                rect: Rect::new(start, cy - track_h / 2.0, left_w, track_h),
                radii: Radii::leading(outer, INNER_CORNER.min(left_w / 2.0)),
                fill: Some(left_tint),
                outline: None,
                elevation: 0,
            });
        }
        let right_x = handle_cx + gap;
        if end - right_x > 0.0 {
            let w = end - right_x;
            parts.push(Part::Surface {
                rect: Rect::new(right_x, cy - track_h / 2.0, w, track_h),
                radii: Radii::trailing(outer, INNER_CORNER.min(w / 2.0)),
                fill: Some(right_tint),
                outline: None,
                elevation: 0,
            });
            if !self.rtl {
                let stop = sl::STOP_INDICATOR_SIZE;
                let stop_tint = pick(
                    disabled,
                    Tint::solid(sl::STOP_INDICATOR_COLOR),
                    Tint::solid(sl::DISABLED_STOP_INDICATOR_COLOR),
                );
                parts.push(Part::Surface {
                    rect: Rect::centered(
                        end - sl::STOP_INDICATOR_TRAILING_SPACE - stop / 2.0,
                        cy,
                        stop,
                        stop,
                    ),
                    radii: Radii::all(stop / 2.0),
                    fill: Some(stop_tint),
                    outline: None,
                    elevation: 0,
                });
            }
        }
        let handle = Rect::centered(handle_cx, cy, handle_w, sl::HANDLE_HEIGHT);
        let handle_radii = Radii::shape(sl::HANDLE_SHAPE, handle.w, handle.h);
        parts.push(Part::Surface {
            rect: handle,
            radii: handle_radii,
            fill: Some(pick(
                disabled,
                Tint::solid(sl::HANDLE_COLOR),
                Tint::with(sl::DISABLED_HANDLE_COLOR, sl::DISABLED_HANDLE_OPACITY),
            )),
            outline: None,
            elevation: 0,
        });
        parts.extend(focus_ring(
            handle,
            handle_radii,
            FOCUS_ROLE,
            focus_indicator::OUTER_OFFSET,
            interaction,
        ));
        parts
    }
}
