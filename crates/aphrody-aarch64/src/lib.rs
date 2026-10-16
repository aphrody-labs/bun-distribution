#![no_std]
#![forbid(unsafe_code)]

//! Portable AArch64 decoding and bounded execution. No JIT or host ABI dependency.
pub mod decoder;
pub mod interpreter;
pub use decoder::{A64InstructionName, DecodedInst, decode};
