// SPDX-License-Identifier: Apache-2.0
//! Aphrody Translate — bibliothèque de réécriture des commentaires source.
//!
//! Quatre étages :
//!   1. extraction  → trouve les commentaires par langage (regex purs Rust)
//!   2. ai_patterns → détecte/nettoie les marqueurs IA et émoji
//!   3. translate   → appelle MyMemory (gratuit) avec cache JSON persistant
//!   4. aphrodify   → applique le style Aphrody (sobre, impersonnel, focus code)

#[cfg(not(target_arch = "wasm32"))]
mod cli;
pub mod translate;

#[cfg(not(target_arch = "wasm32"))]
pub use cli::cli_main;
// The pure stages (extraction, AI-marker scrubbing, Aphrody style, language detection) live in
// `aphrody-translate-core`; they are re-exported here so existing paths keep working.
pub use aphrody_translate_core::{
    Comment, CommentStyle, Lang, ai_patterns, aphrodify, extract, is_japanese,
};
pub use translate::{Backend, Translator};
