// SPDX-License-Identifier: Apache-2.0
//! Steam URI launch and Proton launch tuning.

/// `steam://rungameid/<app_id>`: starts an installed game through the running Steam client.
#[must_use]
pub fn rungameid_uri(app_id: u32) -> String {
    format!("steam://rungameid/{app_id}")
}

/// Accepts only `steam://` URIs without control characters or quotes, so the URI can be handed to
/// the shell (`ShellExecuteW`, `xdg-open`) without injection.
#[must_use]
pub fn is_safe_steam_uri(uri: &str) -> bool {
    uri.starts_with("steam://") && !uri.chars().any(|c| c.is_control() || c == '"')
}
