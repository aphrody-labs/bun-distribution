// SPDX-License-Identifier: Apache-2.0
//! Steam Remote Play host/client state: paired and seen devices from `config/remoteclients.vdf`
//! and the streaming logs under `<steam>/logs`.
//!
//! Pairing material is never surfaced: any field whose name looks like a key, token, secret,
//! ticket, password, certificate or PSK is dropped before it leaves this module.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::vdf::VdfValue;

/// Field-name fragments treated as secret material.
const SECRET_MARKERS: &[&str] = &[
    "key", "token", "secret", "ticket", "password", "passwd", "cert", "psk", "auth",
];

/// Whether a field name looks like secret material.
#[must_use]
pub fn is_secret_field(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    SECRET_MARKERS.iter().any(|marker| lower.contains(marker))
}

/// One Remote Play device known to this client.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteClient {
    /// Client id (the table key).
    pub id: String,
    /// Host name, when recorded.
    pub hostname: Option<String>,
    /// Last-seen Unix time, when recorded.
    pub last_seen: Option<u64>,
    /// Remaining non-secret scalar fields.
    pub fields: BTreeMap<String, String>,
}

fn collect_clients(node: &VdfValue, out: &mut Vec<RemoteClient>, depth: usize) {
    let Some(entries) = node.entries() else {
        return;
    };
    for (id, child) in entries {
        let Some(child_entries) = child.entries() else {
            continue;
        };
        let scalars: BTreeMap<String, String> = child_entries
            .iter()
            .filter_map(|(k, v)| match v {
                VdfValue::Str(s) if !is_secret_field(k) => Some((k.clone(), s.clone())),
                _ => None,
            })
            .collect();
        let has_tables = child_entries
            .iter()
            .any(|(_, v)| matches!(v, VdfValue::Table(_)));
        if scalars.is_empty() && has_tables && depth < 3 {
            collect_clients(child, out, depth + 1);
            continue;
        }
        if is_secret_field(id) {
            continue;
        }
        let pick = |names: &[&str]| {
            names.iter().find_map(|n| {
                scalars
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case(n))
                    .map(|(_, v)| v.clone())
            })
        };
        out.push(RemoteClient {
            id: id.clone(),
            hostname: pick(&["hostname", "machine_name", "name"]),
            last_seen: pick(&["timestamp", "lastseen", "last_seen", "lastconnected"])
                .and_then(|v| v.parse().ok()),
            fields: scalars,
        });
    }
}

/// Lists the Remote Play devices of a `remoteclients.vdf` document, without secret fields.
#[must_use]
pub fn remote_clients(doc: &VdfValue) -> Vec<RemoteClient> {
    let mut out = Vec::new();
    collect_clients(doc, &mut out, 0);
    out
}

/// `<steam>/config/remoteclients.vdf`.
#[must_use]
pub fn remote_clients_path(steam_root: &Path) -> PathBuf {
    steam_root.join("config").join("remoteclients.vdf")
}

/// Streaming logs of the client (`logs/streaming_log*.txt`, `logs/remote_connections.txt`),
/// newest first.
#[must_use]
pub fn streaming_logs(steam_root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(steam_root.join("logs")) else {
        return Vec::new();
    };
    let mut logs: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_ascii_lowercase();
            name.starts_with("streaming") || name.starts_with("remote_connections")
        })
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    logs.sort_by(|a, b| b.0.cmp(&a.0));
    logs.into_iter().map(|(_, path)| path).collect()
}

/// Last `count` lines of a log file, lossily decoded.
pub fn tail_lines(path: &Path, count: usize) -> std::io::Result<Vec<String>> {
    let bytes = std::fs::read(path)?;
    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = text.lines().collect();
    Ok(lines[lines.len().saturating_sub(count)..]
        .iter()
        .map(|l| (*l).to_owned())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vdf::parse_vdf;

    #[test]
    fn drops_secret_fields() {
        let doc = parse_vdf(
            r#""RemoteClientCache" { "123" { "hostname" "vps" "timestamp" "1700000000" "PairingKey" "abc" "authticket" "x" } }"#,
        )
        .unwrap();
        let clients = remote_clients(&doc);
        assert_eq!(clients.len(), 1);
        assert_eq!(clients[0].hostname.as_deref(), Some("vps"));
        assert_eq!(clients[0].last_seen, Some(1_700_000_000));
        assert!(!clients[0].fields.contains_key("PairingKey"));
        assert!(!clients[0].fields.contains_key("authticket"));
    }
}
