// SPDX-License-Identifier: Apache-2.0
//! Keyboard model shared by the components: logical keys, DOM key mapping and roving focus
//! (arrow keys with wrap-around, Home/End, disabled items skipped) per the WAI-ARIA
//! Authoring Practices patterns the M3 web components follow.

use serde::{Deserialize, Serialize};

/// A logical key.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Key {
    /// Enter / Return.
    Enter,
    /// Space bar.
    Space,
    /// Escape.
    Escape,
    /// Tab.
    Tab,
    /// Shift+Tab.
    BackTab,
    /// Arrow up.
    ArrowUp,
    /// Arrow down.
    ArrowDown,
    /// Arrow left.
    ArrowLeft,
    /// Arrow right.
    ArrowRight,
    /// Home.
    Home,
    /// End.
    End,
    /// Page up.
    PageUp,
    /// Page down.
    PageDown,
    /// Backspace.
    Backspace,
    /// Delete.
    Delete,
    /// A printable character (type-ahead).
    Char(char),
}

impl Key {
    /// Map a DOM `KeyboardEvent.key` value.
    #[must_use]
    pub fn from_dom(key: &str, shift: bool) -> Option<Self> {
        Some(match key {
            "Enter" => Self::Enter,
            " " | "Spacebar" => Self::Space,
            "Escape" | "Esc" => Self::Escape,
            "Tab" if shift => Self::BackTab,
            "Tab" => Self::Tab,
            "ArrowUp" => Self::ArrowUp,
            "ArrowDown" => Self::ArrowDown,
            "ArrowLeft" => Self::ArrowLeft,
            "ArrowRight" => Self::ArrowRight,
            "Home" => Self::Home,
            "End" => Self::End,
            "PageUp" => Self::PageUp,
            "PageDown" => Self::PageDown,
            "Backspace" => Self::Backspace,
            "Delete" => Self::Delete,
            other => {
                let mut chars = other.chars();
                let first = chars.next()?;
                if chars.next().is_some() {
                    return None;
                }
                Self::Char(first)
            }
        })
    }

    /// Whether the key activates a button-like control.
    #[must_use]
    pub const fn activates(self) -> bool {
        matches!(self, Self::Enter | Self::Space)
    }
}

/// Which arrow keys move a roving focus.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Orientation {
    /// Left/Right.
    #[default]
    Horizontal,
    /// Up/Down.
    Vertical,
    /// Both pairs (radio groups).
    Both,
}

impl Orientation {
    /// ARIA `aria-orientation` value.
    #[must_use]
    pub const fn aria(self) -> Option<&'static str> {
        match self {
            Self::Horizontal => Some("horizontal"),
            Self::Vertical => Some("vertical"),
            Self::Both => None,
        }
    }
}

fn step(current: usize, enabled: &[bool], forward: bool) -> Option<usize> {
    let len = enabled.len();
    (1..=len)
        .map(|offset| {
            if forward {
                (current + offset) % len
            } else {
                (current + len - offset) % len
            }
        })
        .find(|&index| enabled[index])
}

/// The next focus target of a roving-tabindex composite, or `None` when `key` does not move
/// focus. Arrows wrap; Home/End go to the first/last enabled item; disabled items are skipped.
/// `rtl` mirrors the horizontal arrows.
#[must_use]
pub fn roving(
    current: usize,
    enabled: &[bool],
    key: Key,
    orientation: Orientation,
    rtl: bool,
) -> Option<usize> {
    if enabled.is_empty() || !enabled.iter().any(|&on| on) {
        return None;
    }
    let current = current.min(enabled.len() - 1);
    let horizontal = matches!(orientation, Orientation::Horizontal | Orientation::Both);
    let vertical = matches!(orientation, Orientation::Vertical | Orientation::Both);
    match key {
        Key::ArrowRight if horizontal => step(current, enabled, !rtl),
        Key::ArrowLeft if horizontal => step(current, enabled, rtl),
        Key::ArrowDown if vertical => step(current, enabled, true),
        Key::ArrowUp if vertical => step(current, enabled, false),
        Key::Home => enabled.iter().position(|&on| on),
        Key::End => enabled.iter().rposition(|&on| on),
        _ => None,
    }
}

/// Type-ahead: the next enabled item after `current` whose label starts with `ch`.
#[must_use]
pub fn type_ahead<'a>(
    current: usize,
    labels: impl IntoIterator<Item = (&'a str, bool)>,
    ch: char,
) -> Option<usize> {
    let items: Vec<_> = labels.into_iter().collect();
    let len = items.len();
    let wanted = ch.to_lowercase().next()?;
    (1..=len)
        .map(|offset| (current + offset) % len)
        .find(|&index| {
            let (label, enabled) = items[index];
            enabled && label.chars().next().and_then(|c| c.to_lowercase().next()) == Some(wanted)
        })
}

#[cfg(test)]
mod tests {
    use super::{Key, Orientation, roving, type_ahead};

    #[test]
    fn dom_keys_map_to_logical_keys() {
        assert_eq!(Key::from_dom(" ", false), Some(Key::Space));
        assert_eq!(Key::from_dom("Tab", true), Some(Key::BackTab));
        assert_eq!(Key::from_dom("a", false), Some(Key::Char('a')));
        assert_eq!(Key::from_dom("F5", false), None);
        assert!(Key::Enter.activates() && !Key::Escape.activates());
    }

    #[test]
    fn roving_wraps_and_skips_disabled() {
        let enabled = [true, false, true, true];
        let h = Orientation::Horizontal;
        assert_eq!(roving(0, &enabled, Key::ArrowRight, h, false), Some(2));
        assert_eq!(roving(3, &enabled, Key::ArrowRight, h, false), Some(0));
        assert_eq!(roving(0, &enabled, Key::ArrowLeft, h, false), Some(3));
        assert_eq!(roving(0, &enabled, Key::ArrowLeft, h, true), Some(2));
        assert_eq!(roving(2, &enabled, Key::ArrowDown, h, false), None);
        assert_eq!(roving(2, &enabled, Key::End, h, false), Some(3));
        assert_eq!(roving(3, &enabled, Key::Home, h, false), Some(0));
        assert_eq!(roving(0, &[false, false], Key::ArrowRight, h, false), None);
        assert_eq!(
            roving(0, &enabled, Key::ArrowDown, Orientation::Both, false),
            Some(2)
        );
    }

    #[test]
    fn type_ahead_finds_the_next_match() {
        let labels = [
            ("Copy", true),
            ("Cut", false),
            ("Paste", true),
            ("Clear", true),
        ];
        assert_eq!(type_ahead(0, labels, 'c'), Some(3));
        assert_eq!(type_ahead(3, labels, 'C'), Some(0));
        assert_eq!(type_ahead(0, labels, 'z'), None);
    }
}
