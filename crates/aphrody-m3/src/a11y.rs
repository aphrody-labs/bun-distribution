// SPDX-License-Identifier: Apache-2.0
//! Accessibility tree exposed by every component: WAI-ARIA roles and states, serialisable for
//! native accessibility bridges and mapped to `aria-*` attributes for web hosts.

use serde::{Deserialize, Serialize};

use crate::keyboard::Orientation;

/// Accessible role.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccessRole {
    /// `button`.
    Button,
    /// `checkbox`.
    Checkbox,
    /// `switch`.
    Switch,
    /// `radio`.
    Radio,
    /// `radiogroup`.
    RadioGroup,
    /// `tab`.
    Tab,
    /// `tablist`.
    TabList,
    /// `slider`.
    Slider,
    /// `dialog`.
    Dialog,
    /// `alertdialog`.
    AlertDialog,
    /// `menu`.
    Menu,
    /// `menuitem`.
    MenuItem,
    /// `navigation` landmark.
    Navigation,
    /// `link`.
    Link,
    /// `group`.
    Group,
    /// `toolbar`.
    Toolbar,
    /// `progressbar`.
    ProgressBar,
}

impl AccessRole {
    /// ARIA role token.
    #[must_use]
    pub const fn aria(self) -> &'static str {
        match self {
            Self::Button => "button",
            Self::Checkbox => "checkbox",
            Self::Switch => "switch",
            Self::Radio => "radio",
            Self::RadioGroup => "radiogroup",
            Self::Tab => "tab",
            Self::TabList => "tablist",
            Self::Slider => "slider",
            Self::Dialog => "dialog",
            Self::AlertDialog => "alertdialog",
            Self::Menu => "menu",
            Self::MenuItem => "menuitem",
            Self::Navigation => "navigation",
            Self::Link => "link",
            Self::Group => "group",
            Self::Toolbar => "toolbar",
            Self::ProgressBar => "progressbar",
        }
    }

    /// Whether ARIA requires an accessible name for this role.
    #[must_use]
    pub const fn requires_name(self) -> bool {
        !matches!(
            self,
            Self::Group | Self::Toolbar | Self::Navigation | Self::Menu | Self::TabList
        )
    }
}

/// Tri-state `aria-checked`.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Checked {
    /// `false`.
    False,
    /// `true`.
    True,
    /// `mixed`.
    Mixed,
}

impl Checked {
    const fn aria(self) -> &'static str {
        match self {
            Self::False => "false",
            Self::True => "true",
            Self::Mixed => "mixed",
        }
    }
}

/// Range value of a slider or determinate progress indicator.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct RangeValue {
    /// Current value.
    pub now: f32,
    /// Minimum.
    pub min: f32,
    /// Maximum.
    pub max: f32,
}

/// One node of the accessibility tree.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Accessible {
    /// Role.
    pub role: AccessRole,
    /// Accessible name.
    pub name: String,
    /// Accessible description.
    pub description: Option<String>,
    /// `aria-disabled`.
    pub disabled: bool,
    /// Whether the node is in the tab sequence (`tabindex=0`) or reachable by roving focus only.
    pub focusable: bool,
    /// `aria-checked`.
    pub checked: Option<Checked>,
    /// `aria-pressed` (toggle buttons).
    pub pressed: Option<bool>,
    /// `aria-selected`.
    pub selected: Option<bool>,
    /// `aria-expanded`.
    pub expanded: Option<bool>,
    /// `aria-haspopup`.
    pub has_popup: Option<String>,
    /// `aria-current="page"`.
    pub current: bool,
    /// `aria-modal`.
    pub modal: bool,
    /// `aria-busy`.
    pub busy: bool,
    /// `aria-valuenow/min/max`.
    pub value: Option<RangeValue>,
    /// `aria-orientation`.
    pub orientation: Option<Orientation>,
    /// Children in reading order.
    pub children: Vec<Accessible>,
}

/// A violation found by [`Accessible::validate`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum A11yError {
    /// A role that needs a name has none.
    MissingName(&'static str),
    /// A checkable role has no `checked` state.
    MissingChecked(&'static str),
    /// A range value lies outside `[min, max]`.
    ValueOutOfRange(&'static str),
    /// A selectable child (`tab`) has no `selected` state.
    MissingSelected(&'static str),
}

impl Accessible {
    /// A focusable node with no state.
    #[must_use]
    pub fn new(role: AccessRole, name: impl Into<String>) -> Self {
        Self {
            role,
            name: name.into(),
            description: None,
            disabled: false,
            focusable: true,
            checked: None,
            pressed: None,
            selected: None,
            expanded: None,
            has_popup: None,
            current: false,
            modal: false,
            busy: false,
            value: None,
            orientation: None,
            children: Vec::new(),
        }
    }

    /// `aria-*` attributes (plus `role` and `tabindex`) for a web host.
    #[must_use]
    pub fn aria_attributes(&self) -> Vec<(&'static str, String)> {
        let mut attrs = vec![("role", self.role.aria().to_owned())];
        if !self.name.is_empty() {
            attrs.push(("aria-label", self.name.clone()));
        }
        if let Some(description) = &self.description {
            attrs.push(("aria-description", description.clone()));
        }
        if self.disabled {
            attrs.push(("aria-disabled", "true".into()));
        }
        if let Some(checked) = self.checked {
            attrs.push(("aria-checked", checked.aria().into()));
        }
        if let Some(pressed) = self.pressed {
            attrs.push(("aria-pressed", pressed.to_string()));
        }
        if let Some(selected) = self.selected {
            attrs.push(("aria-selected", selected.to_string()));
        }
        if let Some(expanded) = self.expanded {
            attrs.push(("aria-expanded", expanded.to_string()));
        }
        if let Some(popup) = &self.has_popup {
            attrs.push(("aria-haspopup", popup.clone()));
        }
        if self.current {
            attrs.push(("aria-current", "page".into()));
        }
        if self.modal {
            attrs.push(("aria-modal", "true".into()));
        }
        if self.busy {
            attrs.push(("aria-busy", "true".into()));
        }
        if let Some(value) = self.value {
            attrs.push(("aria-valuenow", value.now.to_string()));
            attrs.push(("aria-valuemin", value.min.to_string()));
            attrs.push(("aria-valuemax", value.max.to_string()));
        }
        if let Some(orientation) = self.orientation.and_then(Orientation::aria) {
            attrs.push(("aria-orientation", orientation.into()));
        }
        attrs.push((
            "tabindex",
            if self.focusable && !self.disabled {
                "0"
            } else {
                "-1"
            }
            .into(),
        ));
        attrs
    }

    /// Check the ARIA invariants of this node and its children.
    pub fn validate(&self) -> Result<(), A11yError> {
        let role = self.role.aria();
        if self.role.requires_name() && self.name.trim().is_empty() {
            return Err(A11yError::MissingName(role));
        }
        if matches!(
            self.role,
            AccessRole::Checkbox | AccessRole::Switch | AccessRole::Radio
        ) && self.checked.is_none()
        {
            return Err(A11yError::MissingChecked(role));
        }
        if self.role == AccessRole::Tab && self.selected.is_none() {
            return Err(A11yError::MissingSelected(role));
        }
        if let Some(value) = self.value {
            if !(value.min <= value.now && value.now <= value.max) {
                return Err(A11yError::ValueOutOfRange(role));
            }
        }
        self.children.iter().try_for_each(Self::validate)
    }
}

#[cfg(test)]
mod tests {
    use super::{A11yError, AccessRole, Accessible, Checked, RangeValue};

    #[test]
    fn aria_attributes_cover_states() {
        let mut node = Accessible::new(AccessRole::Checkbox, "Accept");
        node.checked = Some(Checked::Mixed);
        node.disabled = true;
        let attrs = node.aria_attributes();
        assert!(attrs.contains(&("role", "checkbox".into())));
        assert!(attrs.contains(&("aria-checked", "mixed".into())));
        assert!(attrs.contains(&("tabindex", "-1".into())));
    }

    #[test]
    fn validation_rejects_missing_names_and_states() {
        assert_eq!(
            Accessible::new(AccessRole::Button, " ").validate(),
            Err(A11yError::MissingName("button"))
        );
        assert_eq!(
            Accessible::new(AccessRole::Switch, "Wi-Fi").validate(),
            Err(A11yError::MissingChecked("switch"))
        );
        let mut slider = Accessible::new(AccessRole::Slider, "Volume");
        slider.value = Some(RangeValue {
            now: 11.0,
            min: 0.0,
            max: 10.0,
        });
        assert_eq!(slider.validate(), Err(A11yError::ValueOutOfRange("slider")));
        assert_eq!(Accessible::new(AccessRole::Group, "").validate(), Ok(()));
    }
}
