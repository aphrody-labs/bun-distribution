//! Portable pieces of Wii execution extracted from the retained Gecko core.
//!
//! This is not a complete Broadway interpreter or Wii device model.
#![no_std]
#![forbid(unsafe_code)]

pub mod branch;
pub mod dol;
