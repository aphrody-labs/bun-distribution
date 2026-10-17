// SPDX-License-Identifier: Apache-2.0
//! `aphrody_remote_vnc`: computer use on any RFB (VNC) server through the shared remote target
//! model of `aphrody-remote-desktop` (tunnel member, `host[:port]` or `vnc://`). The password
//! comes from the credential store (`aphrody infra remote token`), never from the model.

#![cfg(not(target_arch = "wasm32"))]

use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use aphrody_remote_desktop as rd;
use base64::Engine as _;
use rd::backend::MouseButton;
use rd::target::TargetKind;
use rd::vnc::client::VncSession;
use rmcp::model::{CallToolResult, ContentBlock};
use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;

#[derive(Debug, Deserialize, JsonSchema)]
pub(crate) struct RemoteVncRequest {
    /// Tunnel member (`omar`), `host[:port]` or `vnc://host:port`.
    pub(crate) target: String,
    /// `screenshot`, `click`, `double_click`, `move`, `drag`, `scroll`, `type`, `keypress`,
    /// `wait` or `close`.
    pub(crate) action: String,
    /// X coordinate (click, double_click, move, drag start).
    #[serde(default)]
    pub(crate) x: Option<i32>,
    /// Y coordinate (click, double_click, move, drag start).
    #[serde(default)]
    pub(crate) y: Option<i32>,
    /// Drag end X.
    #[serde(default)]
    pub(crate) end_x: Option<i32>,
    /// Drag end Y.
    #[serde(default)]
    pub(crate) end_y: Option<i32>,
    /// `left` (default), `right` or `middle`.
    #[serde(default)]
    pub(crate) button: Option<String>,
    /// Horizontal scroll in 120-unit wheel steps (positive: right).
    #[serde(default)]
    pub(crate) delta_x: Option<i32>,
    /// Vertical scroll in 120-unit wheel steps (positive: down).
    #[serde(default)]
    pub(crate) delta_y: Option<i32>,
    /// Text to type.
    #[serde(default)]
    pub(crate) text: Option<String>,
    /// Key or shortcut (`Enter`, `ctrl+s`).
    #[serde(default)]
    pub(crate) key: Option<String>,
    /// Wait duration (default 500 ms, at most 10 s).
    #[serde(default)]
    pub(crate) duration_ms: Option<u64>,
    /// Screenshot JPEG quality (default 75).
    #[serde(default)]
    pub(crate) quality: Option<u8>,
    /// Screenshot downscale factor (default 1).
    #[serde(default)]
    pub(crate) scale: Option<u8>,
}

/// Open sessions by canonical `vnc://` URL.
static SESSIONS: LazyLock<tokio::sync::Mutex<HashMap<String, Arc<VncSession>>>> =
    LazyLock::new(Default::default);

fn error(message: String) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(message)])
}

fn point(x: Option<i32>, y: Option<i32>, what: &str) -> Result<(i32, i32), String> {
    match (x, y) {
        (Some(x), Some(y)) => Ok((x, y)),
        _ => Err(format!("{what} needs x and y")),
    }
}

pub(crate) async fn call(req: RemoteVncRequest) -> CallToolResult {
    let target = match rd::target::resolve(&req.target, TargetKind::Vnc, None) {
        Ok(t) if t.kind == TargetKind::Vnc => t,
        Ok(_) => {
            return error(format!(
                "{}: not a VNC target (use vnc://host:port)",
                req.target
            ));
        }
        Err(e) => return error(format!("{e:#}")),
    };
    let url = target.url();
    if req.action == "close" {
        if let Some(s) = SESSIONS.lock().await.remove(&url) {
            s.close().await;
        }
        return CallToolResult::success(vec![ContentBlock::text(format!("closed {url}"))]);
    }
    let session = {
        let mut sessions = SESSIONS.lock().await;
        match sessions.get(&url) {
            Some(s) => Arc::clone(s),
            None => {
                let password = target.credential().map(|s| s.expose().to_owned());
                match VncSession::connect(&target.addr(), password).await {
                    Ok(s) => Arc::clone(sessions.entry(url.clone()).or_insert(Arc::new(s))),
                    Err(e) => return error(format!("VNC {url}: {e:#}")),
                }
            }
        }
    };
    match run(&session, &req).await {
        Ok(result) => result,
        Err(message) => {
            // A failed action drops the session; the next call reconnects.
            if let Some(s) = SESSIONS.lock().await.remove(&url) {
                s.close().await;
            }
            error(format!("VNC {url}: {message}"))
        }
    }
}

async fn run(vnc: &VncSession, req: &RemoteVncRequest) -> Result<CallToolResult, String> {
    let text = |m: String| Ok(CallToolResult::success(vec![ContentBlock::text(m)]));
    let e = |e: anyhow::Error| format!("{e:#}");
    match req.action.as_str() {
        "screenshot" => {
            let shot = vnc
                .screenshot(req.quality.unwrap_or(75), req.scale.unwrap_or(1).max(1))
                .await
                .map_err(e)?;
            let data = base64::engine::general_purpose::STANDARD.encode(&shot.jpeg);
            Ok(CallToolResult::success(vec![
                ContentBlock::text(format!("{}x{} JPEG", shot.width, shot.height)),
                ContentBlock::image(data, "image/jpeg"),
            ]))
        }
        "click" | "double_click" => {
            let (x, y) = point(req.x, req.y, &req.action)?;
            let button = MouseButton::parse(req.button.as_deref().unwrap_or("left"));
            let count = if req.action == "click" { 1 } else { 2 };
            vnc.click(x, y, button, count).await.map_err(e)?;
            text(format!("{} {} at ({x}, {y})", req.action, button.as_str()))
        }
        "move" => {
            let (x, y) = point(req.x, req.y, "move")?;
            vnc.move_to(x, y).await.map_err(e)?;
            text(format!("moved to ({x}, {y})"))
        }
        "drag" => {
            let from = point(req.x, req.y, "drag")?;
            let to = point(req.end_x, req.end_y, "drag end")?;
            vnc.drag(from, to).await.map_err(e)?;
            text(format!("dragged {from:?} -> {to:?}"))
        }
        "scroll" => {
            let (dx, dy) = (req.delta_x.unwrap_or(0), req.delta_y.unwrap_or(0));
            vnc.scroll(dx, dy).await.map_err(e)?;
            text(format!("scrolled ({dx}, {dy})"))
        }
        "type" => {
            let s = req.text.as_deref().ok_or("type needs text")?;
            vnc.type_text(s).await.map_err(e)?;
            text(format!("typed {} character(s)", s.chars().count()))
        }
        "keypress" => {
            let k = req.key.as_deref().ok_or("keypress needs key")?;
            vnc.keypress(k).await.map_err(e)?;
            text(format!("pressed {k}"))
        }
        "wait" => {
            let ms = req.duration_ms.unwrap_or(500).min(10_000);
            tokio::time::sleep(Duration::from_millis(ms)).await;
            text(format!("waited {ms} ms"))
        }
        other => Err(format!(
            "unknown action {other} (screenshot, click, double_click, move, drag, scroll, type, \
             keypress, wait, close)"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(target: &str, action: &str) -> RemoteVncRequest {
        serde_json::from_value(serde_json::json!({ "target": target, "action": action })).unwrap()
    }

    fn first_text(r: &CallToolResult) -> String {
        r.content
            .first()
            .and_then(|c| c.as_text())
            .map(|t| t.text.clone())
            .unwrap_or_default()
    }

    #[tokio::test]
    async fn rejects_non_vnc_targets_and_reports_unreachable_servers() {
        let r = call(req("http://127.0.0.1:8793", "screenshot")).await;
        assert_eq!(r.is_error, Some(true));
        assert!(
            first_text(&r).contains("not a VNC target"),
            "{}",
            first_text(&r)
        );

        let r = call(req("vnc://127.0.0.1:9", "screenshot")).await;
        assert_eq!(r.is_error, Some(true));
        assert!(
            first_text(&r).contains("vnc://127.0.0.1:9"),
            "{}",
            first_text(&r)
        );

        let r = call(req("vnc://127.0.0.1:9", "close")).await;
        assert_eq!(r.is_error, Some(false));
        assert!(point(Some(1), None, "click").is_err());
    }
}
