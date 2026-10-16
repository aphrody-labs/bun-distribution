//! Portable PICA command logic extracted from libctru's GPU command builder.
//! No services, hardware access, renderer or allocation is required.
#![no_std]
#![forbid(unsafe_code)]

pub mod float;
pub mod gpu;
pub mod processor;
pub mod shader;
