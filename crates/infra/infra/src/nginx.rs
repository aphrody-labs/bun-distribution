// SPDX-License-Identifier: Apache-2.0
//! AST-typed Nginx configuration model, validation, and zero-downtime hot-reload controller.
//!
//! Provides a programmatic AST for generating clean, syntax-validated Nginx virtual host
//! and upstream configurations (supporting both loopback TCP and Unix domain sockets),
//! with mirror validation (`nginx -t -c <candidate> -q`) and atomic SIGHUP worker reload.

use std::{
    fmt::Write as _,
    path::Path,
};
use serde::{Deserialize, Serialize};

/// Target upstream definition: loopback TCP or zero-copy Unix domain socket.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "target")]
pub enum UpstreamTarget {
    /// TCP host:port, e.g. "127.0.0.1:3004".
    Tcp(String),
    /// Unix domain socket path, e.g. "/run/aphrody/rg-api.sock".
    UnixSocket(String),
}

impl UpstreamTarget {
    #[must_use]
    pub fn parse(raw: &str) -> Self {
        let trimmed = raw.trim();
        if let Some(path) = trimmed.strip_prefix("unix:") {
            Self::UnixSocket(path.to_string())
        } else if trimmed.starts_with('/') {
            Self::UnixSocket(trimmed.to_string())
        } else {
            Self::Tcp(trimmed.to_string())
        }
    }

    #[must_use]
    pub fn to_nginx_target(&self) -> String {
        match self {
            Self::Tcp(addr) => addr.clone(),
            Self::UnixSocket(path) => format!("unix:{path}"),
        }
    }
}

/// Upstream block definition in Nginx.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpstreamBlock {
    pub name: String,
    pub targets: Vec<UpstreamTarget>,
    pub keepalive: Option<u32>,
}

impl UpstreamBlock {
    #[must_use]
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            targets: Vec::new(),
            keepalive: None,
        }
    }

    #[must_use]
    pub fn with_target(mut self, target: UpstreamTarget) -> Self {
        self.targets.push(target);
        self
    }

    #[must_use]
    pub fn with_keepalive(mut self, keepalive: u32) -> Self {
        self.keepalive = Some(keepalive);
        self
    }
}

/// Location block routing requests to an upstream, static assets, or fastcgi.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocationBlock {
    pub path: String,
    pub proxy_pass: Option<String>,
    pub proxy_http_version: Option<String>,
    pub headers: Vec<(String, String)>,
    pub custom_directives: Vec<String>,
}

impl LocationBlock {
    #[must_use]
    pub fn new(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            proxy_pass: None,
            proxy_http_version: Some("1.1".to_string()),
            headers: Vec::new(),
            custom_directives: Vec::new(),
        }
    }

    #[must_use]
    pub fn with_proxy(mut self, upstream: &str) -> Self {
        let trimmed = upstream.trim();
        let pass = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            trimmed.to_string()
        } else {
            format!("http://{trimmed}")
        };
        self.proxy_pass = Some(pass);
        self.headers.push(("Host".into(), "$host".into()));
        self.headers.push(("X-Real-IP".into(), "$remote_addr".into()));
        self.headers.push(("X-Forwarded-For".into(), "$proxy_add_x_forwarded_for".into()));
        self.headers.push(("X-Forwarded-Proto".into(), "$scheme".into()));
        self
    }
}

/// Virtual host server block in Nginx.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerBlock {
    pub server_names: Vec<String>,
    pub listen_ports: Vec<String>,
    pub ssl_certificate: Option<String>,
    pub ssl_certificate_key: Option<String>,
    pub locations: Vec<LocationBlock>,
    pub custom_directives: Vec<String>,
}

impl ServerBlock {
    #[must_use]
    pub fn new(server_name: impl Into<String>) -> Self {
        Self {
            server_names: vec![server_name.into()],
            listen_ports: vec!["80".to_string()],
            ssl_certificate: None,
            ssl_certificate_key: None,
            locations: Vec::new(),
            custom_directives: Vec::new(),
        }
    }

    #[must_use]
    pub fn with_tls(mut self, cert_path: impl Into<String>, key_path: impl Into<String>) -> Self {
        self.listen_ports = vec!["443 ssl http2".to_string()];
        self.ssl_certificate = Some(cert_path.into());
        self.ssl_certificate_key = Some(key_path.into());
        self
    }

    #[must_use]
    pub fn with_location(mut self, location: LocationBlock) -> Self {
        self.locations.push(location);
        self
    }
}

/// Complete Nginx virtual host or site configuration.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct NginxConfig {
    pub upstreams: Vec<UpstreamBlock>,
    pub servers: Vec<ServerBlock>,
}

impl NginxConfig {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn with_upstream(mut self, upstream: UpstreamBlock) -> Self {
        self.upstreams.push(upstream);
        self
    }

    #[must_use]
    pub fn with_server(mut self, server: ServerBlock) -> Self {
        self.servers.push(server);
        self
    }

    /// Renders the configuration to standard Nginx syntax.
    #[must_use]
    pub fn render(&self) -> String {
        let mut out = String::new();

        // Render Upstreams
        for upstream in &self.upstreams {
            writeln!(out, "upstream {} {{", upstream.name).unwrap();
            for target in &upstream.targets {
                writeln!(out, "    server {};", target.to_nginx_target()).unwrap();
            }
            if let Some(keepalive) = upstream.keepalive {
                writeln!(out, "    keepalive {keepalive};").unwrap();
            }
            writeln!(out, "}}\n").unwrap();
        }

        // Render Servers
        for server in &self.servers {
            writeln!(out, "server {{").unwrap();
            for port in &server.listen_ports {
                writeln!(out, "    listen {port};").unwrap();
            }
            if !server.server_names.is_empty() {
                writeln!(out, "    server_name {};", server.server_names.join(" ")).unwrap();
            }
            if let Some(cert) = &server.ssl_certificate {
                writeln!(out, "    ssl_certificate {cert};").unwrap();
            }
            if let Some(key) = &server.ssl_certificate_key {
                writeln!(out, "    ssl_certificate_key {key};").unwrap();
            }
            for directive in &server.custom_directives {
                writeln!(out, "    {directive};").unwrap();
            }

            for loc in &server.locations {
                writeln!(out, "\n    location {} {{", loc.path).unwrap();
                if let Some(pass) = &loc.proxy_pass {
                    writeln!(out, "        proxy_pass {pass};").unwrap();
                }
                if let Some(version) = &loc.proxy_http_version {
                    writeln!(out, "        proxy_http_version {version};").unwrap();
                }
                for (h_name, h_val) in &loc.headers {
                    writeln!(out, "        proxy_set_header {h_name} {h_val};").unwrap();
                }
                for directive in &loc.custom_directives {
                    writeln!(out, "        {directive};").unwrap();
                }
                writeln!(out, "    }}").unwrap();
            }
            writeln!(out, "}}\n").unwrap();
        }

        out
    }

    /// Perform a syntax check on a candidate configuration file via `nginx -t -c <path> -q`.
    pub fn test_syntax(candidate_path: &Path) -> Result<(), String> {
        #[cfg(unix)]
        {
            let output = std::process::Command::new("nginx")
                .arg("-t")
                .arg("-c")
                .arg(candidate_path)
                .arg("-q")
                .output()
                .map_err(|e| format!("failed to spawn nginx binary: {e}"))?;

            if output.status.success() {
                Ok(())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("Nginx syntax check failed:\n{}", stderr.trim()))
            }
        }
        #[cfg(not(unix))]
        {
            let _ = candidate_path;
            Err("Nginx syntax validation is only supported on Unix".to_string())
        }
    }

    /// Perform zero-downtime hot-reload of Nginx workers by sending SIGHUP to the master process.
    pub fn reload_hot(pid_file: Option<&Path>) -> Result<(), String> {
        #[cfg(unix)]
        {
            let default_pid_path = Path::new("/run/nginx.pid");
            let path = pid_file.unwrap_or(default_pid_path);

            let raw_pid = std::fs::read_to_string(path)
                .map_err(|e| format!("failed to read Nginx master PID from {}: {e}", path.display()))?;

            let pid: i32 = raw_pid
                .trim()
                .parse()
                .map_err(|e| format!("invalid PID format in {}: {e}", path.display()))?;

            // Send SIGHUP (signal 1) to trigger graceful reload using standard kill command
            let output = std::process::Command::new("kill")
                .arg("-HUP")
                .arg(pid.to_string())
                .output()
                .map_err(|e| format!("failed to invoke kill -HUP {pid}: {e}"))?;

            if output.status.success() {
                Ok(())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                Err(format!("failed to send SIGHUP to Nginx master PID {pid}: {stderr}"))
            }
        }
        #[cfg(not(unix))]
        {
            let _ = pid_file;
            Err("Nginx hot-reload is only supported on Unix".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_upstream_targets() {
        assert_eq!(
            UpstreamTarget::parse("127.0.0.1:8800"),
            UpstreamTarget::Tcp("127.0.0.1:8800".to_string())
        );
        assert_eq!(
            UpstreamTarget::parse("unix:/run/aphrody/rg-api.sock"),
            UpstreamTarget::UnixSocket("/run/aphrody/rg-api.sock".to_string())
        );
        assert_eq!(
            UpstreamTarget::parse("/run/aphrody/shenron.sock"),
            UpstreamTarget::UnixSocket("/run/aphrody/shenron.sock".to_string())
        );
    }

    #[test]
    fn render_virtual_host_with_unix_socket() {
        let config = NginxConfig::new()
            .with_upstream(
                UpstreamBlock::new("rg_api_upstream")
                    .with_target(UpstreamTarget::UnixSocket("/run/aphrody/rg-api.sock".to_string()))
                    .with_keepalive(32),
            )
            .with_server(
                ServerBlock::new("api.rosegriffon.fr")
                    .with_tls("/etc/letsencrypt/live/api.rosegriffon.fr/fullchain.pem", "/etc/letsencrypt/live/api.rosegriffon.fr/privkey.pem")
                    .with_location(LocationBlock::new("/").with_proxy("rg_api_upstream")),
            );

        let rendered = config.render();
        assert!(rendered.contains("upstream rg_api_upstream {"));
        assert!(rendered.contains("server unix:/run/aphrody/rg-api.sock;"));
        assert!(rendered.contains("keepalive 32;"));
        assert!(rendered.contains("listen 443 ssl http2;"));
        assert!(rendered.contains("server_name api.rosegriffon.fr;"));
        assert!(rendered.contains("proxy_pass http://rg_api_upstream;"));
        assert!(rendered.contains("proxy_set_header Host $host;"));
    }
}
