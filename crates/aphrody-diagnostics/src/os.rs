// SPDX-License-Identifier: Apache-2.0
//! Kernel subsystem status (`aphrody os status`).

use std::time::Duration;

use aphrody_kernel::{client::Client, transport::default_endpoint};
use miette::{IntoDiagnostic, miette};
use serde_json::Value;

/// Kernel snapshot: `online`, `offline` or `unavailable` with a reason.
pub async fn os_status() -> Value {
    match os_client().await {
        Ok(client) => os_snapshot(&client)
            .await
            .unwrap_or_else(|error| unavailable_os_snapshot("unavailable", &error.to_string())),
        Err(error) => unavailable_os_snapshot("offline", &error.to_string()),
    }
}

/// Connect to the kernel and initialize the session.
///
/// # Errors
/// Fails when the kernel is unreachable or times out.
pub async fn os_client() -> miette::Result<Client> {
    let endpoint = default_endpoint();
    let client = tokio::time::timeout(Duration::from_secs(5), Client::connect(&endpoint))
        .await
        .into_diagnostic()?
        .into_diagnostic()?;
    tokio::time::timeout(Duration::from_secs(5), client.initialize("aphrody-cli"))
        .await
        .into_diagnostic()?
        .into_diagnostic()?;
    Ok(client)
}

/// Online snapshot of subsystems and WinClean tools.
///
/// # Errors
/// Fails when the kernel answers with an unexpected shape.
pub async fn os_snapshot(client: &Client) -> miette::Result<Value> {
    let subsystems = client
        .request(
            "system/subsystems",
            serde_json::json!({}),
            Duration::from_secs(5),
        )
        .await
        .into_diagnostic()?;
    let names: Vec<_> = subsystems["subsystems"]
        .as_array()
        .ok_or_else(|| miette!("kernel returned no subsystem list"))?
        .iter()
        .filter_map(|entry| entry["name"].as_str().map(str::to_owned))
        .collect();
    let winclean_tools = if names.iter().any(|name| name == "admin") {
        client
            .request(
                "system/subsystem_tools",
                serde_json::json!({"name":"admin"}),
                Duration::from_secs(5),
            )
            .await
            .into_diagnostic()?["tools"]
            .as_array()
            .ok_or_else(|| miette!("kernel returned no admin tool list"))?
            .len()
    } else {
        0
    };
    Ok(serde_json::json!({
        "layer": "os",
        "status": "online",
        "subsystems": names,
        "winclean_tools": winclean_tools,
        "process_isolation": "not_enforced_by_kernel",
        "policy_enforcement": "not_enforced_by_kernel"
    }))
}

fn unavailable_os_snapshot(state: &str, reason: &str) -> Value {
    serde_json::json!({
        "layer": "os",
        "status": state,
        "reason": reason,
        "subsystems": [],
        "winclean_tools": 0,
        "process_isolation": "not_enforced_by_kernel",
        "policy_enforcement": "not_enforced_by_kernel"
    })
}
