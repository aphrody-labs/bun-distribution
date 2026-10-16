// SPDX-License-Identifier: Apache-2.0

/// Where a [`ConfigLayer`]'s TOML value came from. Ordered lowest to highest
/// precedence when layers are assembled by [`crate::resolve::resolve`]:
/// `Builtin < CodexCompat < User < Project < Profile < CliOverride < Flag`
/// (see `docs/plans/codex-oss.md`, "Cross-cutting rules").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LayerSource {
    /// The synthesized built-in provider catalog
    /// ([`crate::provider::builtin_providers_layer_value`]).
    Builtin,
    /// The opt-in, restricted view of `~/.codex/config.toml`
    /// (see [`restrict_codex_layer`]). Never applied unless
    /// `[compat] read_codex_home = true`.
    CodexCompat,
    /// `~/.aphrody/config.toml`.
    User,
    /// A trusted project-local `config.toml` (e.g. `.aphrody/config.toml`
    /// inside the repository).
    Project,
    /// The selected `[profiles.<name>]` table, extracted and merged back
    /// onto the root after `Builtin..Project` have already been merged.
    Profile,
    /// Parsed `-c key=value` command-line overrides.
    CliOverride,
    /// Dedicated CLI flags translated into config paths (`-m`, `--oss`,
    /// `-a`, `-s`, `--full-auto`, ...).
    Flag,
}

/// One layer of configuration: a source tag plus the TOML value it
/// contributed. [`crate::resolve::resolve`] assembles a `Vec<ConfigLayer>` in
/// ascending precedence order and folds it with [`merge_layers`].
#[derive(Debug, Clone, PartialEq)]
pub struct ConfigLayer {
    pub source: LayerSource,
    pub value: toml::Value,
}

impl ConfigLayer {
    #[must_use]
    pub fn new(source: LayerSource, value: toml::Value) -> Self {
        Self { source, value }
    }
}

fn empty_table() -> toml::Value {
    toml::Value::Table(toml::value::Table::new())
}

/// Deep-merges `overlay` into `base`, `overlay` winning.
///
/// Tables are merged key-by-key, recursively. Every other value kind
/// (scalars, arrays, and a table meeting a non-table) is replaced wholesale
/// by the overlay's value — in particular **arrays are never concatenated**,
/// matching `openai/codex` `codex-rs/config/src/merge.rs` `merge_toml_values`
/// (aphrody does not port that function's shell-environment-policy /
/// structured-feature special cases: aphrody has no `[features.*]` boolean
/// shorthand and no legacy shell-policy representation to reconcile).
pub fn merge_toml_values(base: &mut toml::Value, overlay: &toml::Value) {
    match (base, overlay) {
        (toml::Value::Table(base_table), toml::Value::Table(overlay_table)) => {
            for (key, overlay_value) in overlay_table {
                match base_table.get_mut(key) {
                    Some(base_value) => merge_toml_values(base_value, overlay_value),
                    None => {
                        base_table.insert(key.clone(), overlay_value.clone());
                    }
                }
            }
        }
        (base_slot, overlay_value) => {
            *base_slot = overlay_value.clone();
        }
    }
}

/// Folds a list of layers, in the order given, into a single TOML value.
/// Later layers win. The caller is responsible for ordering `layers` by
/// ascending [`LayerSource`] precedence; this function performs no reordering
/// of its own so that callers can insert a re-derived [`LayerSource::Profile`]
/// layer in the middle of a pipeline (see [`crate::resolve::resolve`]).
#[must_use]
pub fn merge_layers(layers: &[ConfigLayer]) -> toml::Value {
    let mut merged = empty_table();
    for layer in layers {
        merge_toml_values(&mut merged, &layer.value);
    }
    merged
}

/// Restricts a parsed `~/.codex/config.toml` value to the two tables aphrody
/// is willing to read from an existing Codex install: `mcp_servers` and
/// `model_providers`. Everything else — in particular `model` and
/// `model_provider`, which would silently flip an OSS user onto a cloud
/// model — is dropped. Only takes effect when the caller has already gated
/// on `[compat] read_codex_home = true` (`docs/plans/codex-oss.md`,
/// "Cross-cutting rules": "`~/.codex/config.toml` is never layered
/// implicitly").
#[must_use]
pub fn restrict_codex_layer(value: toml::Value) -> toml::Value {
    let mut restricted = toml::value::Table::new();
    if let toml::Value::Table(table) = value {
        if let Some(mcp_servers) = table.get("mcp_servers") {
            restricted.insert("mcp_servers".to_string(), mcp_servers.clone());
        }
        if let Some(model_providers) = table.get("model_providers") {
            restricted.insert("model_providers".to_string(), model_providers.clone());
        }
    }
    toml::Value::Table(restricted)
}

#[cfg(test)]
#[path = "layer_tests.rs"]
mod layer_tests;
