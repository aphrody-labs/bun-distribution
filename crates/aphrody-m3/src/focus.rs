// SPDX-License-Identifier: Apache-2.0
//! Sequential (Tab / Shift+Tab) focus order with disabled items skipped, and the focus trap
//! modal surfaces such as [`crate::controls::Dialog`] use.

use crate::keyboard::Key;

/// Result of a Tab move.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FocusMove {
    /// Focus moved to this index.
    Moved(usize),
    /// Focus leaves the scope forwards (Tab past the last item).
    ExitForward,
    /// Focus leaves the scope backwards (Shift+Tab before the first item).
    ExitBackward,
}

/// An ordered set of focusable items.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct FocusScope {
    enabled: Vec<bool>,
    current: Option<usize>,
    trap: bool,
}

impl FocusScope {
    /// A scope over items with the given enabled flags. `trap` keeps Tab inside (modal).
    #[must_use]
    pub const fn new(enabled: Vec<bool>, trap: bool) -> Self {
        Self {
            enabled,
            current: None,
            trap,
        }
    }

    /// Currently focused index.
    #[must_use]
    pub const fn current(&self) -> Option<usize> {
        self.current
    }

    /// Focus the first enabled item.
    pub fn focus_first(&mut self) -> Option<usize> {
        self.current = self.enabled.iter().position(|&on| on);
        self.current
    }

    /// Focus `index` if it is enabled.
    pub fn focus(&mut self, index: usize) -> bool {
        let ok = self.enabled.get(index).copied().unwrap_or(false);
        if ok {
            self.current = Some(index);
        }
        ok
    }

    /// Enable or disable an item; a disabled focused item hands focus to the next one.
    pub fn set_enabled(&mut self, index: usize, enabled: bool) {
        if let Some(slot) = self.enabled.get_mut(index) {
            *slot = enabled;
        }
        if !enabled && self.current == Some(index) {
            self.current = None;
            if let FocusMove::Moved(next) = self.advance(index, true) {
                self.current = Some(next);
            }
        }
    }

    fn advance(&self, from: usize, forward: bool) -> FocusMove {
        let len = self.enabled.len();
        let mut index = from;
        for _ in 0..len {
            let wrapped;
            (index, wrapped) = if forward {
                if index + 1 == len {
                    (0, true)
                } else {
                    (index + 1, false)
                }
            } else if index == 0 {
                (len - 1, true)
            } else {
                (index - 1, false)
            };
            if wrapped && !self.trap {
                return if forward {
                    FocusMove::ExitForward
                } else {
                    FocusMove::ExitBackward
                };
            }
            if self.enabled[index] {
                return FocusMove::Moved(index);
            }
        }
        if forward {
            FocusMove::ExitForward
        } else {
            FocusMove::ExitBackward
        }
    }

    /// Handle Tab / Shift+Tab; other keys return `None`.
    pub fn handle_key(&mut self, key: Key) -> Option<FocusMove> {
        let forward = match key {
            Key::Tab => true,
            Key::BackTab => false,
            _ => return None,
        };
        if self.enabled.is_empty() {
            return Some(if forward {
                FocusMove::ExitForward
            } else {
                FocusMove::ExitBackward
            });
        }
        let start = self
            .current
            .unwrap_or(if forward { self.enabled.len() - 1 } else { 0 });
        let outcome = match self.current {
            None if self.enabled[start] && self.trap => FocusMove::Moved(start),
            _ => self.advance(start, forward),
        };
        if let FocusMove::Moved(index) = outcome {
            self.current = Some(index);
        }
        Some(outcome)
    }
}

#[cfg(test)]
mod tests {
    use super::{FocusMove, FocusScope};
    use crate::keyboard::Key;

    #[test]
    fn tab_order_skips_disabled_and_exits_open_scopes() {
        let mut scope = FocusScope::new(vec![true, false, true], false);
        assert_eq!(scope.focus_first(), Some(0));
        assert_eq!(scope.handle_key(Key::Tab), Some(FocusMove::Moved(2)));
        assert_eq!(scope.handle_key(Key::Tab), Some(FocusMove::ExitForward));
        assert_eq!(scope.handle_key(Key::BackTab), Some(FocusMove::Moved(0)));
        assert_eq!(
            scope.handle_key(Key::BackTab),
            Some(FocusMove::ExitBackward)
        );
        assert_eq!(scope.handle_key(Key::Enter), None);
    }

    #[test]
    fn trapped_scope_wraps() {
        let mut scope = FocusScope::new(vec![true, true, false], true);
        scope.focus(1);
        assert_eq!(scope.handle_key(Key::Tab), Some(FocusMove::Moved(0)));
        assert_eq!(scope.handle_key(Key::BackTab), Some(FocusMove::Moved(1)));
        scope.set_enabled(1, false);
        assert_eq!(scope.current(), Some(0));
    }
}
