// SPDX-License-Identifier: Apache-2.0
//! `aphrody-jev` — Jev decisions from the command line or as a Jev-compatible
//! server, in the mode selected by `APHRODY_JEV_MODE` (`aphrody`, `keyless`,
//! `api-key`).
//!
//! ```text
//! aphrody-jev serve [--bind 127.0.0.1:8787]   serve /v1/systemone
//! aphrody-jev decide < request.json            one decision, JSON on stdout
//! ```
//!
//! `APHRODY_JEV_SERVER_KEYS` (comma-separated) enables bearer authentication
//! on the server; it is required when binding to a non-loopback address.
// This optional product CLI runs before JSC and keeps the standalone crate independent of Bun I/O.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

use std::{collections::HashSet, ffi::OsString, io::Read, net::SocketAddr, sync::Arc};

use crate::{
    JevRouter, Request,
    server::{ServerState, app},
};

const USAGE: &str = "usage: aphrody-jev serve [--bind ADDR] | aphrody-jev decide [--minimum-confidence 0..1] < request.json";

fn decision_threshold(args: &[String]) -> Result<Option<f64>, String> {
    match args {
        [] => Ok(None),
        [flag, value] if flag == "--minimum-confidence" => {
            let threshold =
                crate::decision::parse_threshold(value).map_err(|error| error.to_string())?;
            Ok(Some(threshold))
        }
        _ => Err(USAGE.into()),
    }
}

/// Optional entrypoint for a product's multi-call CLI. `args[0]` is the program
/// name (argv convention). Returns the process exit code.
#[must_use]
pub fn cli_main(args: Vec<OsString>) -> i32 {
    let args: Vec<String> = args
        .into_iter()
        .skip(1)
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("aphrody-jev: runtime: {error}");
            return 1;
        }
    };
    match runtime.block_on(run(args)) {
        Ok(()) => 0,
        Err(message) => {
            eprintln!("aphrody-jev: {message}");
            1
        }
    }
}

async fn run(args: Vec<String>) -> Result<(), String> {
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        println!("{USAGE}");
        return Ok(());
    }
    if !matches!(args.first().map(String::as_str), Some("serve" | "decide")) {
        return Err(USAGE.into());
    }
    let minimum_confidence = if args[0] == "decide" {
        decision_threshold(&args[1..])?
    } else {
        None
    };
    let router = Arc::new(JevRouter::from_env().map_err(|e| e.to_string())?);
    match args.first().map(String::as_str) {
        Some("serve") => {
            let bind = match args.iter().position(|a| a == "--bind") {
                Some(i) => args.get(i + 1).ok_or(USAGE)?.clone(),
                None => "127.0.0.1:8787".to_owned(),
            };
            let addr: SocketAddr = bind.parse().map_err(|e| format!("--bind {bind}: {e}"))?;
            let keys: HashSet<String> = std::env::var("APHRODY_JEV_SERVER_KEYS")
                .unwrap_or_default()
                .split(',')
                .map(str::trim)
                .filter(|k| !k.is_empty())
                .map(str::to_owned)
                .collect();
            if keys.is_empty() && !addr.ip().is_loopback() {
                return Err("APHRODY_JEV_SERVER_KEYS is required on a non-loopback address".into());
            }
            let model =
                std::env::var("APHRODY_JEV_SERVED_MODEL").unwrap_or_else(|_| "jev-latest".into());
            let listener = tokio::net::TcpListener::bind(addr)
                .await
                .map_err(|e| format!("bind {addr}: {e}"))?;
            eprintln!("aphrody-jev serving /v1/systemone on http://{addr}");
            axum::serve(listener, app(ServerState::new(router, keys, model)))
                .await
                .map_err(|e| e.to_string())
        }
        Some("decide") => {
            let mut input = String::new();
            std::io::stdin()
                .read_to_string(&mut input)
                .map_err(|e| e.to_string())?;
            let request: Request = serde_json::from_str(&input).map_err(|e| e.to_string())?;
            let decision = router.decide(&request).await.map_err(|e| e.to_string())?;
            let selections = minimum_confidence
                .map(|threshold| {
                    crate::confident_choices(&request, &decision.response, threshold)
                        .map_err(|error| error.to_string())
                        .and_then(|choices| {
                            serde_json::to_value(choices).map_err(|error| error.to_string())
                        })
                })
                .transpose()?;
            let mut out = serde_json::json!({
                "served_by": decision.served_by.to_string(),
                "latency_ms": u64::try_from(decision.latency.as_millis()).unwrap_or(u64::MAX),
                "failover": decision.failover.map(|f| f.reason),
                "response": decision.response,
            });
            if let Some(selections) = selections {
                out["selections"] = selections;
            }
            println!("{out}");
            Ok(())
        }
        _ => Err(USAGE.into()),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn decision_options_reject_invalid_values_and_unknown_flags() {
        assert_eq!(super::decision_threshold(&[]).unwrap(), None);
        assert_eq!(
            super::decision_threshold(&["--minimum-confidence".into(), "0.8".into()]).unwrap(),
            Some(0.8)
        );
        for value in ["NaN", "inf", "-1", "1.1", "invalid"] {
            assert!(
                super::decision_threshold(&["--minimum-confidence".into(), value.into()]).is_err()
            );
        }
        assert!(super::decision_threshold(&["--minimum-confidence".into()]).is_err());
        assert!(super::decision_threshold(&["--unknown".into(), "0.8".into()]).is_err());
    }
    #[tokio::test]
    async fn help_does_not_initialize_a_backend() {
        for flag in ["--help", "-h"] {
            assert!(super::run(vec![flag.into()]).await.is_ok());
        }
    }

    #[tokio::test]
    async fn invalid_commands_report_usage_before_backend_discovery() {
        assert_eq!(super::run(Vec::new()).await, Err(super::USAGE.into()));
        assert_eq!(
            super::run(vec!["unknown".into()]).await,
            Err(super::USAGE.into())
        );
    }
}
