// SPDX-License-Identifier: Apache-2.0
//! M3 Expressive loading indicator.
//!
//! Google's indicator morphs through seven Material shapes while rotating; that shape morph is
//! not reproduced here. The active indicator is drawn as its `full`-shape container size and
//! hosts animate rotation themselves.

use aphrody_m3_tokens::component::loading_indicator as li;
use serde::{Deserialize, Serialize};

use super::{Control, Event};
use crate::a11y::{AccessRole, Accessible, RangeValue};
use crate::interaction::Interaction;
use crate::keyboard::Key;
use crate::visual::{Part, Radii, Rect, Tint};

/// Loading indicator (indeterminate unless `progress` is set).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LoadingIndicator {
    /// Accessible name.
    pub label: String,
    /// Draw the contained variant.
    pub contained: bool,
    /// Determinate progress in `[0, 1]`.
    pub progress: Option<f32>,
}

impl LoadingIndicator {
    /// An indeterminate, uncontained indicator.
    #[must_use]
    pub fn new(label: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            contained: false,
            progress: None,
        }
    }
}

impl Control for LoadingIndicator {
    fn accessible(&self) -> Accessible {
        let mut node = Accessible::new(AccessRole::ProgressBar, &self.label);
        node.focusable = false;
        node.busy = self.progress.is_none_or(|progress| progress < 1.0);
        node.value = self.progress.map(|progress| RangeValue {
            now: progress * 100.0,
            min: 0.0,
            max: 100.0,
        });
        node
    }

    fn handle_key(&mut self, _key: Key) -> Option<Event> {
        None
    }

    fn size(&self) -> (f32, f32) {
        (li::CONTAINER_WIDTH, li::CONTAINER_HEIGHT)
    }

    fn target(&self) -> (f32, f32) {
        self.size()
    }

    fn parts(&self, rect: Rect, _interaction: Interaction) -> Vec<Part> {
        let (cx, cy) = rect.center();
        let mut parts = Vec::new();
        if self.contained {
            let container = Rect::centered(cx, cy, li::CONTAINER_WIDTH, li::CONTAINER_HEIGHT);
            parts.push(Part::Surface {
                rect: container,
                radii: Radii::shape(li::CONTAINER_SHAPE, container.w, container.h),
                fill: Some(Tint::solid(li::CONTAINED_CONTAINER_COLOR)),
                outline: None,
                elevation: 0,
            });
        }
        let size = li::ACTIVE_INDICATOR_SIZE;
        let role = if self.contained {
            li::CONTAINED_ACTIVE_INDICATOR_COLOR
        } else {
            li::ACTIVE_INDICATOR_COLOR
        };
        parts.push(Part::Surface {
            rect: Rect::centered(cx, cy, size, size),
            radii: Radii::all(size / 2.0),
            fill: Some(Tint::solid(role)),
            outline: None,
            elevation: 0,
        });
        parts
    }
}
