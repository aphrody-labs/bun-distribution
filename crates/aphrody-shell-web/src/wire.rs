// SPDX-License-Identifier: Apache-2.0
//! Client side of the `aphrody-terminal-backend` WebSocket wire protocol.
//!
//! Binary frames carry raw bytes both ways; control messages are JSON text frames. The same
//! frames travel over a browser `WebSocket` and over the Tauri IPC bridge.

use serde_json::json;

/// JSON text frame asking the PTY to resize.
#[must_use]
pub fn resize_frame(cols: u16, rows: u16) -> String {
    json!({ "type": "resize", "cols": cols.max(1), "rows": rows.max(1) }).to_string()
}

/// JSON text frame carrying input bytes (for transports without binary frames).
#[must_use]
pub fn data_frame(bytes: &[u8]) -> String {
    json!({ "type": "data", "bytes": bytes }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_match_backend_protocol() {
        assert_eq!(
            resize_frame(80, 24),
            r#"{"cols":80,"rows":24,"type":"resize"}"#
        );
        assert_eq!(resize_frame(0, 0), r#"{"cols":1,"rows":1,"type":"resize"}"#);
        assert_eq!(data_frame(b"ls"), r#"{"bytes":[108,115],"type":"data"}"#);
    }
}
