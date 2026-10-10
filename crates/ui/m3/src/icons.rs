// SPDX-License-Identifier: Apache-2.0
//! Platform-neutral Material Symbols contract and font variation settings.

pub use crate::facade::icons::{IconSpec, Variation};
pub use crate::facade::platform::IconStyle;

/// Return the standard outlined icon spec for an accessible standalone control.
#[must_use]
pub const fn outlined(name: &'static str) -> IconSpec {
    IconSpec::outlined(name)
}

#[cfg(test)]
mod tests {
    use super::{IconStyle, outlined};

    #[test]
    fn standalone_icons_require_an_accessible_label() {
        let icon = outlined("settings");
        assert_eq!(icon.style, IconStyle::Outlined);
        assert!(icon.requires_label);
    }
}
