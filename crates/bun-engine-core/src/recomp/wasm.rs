//! WebAssembly host interface shared by every generated recompiled crate: the `recomp_*` exports
//! of the generated `lib.rs` forward here. Single-threaded by construction (one machine per
//! instance).

use std::cell::RefCell;

use super::Factory;
use crate::machine::{Machine, Screen};

thread_local! {
    static MACHINE: RefCell<Option<Box<dyn Machine>>> = const { RefCell::new(None) };
    static SCREEN: RefCell<Option<Screen>> = const { RefCell::new(None) };
}

/// Build the machine; returns 1 on success.
pub fn init(factory: Factory, interp: bool) -> u32 {
    match factory(interp) {
        Ok(m) => {
            MACHINE.with(|c| *c.borrow_mut() = Some(m));
            1
        }
        Err(_) => 0,
    }
}

/// Run `n` frames; returns the number of frames produced.
pub fn frames(n: u32) -> u32 {
    MACHINE.with(|c| c.borrow_mut().as_mut().map_or(0, |m| super::run_frames(m.as_mut(), n)))
}

/// Capture screen `index` as RGB; returns its byte length (0 when absent).
pub fn screen(index: u32) -> u32 {
    let s = MACHINE.with(|c| c.borrow().as_ref().and_then(|m| m.screens().into_iter().nth(index as usize)));
    let len = s.as_ref().map_or(0, |s| s.rgb.len() as u32);
    SCREEN.with(|c| *c.borrow_mut() = s);
    len
}

/// Pointer to the captured RGB bytes.
pub fn screen_ptr() -> *const u8 {
    SCREEN.with(|c| c.borrow().as_ref().map_or(std::ptr::null(), |s| s.rgb.as_ptr()))
}

/// Width of the captured screen.
pub fn screen_width() -> u32 {
    SCREEN.with(|c| c.borrow().as_ref().map_or(0, |s| s.width as u32))
}

/// Height of the captured screen.
pub fn screen_height() -> u32 {
    SCREEN.with(|c| c.borrow().as_ref().map_or(0, |s| s.height as u32))
}

/// Counter `which`: 0 native, 1 interpreted, 2 fallbacks, 3 block entries.
pub fn stat(which: u32) -> f64 {
    let s = super::stats();
    (match which {
        0 => s.native,
        1 => s.interpreted,
        2 => s.fallbacks,
        _ => s.entries,
    }) as f64
}
