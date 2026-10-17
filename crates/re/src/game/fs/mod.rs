// SPDX-License-Identifier: Apache-2.0
//! Streaming CPK extraction of `bunre dbxv2` (feature `dbxv2`). CPK, `@UTF` and CRILAYLA are
//! read by the canonical `aphrody-nie-formats` readers; mounting any install (CPK and the other
//! container families) is [`crate::game::assets`].
#[cfg(feature = "dbxv2")]
pub mod cpk_stream;
