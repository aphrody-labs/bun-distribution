// SPDX-License-Identifier: Apache-2.0
//! The shared in-process browser session: one V8-backed [`WebSession`] on its own worker thread,
//! reached through typed helpers.
//!
//! A `WebSession` holds a V8 isolate and is `!Send`, so it lives on a dedicated thread with a
//! current-thread runtime; callers send a tool name and JSON arguments with a deadline and wait
//! for the reply. Every tool call shares one set of open tabs, except [`evaluate`], which runs in
//! a fresh state without access to them. The helpers replace the argument-vector protocol of the
//! retired external browser client: nothing here spawns a process.

use std::{
    sync::OnceLock,
    time::{Duration, Instant},
};

use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};

use crate::{
    WebSession,
    error::{Result, WebError},
};

struct Request {
    tool: String,
    arguments: Value,
    deadline: Instant,
    isolated: bool,
    reply: oneshot::Sender<core::result::Result<Value, String>>,
}

/// The worker's inbox, or why it could not start (kept: a failed start is reported on every call).
type Inbox = core::result::Result<mpsc::UnboundedSender<Request>, String>;

fn sender() -> Result<&'static mpsc::UnboundedSender<Request>> {
    static SENDER: OnceLock<Inbox> = OnceLock::new();
    match SENDER.get_or_init(|| {
        let (sender, mut receiver) = mpsc::unbounded_channel::<Request>();
        std::thread::Builder::new()
            .name("aphrody-web-native-session".to_owned())
            .stack_size(64 * 1024 * 1024)
            .spawn(move || {
                let Ok(runtime) =
                    tokio::runtime::Builder::new_current_thread().enable_all().build()
                else {
                    return;
                };
                runtime.block_on(async move {
                    let mut session = WebSession::new(None, None, false);
                    while let Some(request) = receiver.recv().await {
                        let remaining = request.deadline.saturating_duration_since(Instant::now());
                        let result = if remaining.is_zero() {
                            Err("native browser request expired before execution".to_owned())
                        } else if request.isolated {
                            let mut isolated = WebSession::new(None, None, false);
                            tokio::time::timeout(
                                remaining,
                                isolated.call(&request.tool, request.arguments),
                            )
                            .await
                            .unwrap_or_else(|_| {
                                Err("native browser tool exceeded its deadline".to_owned())
                            })
                        } else {
                            tokio::time::timeout(
                                remaining,
                                session.call(&request.tool, request.arguments),
                            )
                            .await
                            .unwrap_or_else(|_| {
                                Err("native browser tool exceeded its deadline".to_owned())
                            })
                        };
                        let _ = request.reply.send(result);
                    }
                });
            })
            .map_err(|error| error.to_string())?;
        Ok(sender)
    }) {
        Ok(sender) => Ok(sender),
        Err(detail) => {
            Err(WebError::Browser { url: "native session".to_owned(), detail: detail.clone() })
        },
    }
}

/// Call a tool on the shared browser state with a caller deadline.
///
/// # Errors
/// Reports browser startup, tool, transport or deadline failures.
pub async fn call(tool: &str, arguments: Value, budget: Duration) -> Result<Value> {
    call_inner(tool, arguments, budget, false).await
}

/// Run a tool in a fresh browser state without access to open tabs.
///
/// # Errors
/// Reports browser startup, tool, transport or deadline failures.
pub async fn call_isolated(tool: &str, arguments: Value, budget: Duration) -> Result<Value> {
    call_inner(tool, arguments, budget, true).await
}

async fn call_inner(
    tool: &str,
    arguments: Value,
    budget: Duration,
    isolated: bool,
) -> Result<Value> {
    let (reply, receiver) = oneshot::channel();
    sender()?
        .send(Request {
            tool: tool.to_owned(),
            arguments,
            deadline: Instant::now() + budget,
            isolated,
            reply,
        })
        .map_err(|_| WebError::Browser {
            url: tool.to_owned(),
            detail: "native browser worker stopped".to_owned(),
        })?;
    let result = tokio::time::timeout(budget, receiver)
        .await
        .map_err(|_| WebError::BrowserTimeout { url: tool.to_owned(), secs: budget.as_secs() })?
        .map_err(|_| WebError::Browser {
            url: tool.to_owned(),
            detail: "native browser worker ended without a reply".to_owned(),
        })?
        .map_err(|detail| WebError::Browser { url: tool.to_owned(), detail })?;
    if result.get("isError").and_then(Value::as_bool).unwrap_or(false) {
        return Err(WebError::Browser { url: tool.to_owned(), detail: text_content(&result) });
    }
    Ok(result)
}

/// Extract plain text from a browser tool response.
#[must_use]
pub fn text_content(value: &Value) -> String {
    value
        .get("content")
        .and_then(Value::as_array)
        .map(|content| {
            content
                .iter()
                .filter_map(|item| item.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

/// Extract the base64 PNG from a screenshot response.
#[must_use]
pub fn image_data(value: &Value) -> Option<&str> {
    value
        .get("content")
        .and_then(Value::as_array)?
        .iter()
        .find(|item| item.get("type").and_then(Value::as_str) == Some("image"))?
        .get("data")
        .and_then(Value::as_str)
}

async fn text(tool: &str, arguments: Value, budget: Duration) -> Result<String> {
    call(tool, arguments, budget).await.map(|result| text_content(&result))
}

/// Navigate the shared page to `url` (http or https only).
///
/// # Errors
/// Reports a refused URL, a navigation failure or the deadline.
pub async fn navigate(url: &str, budget: Duration) -> Result<String> {
    text("browser_navigate", json!({ "url": url }), budget).await
}

/// The accessibility snapshot of the shared page.
///
/// # Errors
/// Reports a tool failure or the deadline.
pub async fn snapshot(budget: Duration) -> Result<String> {
    text("browser_snapshot", json!({}), budget).await
}

/// Click the element matched by a CSS selector.
///
/// # Errors
/// Reports a missing element, a tool failure or the deadline.
pub async fn click(selector: &str, budget: Duration) -> Result<String> {
    text("browser_click", json!({ "selector": selector }), budget).await
}

/// Press a keyboard key (`Enter`, `Escape`, `Tab`, ...).
///
/// # Errors
/// Reports a tool failure or the deadline.
pub async fn press_key(key: &str, budget: Duration) -> Result<String> {
    text("browser_press_key", json!({ "key": key }), budget).await
}

/// Scroll the shared page along one axis: a positive `dy` scrolls down, a negative one up, and
/// `dx` is the horizontal equivalent.
///
/// # Errors
/// [`WebError::Unsupported`] for a diagonal scroll, else a tool failure or the deadline.
pub async fn scroll(dx: i64, dy: i64, budget: Duration) -> Result<String> {
    if dx != 0 && dy != 0 {
        return Err(WebError::Unsupported {
            operation: "scroll",
            detail: "diagonal scroll is not exposed by the shared browser session",
        });
    }
    let (direction, amount) = if dy > 0 {
        ("down", dy)
    } else if dy < 0 {
        ("up", -dy)
    } else if dx > 0 {
        ("right", dx)
    } else {
        ("left", -dx)
    };
    text("browser_scroll", json!({ "direction": direction, "amount": amount }), budget).await
}

/// The open tabs of the shared session.
///
/// # Errors
/// Reports a tool failure or the deadline.
pub async fn tabs(budget: Duration) -> Result<String> {
    text("browser_tab_list", json!({}), budget).await
}

/// A PNG screenshot of the shared page, base64 encoded.
///
/// # Errors
/// Reports a tool failure (a blank session has no renderable viewport), a response without an
/// image, or the deadline.
pub async fn screenshot(budget: Duration) -> Result<String> {
    let result = call("browser_screenshot", json!({}), budget).await?;
    image_data(&result).map(str::to_owned).ok_or(WebError::Unsupported {
        operation: "screenshot",
        detail: "the browser returned no PNG image",
    })
}

/// Evaluate a JavaScript expression in a fresh browser state, without access to open tabs.
///
/// # Errors
/// Reports an evaluation failure or the deadline.
pub async fn evaluate(expression: &str, budget: Duration) -> Result<String> {
    call_isolated("browser_evaluate", json!({ "expression": expression }), budget)
        .await
        .map(|result| text_content(&result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_and_image_are_read_from_tool_responses() {
        let value = json!({"content": [
            {"type": "text", "text": "a"},
            {"type": "image", "data": "AAAA"},
            {"type": "text", "text": "b"},
        ]});
        assert_eq!(text_content(&value), "a\nb");
        assert_eq!(image_data(&value), Some("AAAA"));
        assert_eq!(text_content(&json!({})), "");
        assert_eq!(image_data(&json!({"content": []})), None);
    }

    #[tokio::test]
    async fn a_diagonal_scroll_is_refused_before_reaching_the_browser() {
        let error = scroll(5, 5, Duration::from_secs(1)).await.unwrap_err();
        assert!(matches!(error, WebError::Unsupported { operation: "scroll", .. }), "{error}");
    }

    #[tokio::test]
    async fn a_refused_url_never_starts_navigation() {
        let error = navigate("file:///etc/passwd", Duration::from_secs(5)).await.unwrap_err();
        assert!(error.to_string().contains("not allowed"), "{error}");
    }

    #[tokio::test]
    async fn javascript_evaluation_uses_a_fresh_rust_browser_state() {
        let result = evaluate("1 + 2", Duration::from_secs(10)).await.unwrap();
        assert_eq!(result.trim(), "3.0");
    }

    #[cfg(feature = "render")]
    #[tokio::test]
    async fn screenshot_without_a_renderable_page_reports_an_error() {
        let error = screenshot(Duration::from_secs(10))
            .await
            .expect_err("a blank session must not invent screenshot data");
        assert!(error.to_string().contains("no renderable viewport"), "{error}");
    }
}
