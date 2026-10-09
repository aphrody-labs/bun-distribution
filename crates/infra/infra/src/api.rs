// SPDX-License-Identifier: Apache-2.0
//! Embedded HTTP API server for Aphrody infrastructure.
//!
//! Provides lightweight, native HTTP endpoints for control plane operations:
//! - `/health`
//! - `/api/v1/status`
//! - `/api/v1/catalog`
//! - `/api/v1/services`
//! - `/api/v1/validate`
//! - `/api/v1/pipeline/plan`
//!
//! Pure standard library TCP implementation — zero heavy external HTTP framework dependencies.

use crate::catalog::load_service_catalog;
use crate::lifecycle::{ServiceAction, execute_lifecycle, get_service_statuses};
use crate::pipeline::load_pipeline_config;
use crate::validate;
use anyhow::{Context, Result};
use serde_json::json;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;

pub struct ApiServer {
    root: PathBuf,
    port: u16,
    target: String,
}

impl ApiServer {
    pub fn new(root: PathBuf, port: u16, target: String) -> Self {
        Self { root, port, target }
    }

    pub fn run(self) -> Result<()> {
        let addr = format!("127.0.0.1:{}", self.port);
        let listener =
            TcpListener::bind(&addr).with_context(|| format!("impossible d'écouter sur {addr}"))?;

        println!("aphrody-infra api en écoute sur http://{}", addr);
        let shared_self = Arc::new(self);

        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let server = Arc::clone(&shared_self);
                    thread::spawn(move || {
                        if let Err(e) = handle_connection(stream, &server) {
                            eprintln!("erreur traitement connexion: {e}");
                        }
                    });
                },
                Err(e) => eprintln!("erreur accept: {e}"),
            }
        }
        Ok(())
    }
}

fn handle_connection(mut stream: TcpStream, server: &ApiServer) -> Result<()> {
    let mut reader = BufReader::new(&stream);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;

    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return Ok(());
    }

    let method = parts[0];
    let path = parts[1];

    let (status_code, body) = route_request(&server.root, &server.target, method, path);

    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status_code,
        body.len(),
        body
    );

    stream.write_all(response.as_bytes())?;
    stream.flush()?;
    Ok(())
}

fn route_request(root: &Path, target: &str, method: &str, path: &str) -> (&'static str, String) {
    if method == "OPTIONS" {
        return ("204 No Content", String::new());
    }

    match (method, path) {
        ("GET", "/health") => (
            "200 OK",
            json!({
                "status": "ok",
                "service": "aphrody-infra-api",
                "version": env!("CARGO_PKG_VERSION")
            })
            .to_string(),
        ),
        ("GET", "/api/v1/catalog") => match load_service_catalog(root) {
            Ok(cat) => ("200 OK", serde_json::to_string_pretty(&cat).unwrap_or_default()),
            Err(e) => ("500 Internal Server Error", json!({ "error": e.to_string() }).to_string()),
        },
        ("GET", "/api/v1/services") => match get_service_statuses(root, target, None) {
            Ok(statuses) => {
                ("200 OK", json!({ "target": target, "services": statuses }).to_string())
            },
            Err(e) => ("500 Internal Server Error", json!({ "error": e.to_string() }).to_string()),
        },
        ("GET", "/api/v1/validate") => match validate::run(root) {
            Ok(report) => ("200 OK", serde_json::to_string_pretty(&report).unwrap_or_default()),
            Err(e) => ("500 Internal Server Error", json!({ "error": e.to_string() }).to_string()),
        },
        ("GET", "/api/v1/pipeline/plan") => match load_pipeline_config(root) {
            Ok(config) => ("200 OK", serde_json::to_string_pretty(&config).unwrap_or_default()),
            Err(e) => ("500 Internal Server Error", json!({ "error": e.to_string() }).to_string()),
        },
        ("GET", "/api/v1/git/status") => match aphrody_git::inspect_repository(root) {
            Ok(repo) => ("200 OK", serde_json::to_string_pretty(&repo).unwrap_or_default()),
            Err(e) => ("500 Internal Server Error", json!({ "error": e.to_string() }).to_string()),
        },
        ("GET", "/api/v1/vpn/proxy") => {
            let host = std::env::var(aphrody_vpn::PROXY_HOST_ENV).ok();
            let remote = std::env::var(aphrody_vpn::PROXY_REMOTE_ENV).ok();
            match aphrody_vpn::vps_proxy_target(host, remote) {
                Ok((h, r)) => ("200 OK", json!({ "host": h, "remote": r }).to_string()),
                Err(e) => {
                    ("503 Service Unavailable", json!({ "error": e.to_string() }).to_string())
                },
            }
        },
        ("GET", "/api/v1/drive/mounts") => match crate::drive::VirtualDriveEngine::new() {
            Ok(engine) => {
                ("200 OK", serde_json::to_string_pretty(&engine.list_mounts()).unwrap_or_default())
            },
            Err(e) => ("500 Internal Server Error", json!({ "error": e.to_string() }).to_string()),
        },
        ("GET", "/api/v1/git/overview") => {
            match crate::drive::VirtualDriveEngine::new().and_then(|e| e.git_overview(root)) {
                Ok(overview) => {
                    ("200 OK", serde_json::to_string_pretty(&overview).unwrap_or_default())
                },
                Err(e) => {
                    ("500 Internal Server Error", json!({ "error": e.to_string() }).to_string())
                },
            }
        },
        ("GET", "/api/v1/git/graph") => match aphrody_git::commit_graph(root, 50) {
            Ok(graph) => ("200 OK", serde_json::to_string_pretty(&graph).unwrap_or_default()),
            Err(e) => ("500 Internal Server Error", json!({ "error": e.to_string() }).to_string()),
        },
        ("GET", "/api/v1/git/branches") => match aphrody_git::list_branches(root) {
            Ok(branches) => ("200 OK", serde_json::to_string_pretty(&branches).unwrap_or_default()),
            Err(e) => ("500 Internal Server Error", json!({ "error": e.to_string() }).to_string()),
        },
        ("GET", "/api/v1/git/worktrees") => match aphrody_git::list_worktrees(root) {
            Ok(wts) => ("200 OK", serde_json::to_string_pretty(&wts).unwrap_or_default()),
            Err(e) => ("500 Internal Server Error", json!({ "error": e.to_string() }).to_string()),
        },
        ("GET", "/api/v1/ssh/hosts") => (
            "200 OK",
            json!({ "hosts": aphrody_ssh::Host::ALL.map(aphrody_ssh::Host::alias) }).to_string(),
        ),
        ("POST", p) if p.starts_with("/api/v1/services/") => {
            let sub = p.trim_start_matches("/api/v1/services/");
            let parts: Vec<&str> = sub.split('/').collect();
            if parts.len() != 2 {
                return (
                    "400 Bad Request",
                    json!({ "error": "usage: /api/v1/services/:id/:action" }).to_string(),
                );
            }
            let service_id = parts[0];
            let action_str = parts[1];

            let action = match action_str {
                "start" => ServiceAction::Start,
                "stop" => ServiceAction::Stop,
                "restart" => ServiceAction::Restart,
                _ => {
                    return (
                        "400 Bad Request",
                        json!({ "error": format!("action non supportée: {}", action_str) })
                            .to_string(),
                    );
                },
            };

            match execute_lifecycle(root, action, Some(service_id), target) {
                Ok(results) => {
                    ("200 OK", json!({ "action": action_str, "results": results }).to_string())
                },
                Err(e) => {
                    ("500 Internal Server Error", json!({ "error": e.to_string() }).to_string())
                },
            }
        },
        _ => ("404 Not Found", json!({ "error": "route introuvable", "path": path }).to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn route_request_handles_health_and_options() {
        let dummy_root = PathBuf::from(".");
        let (status, body) = route_request(&dummy_root, "vps", "OPTIONS", "/health");
        assert_eq!(status, "204 No Content");
        assert!(body.is_empty());

        let (status_health, body_health) = route_request(&dummy_root, "vps", "GET", "/health");
        assert_eq!(status_health, "200 OK");
        assert!(body_health.contains("aphrody-infra-api"));
    }

    #[test]
    fn route_request_returns_404_on_unknown() {
        let dummy_root = PathBuf::from(".");
        let (status, body) = route_request(&dummy_root, "vps", "GET", "/api/v1/unknown");
        assert_eq!(status, "404 Not Found");
        assert!(body.contains("route introuvable"));
    }
}
