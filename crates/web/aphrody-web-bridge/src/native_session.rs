// SPDX-License-Identifier: Apache-2.0

//! A persistent in-process browser session for the legacy command facade.

use std::{
    sync::OnceLock,
    time::{Duration, Instant},
};

use serde_json::Value;
use tokio::sync::{mpsc, oneshot};

use crate::error::{BxcError, Result};

struct Request {
    tool: String,
    arguments: Value,
    deadline: Instant,
    isolated: bool,
    reply: oneshot::Sender<core::result::Result<Value, String>>,
}

fn sender() -> Result<&'static mpsc::UnboundedSender<Request>> {
    static SENDER: OnceLock<core::result::Result<mpsc::UnboundedSender<Request>, String>> =
        OnceLock::new();
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
                    let mut session = aphrody_web_service::WebSession::new(None, None, false);
                    while let Some(request) = receiver.recv().await {
                        let remaining = request.deadline.saturating_duration_since(Instant::now());
                        let result = if remaining.is_zero() {
                            Err("native browser request expired before execution".to_owned())
                        } else if request.isolated {
                            let mut isolated =
                                aphrody_web_service::WebSession::new(None, None, false);
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
            Err(BxcError::Browser { url: "native session".to_owned(), detail: detail.clone() })
        },
    }
}

/// Call a tool on the shared Rust browser state with a caller deadline.
///
/// # Errors
/// Reports browser startup, tool, transport or deadline failures.
pub async fn call(tool: &str, arguments: Value, budget: Duration) -> Result<Value> {
    call_inner(tool, arguments, budget, false).await
}

/// Run an expression in a fresh browser state without access to open tabs.
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
        .map_err(|_| BxcError::Browser {
            url: tool.to_owned(),
            detail: "native browser worker stopped".to_owned(),
        })?;
    let result = tokio::time::timeout(budget, receiver)
        .await
        .map_err(|_| BxcError::BrowserTimeout { url: tool.to_owned(), secs: budget.as_secs() })?
        .map_err(|_| BxcError::Browser {
            url: tool.to_owned(),
            detail: "native browser worker ended without a reply".to_owned(),
        })?
        .map_err(|detail| BxcError::Browser { url: tool.to_owned(), detail })?;
    if result.get("isError").and_then(Value::as_bool).unwrap_or(false) {
        return Err(BxcError::Browser { url: tool.to_owned(), detail: text_content(&result) });
    }
    Ok(result)
}

/// Extract plain text from an in-process browser tool response.
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

/// Extract the base64 PNG from an in-process screenshot response.
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
