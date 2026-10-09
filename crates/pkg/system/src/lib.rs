// SPDX-License-Identifier: Apache-2.0
//! System package sources (winget, apk, deb, pacman) without I/O: specifiers,
//! loose versions and ranges, the lock model, a read-only SQLite page reader
//! and the winget index/manifest/installer logic. Hosts fetch bytes, parse
//! JSON/YAML into [`value::Value`], run installers and own the filesystem.
//!
//! Origin: Bun fork `src/install/system` (aphrody-labs/bun), moved here so every
//! Aphrody package manager front end shares one implementation.

#![forbid(unsafe_code)]

pub mod kind;
pub mod lock;
pub mod sqlite;
pub mod value;
pub mod version;
pub mod winget;

use std::fmt;

pub use kind::{
    PACKAGE_JSON_FIELD, SourceKind, Spec, is_system_spec, lock_key, parse_entry, parse_spec,
};
pub use lock::{LockEntry, SystemLock};
pub use value::Value;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    Parse(String),
    NotFound(String),
    NoMatchingVersion { id: String, range: String },
    Unsupported(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Parse(s) | Error::Unsupported(s) => f.write_str(s),
            Error::NotFound(s) => write!(f, "{s} was not found"),
            Error::NoMatchingVersion { id, range } => {
                write!(f, "no version of {id} matches \"{range}\"")
            },
        }
    }
}

impl std::error::Error for Error {}

pub type Result<T> = core::result::Result<T, Error>;
