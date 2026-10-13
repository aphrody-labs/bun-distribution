// SPDX-License-Identifier: Apache-2.0
//! Host-neutral component contracts. Rendering adapters consume these values.

use serde::{Deserialize, Serialize};

/// Common button emphasis.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ButtonVariant {
    /// Filled primary action.
    #[default]
    Filled,
    /// Tonal secondary action.
    Tonal,
    /// Outlined action.
    Outlined,
    /// Text-only action.
    Text,
}

/// Accessible button model used by native, SSR and WASM renderers.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Button {
    /// Visible label.
    pub label: String,
    /// Material emphasis.
    pub variant: ButtonVariant,
    /// Whether activation is allowed.
    pub enabled: bool,
    /// Minimum pointer target in dp.
    pub min_target_dp: u32,
    /// Optional accessible name when the visible label is insufficient.
    pub accessible_name: Option<String>,
}

impl Button {
    /// Create an enabled filled action with the M3 minimum target size.
    #[must_use]
    pub fn new(label: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            variant: ButtonVariant::Filled,
            enabled: true,
            min_target_dp: crate::accessibility::MIN_TARGET_DP,
            accessible_name: None,
        }
    }

    /// Set the button's explicit accessible name.
    #[must_use]
    pub fn accessible_name(mut self, name: impl Into<String>) -> Self {
        self.accessible_name = Some(name.into());
        self
    }
}

/// Validation result for a required text field.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FieldError {
    /// Input contains no non-whitespace characters.
    Required,
}

/// Minimal form-field contract; host adapters own focus and event handling.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct TextField {
    /// Stable field identifier.
    pub id: String,
    /// Visible label.
    pub label: String,
    /// Current value.
    pub value: String,
    /// Whether a non-empty value is required.
    pub required: bool,
    /// Current enabled state.
    pub enabled: bool,
}

impl TextField {
    /// Validate required-value semantics without imposing locale-specific rules.
    pub fn validate(&self) -> Result<(), FieldError> {
        if self.required && self.value.trim().is_empty() {
            Err(FieldError::Required)
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Button, ButtonVariant, FieldError, TextField};

    #[test]
    fn button_variant_and_name_are_serializable_contracts() {
        let button = Button::new("Open").accessible_name("Open settings");
        assert_eq!(button.variant, ButtonVariant::Filled);
        assert_eq!(button.accessible_name.as_deref(), Some("Open settings"));
    }

    #[test]
    fn required_field_rejects_only_blank_values() {
        let mut field = TextField {
            id: "email".into(),
            label: "Email".into(),
            value: " \n ".into(),
            required: true,
            enabled: true,
        };
        assert_eq!(field.validate(), Err(FieldError::Required));
        field.value = "person@example.test".into();
        assert_eq!(field.validate(), Ok(()));
    }
}
