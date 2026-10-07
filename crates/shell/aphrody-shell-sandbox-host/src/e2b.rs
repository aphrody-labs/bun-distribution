// SPDX-License-Identifier: Apache-2.0
//! E2B sandbox lifecycle, files and PTY sessions behind `SandboxHost`.
//!
//! The control API and the in-sandbox envd API use different credentials. This
//! adapter never exposes either credential to a shell process or a wire frame.

use std::{
    collections::BTreeMap,
    io::{self, Read},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    thread,
    time::Duration,
};

use crate::{HostError, HostLimits, SandboxHost};
use aphrody_shell_session::{SessionError, ShellSession, SpawnSpec, check_size};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use reqwest::blocking::{Client, Response, multipart};
use serde_json::{Value, json};

const MAX_CONNECT_FRAME: usize = 1024 * 1024;
const API_BASE: &str = "https://api.e2b.app";
const DEFAULT_ENVD_BASE: &str = "https://sandbox.e2b.app";

/// Configuration for one E2B sandbox. Supply credentials from the protected store.
pub struct E2bConfig {
    /// E2B project API key for sandbox lifecycle.
    pub api_key: String,
    /// E2B template ID. Its image must provide `/bin/bash`.
    pub template_id: String,
    /// Maximum provider sandbox lifetime. The provider also enforces this timeout.
    pub lifetime: Duration,
    /// Shell quotas enforced by this adapter.
    pub limits: HostLimits,
}

impl E2bConfig {
    fn validate(&self) -> Result<u64, HostError> {
        if self.api_key.is_empty() || self.template_id.is_empty() {
            return Err(HostError::Provider("E2B API key and template ID are required".into()));
        }
        let seconds = self.lifetime.as_secs();
        if seconds == 0 || seconds > 24 * 60 * 60 {
            return Err(HostError::Provider("E2B lifetime must be 1..86400 seconds".into()));
        }
        Ok(seconds)
    }
}

#[derive(Clone)]
struct Envd {
    client: Client,
    base: String,
    sandbox_id: String,
    access_token: String,
}

impl Envd {
    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::blocking::RequestBuilder {
        self.client
            .request(method, format!("{}{path}", self.base))
            .header("E2b-Sandbox-Id", &self.sandbox_id)
            .header("E2b-Sandbox-Port", "49983")
            .header("X-Access-Token", &self.access_token)
    }

    fn rpc(&self, operation: &str, body: Value) -> Result<(), SessionError> {
        let response = self
            .request(reqwest::Method::POST, &format!("/process.Process/{operation}"))
            .header("Connect-Protocol-Version", "1")
            .json(&body)
            .send()
            .map_err(|error| SessionError::Engine(format!("E2B {operation} request: {error}")))?;
        if !response.status().is_success() {
            return Err(SessionError::Engine(format!(
                "E2B {operation} returned HTTP {}",
                response.status()
            )));
        }
        Ok(())
    }

    fn stream(&self, operation: &str, body: Value) -> Result<Response, HostError> {
        let payload = encode_connect(&body)?;
        let response = self
            .request(reqwest::Method::POST, &format!("/process.Process/{operation}"))
            .header("Content-Type", "application/connect+json")
            .header("Connect-Protocol-Version", "1")
            .body(payload)
            .send()
            .map_err(|error| provider_error("E2B process stream", error))?;
        if !response.status().is_success() {
            return Err(HostError::Provider(format!(
                "E2B {operation} returned HTTP {}",
                response.status()
            )));
        }
        Ok(response)
    }
}

/// One billable E2B sandbox. Dropping it requests deletion.
pub struct E2bHost {
    control: Client,
    api_key: String,
    envd: Envd,
    limits: HostLimits,
    active: Arc<AtomicUsize>,
}

impl E2bHost {
    /// Create a provider sandbox. This starts billable usage.
    ///
    /// # Errors
    /// Returns a configuration, transport or provider error.
    pub fn create(config: E2bConfig) -> Result<Self, HostError> {
        let lifetime = config.validate()?;
        let _ = rustls::crypto::ring::default_provider().install_default();
        let control = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|error| provider_error("E2B HTTP client", error))?;
        let response = control
            .post(format!("{API_BASE}/v2/sandboxes"))
            .header("X-API-Key", &config.api_key)
            .json(&json!({
                "templateID": config.template_id,
                "timeout": lifetime,
                "autoPause": false,
                "allow_internet_access": false,
                "network": {"allowPublicTraffic": false}
            }))
            .send()
            .map_err(|error| provider_error("E2B create", error))?;
        if !response.status().is_success() {
            return Err(HostError::Provider(format!(
                "E2B create returned HTTP {}",
                response.status()
            )));
        }
        let created: Value =
            response.json().map_err(|error| provider_error("E2B create response", error))?;
        let sandbox_id = required_string(&created, "sandboxID")?;
        let envd = (|| {
            let access_token = required_string(&created, "envdAccessToken")?;
            let domain = created.get("domain").and_then(Value::as_str).unwrap_or("e2b.app");
            if !domain
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-')
            {
                return Err(HostError::Provider("E2B returned invalid sandbox domain".into()));
            }
            Ok(Envd {
                client: Client::builder()
                    .connect_timeout(Duration::from_secs(10))
                    .build()
                    .map_err(|error| provider_error("E2B envd client", error))?,
                base: if domain == "e2b.app" {
                    DEFAULT_ENVD_BASE.to_owned()
                } else {
                    format!("https://sandbox.{domain}")
                },
                sandbox_id: sandbox_id.clone(),
                access_token,
            })
        })();
        let envd = match envd {
            Ok(envd) => envd,
            Err(error) => {
                let _ = control
                    .delete(format!("{API_BASE}/sandboxes/{sandbox_id}"))
                    .header("X-API-Key", &config.api_key)
                    .send();
                return Err(error);
            },
        };
        Ok(Self {
            control,
            api_key: config.api_key,
            envd,
            limits: config.limits,
            active: Arc::new(AtomicUsize::new(0)),
        })
    }

    /// Provider sandbox identifier, safe to use in a private audit record.
    pub fn sandbox_id(&self) -> &str {
        &self.envd.sandbox_id
    }

    /// Start a PTY and return its provider process ID for later reattachment.
    ///
    /// # Errors
    /// Returns a session limit, process or provider error.
    pub fn spawn_with_id(
        &mut self,
        spec: &SpawnSpec,
    ) -> Result<(u32, Box<dyn ShellSession>), HostError> {
        check_size(spec.columns, spec.rows)?;
        if self.active.load(Ordering::Acquire) >= self.limits.max_sessions {
            return Err(HostError::Limit("maximum sessions"));
        }
        let mut envs: BTreeMap<String, String> = spec.env.iter().cloned().collect();
        envs.entry("TERM".into()).or_insert_with(|| "xterm-256color".into());
        envs.entry("LANG".into()).or_insert_with(|| "C.UTF-8".into());
        let mut response = self.envd.stream(
            "Start",
            json!({
                "process": {"cmd": "/bin/bash", "args": ["-i", "-l"], "cwd": spec.cwd, "envs": envs},
                "pty": {"size": {"cols": spec.columns, "rows": spec.rows}}
            }),
        )?;
        let first = read_connect(&mut response)?.ok_or_else(|| {
            HostError::Provider("E2B Start stream closed before process start".into())
        })?;
        let pid = process_pid(&first)?;
        let session = self.session(pid, (spec.columns, spec.rows), response)?;
        Ok((pid, session))
    }

    /// Reattach to a provider PTY after its transport disconnects. The PID must
    /// belong to this sandbox; E2B rejects unknown PIDs.
    ///
    /// # Errors
    /// Returns a session limit, process or provider error.
    pub fn reattach(
        &mut self,
        pid: u32,
        columns: u16,
        rows: u16,
    ) -> Result<Box<dyn ShellSession>, HostError> {
        check_size(columns, rows)?;
        if self.active.load(Ordering::Acquire) >= self.limits.max_sessions {
            return Err(HostError::Limit("maximum sessions"));
        }
        let mut response = self.envd.stream("Connect", json!({"process": {"pid": pid}}))?;
        let first = read_connect(&mut response)?.ok_or_else(|| {
            HostError::Provider("E2B Connect stream closed before process start".into())
        })?;
        if process_pid(&first)? != pid {
            return Err(HostError::Provider("E2B Connect returned a different process".into()));
        }
        self.session(pid, (columns, rows), response)
    }

    fn session(
        &mut self,
        pid: u32,
        size: (u16, u16),
        response: Response,
    ) -> Result<Box<dyn ShellSession>, HostError> {
        let state = Arc::new(Mutex::new(OutputState::default()));
        let reader_state = Arc::clone(&state);
        let max_output = self.limits.max_output_bytes;
        let envd = self.envd.clone();
        thread::Builder::new()
            .name("aphrody-e2b-pty".into())
            .spawn(move || drain_stream(response, reader_state, max_output, &envd, pid))
            .map_err(|error| provider_error("E2B PTY reader", error))?;
        self.active.fetch_add(1, Ordering::AcqRel);
        Ok(Box::new(E2bSession {
            envd: self.envd.clone(),
            pid,
            size,
            state,
            max_input_frame_bytes: self.limits.max_input_frame_bytes,
            active: Arc::clone(&self.active),
        }))
    }
}

impl Drop for E2bHost {
    fn drop(&mut self) {
        let _ = self
            .control
            .delete(format!("{API_BASE}/sandboxes/{}", self.envd.sandbox_id))
            .header("X-API-Key", &self.api_key)
            .send();
    }
}

impl SandboxHost for E2bHost {
    fn spawn(&mut self, spec: &SpawnSpec) -> Result<Box<dyn ShellSession>, HostError> {
        self.spawn_with_id(spec).map(|(_, session)| session)
    }

    fn upload(&mut self, path: &[u8], data: &[u8]) -> Result<(), HostError> {
        if data.len() > self.limits.max_output_bytes {
            return Err(HostError::Limit("upload exceeds host file limit"));
        }
        let path = path_text(path)?;
        let form = multipart::Form::new()
            .part("file", multipart::Part::bytes(data.to_vec()).file_name("upload"));
        let response = self
            .envd
            .request(reqwest::Method::POST, "/files")
            .query(&[("path", path)])
            .multipart(form)
            .send()
            .map_err(|error| provider_error("E2B upload", error))?;
        check_response("upload", &response)
    }

    fn download(&mut self, path: &[u8]) -> Result<Vec<u8>, HostError> {
        let path = path_text(path)?;
        let response = self
            .envd
            .request(reqwest::Method::GET, "/files")
            .query(&[("path", path)])
            .send()
            .map_err(|error| provider_error("E2B download", error))?;
        check_response("download", &response)?;
        let mut limited = response.take((self.limits.max_output_bytes as u64).saturating_add(1));
        let mut data = Vec::new();
        limited.read_to_end(&mut data).map_err(|error| provider_error("E2B download", error))?;
        if data.len() > self.limits.max_output_bytes {
            return Err(HostError::Limit("download exceeds output limit"));
        }
        Ok(data)
    }

    fn limits(&self) -> HostLimits {
        self.limits
    }
}

#[derive(Default)]
struct OutputState {
    pending: Vec<u8>,
    total: usize,
    exit: Option<i32>,
}

struct E2bSession {
    envd: Envd,
    pid: u32,
    size: (u16, u16),
    state: Arc<Mutex<OutputState>>,
    max_input_frame_bytes: usize,
    active: Arc<AtomicUsize>,
}

impl Drop for E2bSession {
    fn drop(&mut self) {
        // Dropping a transport handle detaches the stream; the provider process
        // remains available for E2bHost::reattach. Host deletion bounds its lifetime.
        self.active.fetch_sub(1, Ordering::AcqRel);
    }
}

impl ShellSession for E2bSession {
    fn write_input(&mut self, bytes: &[u8]) -> Result<(), SessionError> {
        if self.exited() {
            return Err(SessionError::Exited);
        }
        if bytes.len() > self.max_input_frame_bytes {
            return Err(SessionError::Engine("E2B input frame exceeds host limit".into()));
        }
        self.envd.rpc(
            "SendInput",
            json!({"process": {"pid": self.pid}, "input": {"pty": STANDARD.encode(bytes)}}),
        )
    }

    fn resize(&mut self, columns: u16, rows: u16) -> Result<(), SessionError> {
        check_size(columns, rows)?;
        if self.exited() {
            return Err(SessionError::Exited);
        }
        self.envd.rpc(
            "Update",
            json!({"process": {"pid": self.pid}, "pty": {"size": {"cols": columns, "rows": rows}}}),
        )?;
        self.size = (columns, rows);
        Ok(())
    }

    fn size(&self) -> (u16, u16) {
        self.size
    }

    fn take_output(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.state.lock().unwrap_or_else(|lock| lock.into_inner()).pending)
    }

    fn exit_status(&self) -> Option<i32> {
        self.state.lock().unwrap_or_else(|lock| lock.into_inner()).exit
    }

    fn kill(&mut self) {
        if self.exited() {
            return;
        }
        let _ = self
            .envd
            .rpc("SendSignal", json!({"process": {"pid": self.pid}, "signal": "SIGNAL_SIGKILL"}));
        self.state.lock().unwrap_or_else(|lock| lock.into_inner()).exit = Some(-9);
    }
}

fn drain_stream(
    mut response: Response,
    state: Arc<Mutex<OutputState>>,
    max_output: usize,
    envd: &Envd,
    pid: u32,
) {
    loop {
        match read_connect(&mut response) {
            Ok(Some(event)) => {
                let mut output = state.lock().unwrap_or_else(|lock| lock.into_inner());
                if let Some(encoded) =
                    event.pointer("/event/data/output/pty").and_then(Value::as_str)
                    && let Ok(bytes) = STANDARD.decode(encoded)
                {
                    output.total = output.total.saturating_add(bytes.len());
                    if output.total > max_output {
                        output.exit = Some(-1);
                        drop(output);
                        let _ = envd.rpc(
                            "SendSignal",
                            json!({"process": {"pid": pid}, "signal": "SIGNAL_SIGKILL"}),
                        );
                        break;
                    }
                    output.pending.extend_from_slice(&bytes);
                }
                if let Some(code) = event.pointer("/event/end/exitCode").and_then(Value::as_i64) {
                    output.exit = i32::try_from(code).ok().or(Some(-1));
                    break;
                }
            },
            Ok(None) => break,
            Err(_) => break,
        }
    }
    let mut output = state.lock().unwrap_or_else(|lock| lock.into_inner());
    output.exit.get_or_insert(-1);
}

fn process_pid(event: &Value) -> Result<u32, HostError> {
    event
        .pointer("/event/start/pid")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| HostError::Provider("E2B stream did not return a process ID".into()))
}

fn encode_connect(body: &Value) -> Result<Vec<u8>, HostError> {
    let json = serde_json::to_vec(body).map_err(|error| provider_error("Connect JSON", error))?;
    let length = u32::try_from(json.len())
        .map_err(|_| HostError::Provider("Connect request too large".into()))?;
    let mut frame = Vec::with_capacity(json.len() + 5);
    frame.push(0);
    frame.extend_from_slice(&length.to_be_bytes());
    frame.extend_from_slice(&json);
    Ok(frame)
}

fn read_connect(reader: &mut impl Read) -> Result<Option<Value>, HostError> {
    let mut header = [0_u8; 5];
    loop {
        match reader.read(&mut header[..1]) {
            Ok(0) => return Ok(None),
            Ok(_) => break,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {},
            Err(error) => return Err(provider_error("Connect frame", error)),
        }
    }
    reader.read_exact(&mut header[1..]).map_err(|error| provider_error("Connect frame", error))?;
    if header[0] & !2 != 0 {
        return Err(HostError::Provider("unsupported Connect frame flags".into()));
    }
    let length = u32::from_be_bytes(header[1..5].try_into().expect("four-byte length")) as usize;
    if length > MAX_CONNECT_FRAME {
        return Err(HostError::Provider("Connect frame exceeds limit".into()));
    }
    let mut bytes = vec![0_u8; length];
    reader.read_exact(&mut bytes).map_err(|error| provider_error("Connect payload", error))?;
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|error| provider_error("Connect JSON", error))?;
    if header[0] & 2 != 0 {
        if value.get("error").is_some_and(|error| !error.is_null()) {
            return Err(HostError::Provider("E2B Connect stream returned an error".into()));
        }
        return Ok(None);
    }
    Ok(Some(value))
}

fn required_string(value: &Value, name: &str) -> Result<String, HostError> {
    value
        .get(name)
        .and_then(Value::as_str)
        .filter(|string| !string.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| HostError::Provider(format!("E2B response missing {name}")))
}

fn path_text(path: &[u8]) -> Result<&str, HostError> {
    let text = std::str::from_utf8(path)
        .map_err(|_| HostError::Provider("E2B path must be UTF-8".into()))?;
    if !text.starts_with('/') || text.contains('\0') {
        return Err(HostError::Provider("E2B path must be absolute and contain no NUL".into()));
    }
    Ok(text)
}

fn check_response(operation: &str, response: &Response) -> Result<(), HostError> {
    if response.status().is_success() {
        Ok(())
    } else {
        Err(HostError::Provider(format!("E2B {operation} returned HTTP {}", response.status())))
    }
}

fn provider_error(operation: &str, error: impl std::fmt::Display) -> HostError {
    HostError::Provider(format!("{operation}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Write, net::TcpListener};

    #[test]
    fn connect_frames_are_bounded_and_decode() {
        let event = json!({"event": {"start": {"pid": 42}}});
        let frame = encode_connect(&event).unwrap();
        assert_eq!(read_connect(&mut frame.as_slice()).unwrap(), Some(event));
        let mut truncated = &frame[..3];
        assert!(read_connect(&mut truncated).is_err());
        let mut oversized = [0_u8; 5];
        oversized[1..].copy_from_slice(&(MAX_CONNECT_FRAME as u32 + 1).to_be_bytes());
        assert!(read_connect(&mut oversized.as_slice()).is_err());
    }

    #[test]
    fn provider_paths_must_be_absolute_utf8() {
        assert!(path_text(b"/contract-input").is_ok());
        assert!(path_text(b"relative").is_err());
        assert!(path_text(&[b'/', 255]).is_err());
    }

    #[test]
    fn stream_uses_connect_framing_and_sandbox_auth_headers() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut request = Vec::new();
            let mut chunk = [0_u8; 1024];
            let split = loop {
                let count = socket.read(&mut chunk).unwrap();
                assert!(count > 0 && request.len() < 8192);
                request.extend_from_slice(&chunk[..count]);
                if let Some(index) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                    break index + 4;
                }
            };
            let header = String::from_utf8(request[..split].to_vec()).unwrap().to_lowercase();
            assert!(header.starts_with("post /process.process/start http/1.1"));
            assert!(header.contains("e2b-sandbox-id: sandbox-1\r\n"));
            assert!(header.contains("x-access-token: fake-token\r\n"));
            assert!(header.contains("content-type: application/connect+json\r\n"));
            let length: usize = header
                .lines()
                .find_map(|line| line.strip_prefix("content-length: "))
                .unwrap()
                .trim()
                .parse()
                .unwrap();
            while request.len() - split < length {
                let count = socket.read(&mut chunk).unwrap();
                assert!(count > 0);
                request.extend_from_slice(&chunk[..count]);
            }
            let mut body = &request[split..split + length];
            assert_eq!(
                read_connect(&mut body).unwrap(),
                Some(json!({"process": {"cmd": "/bin/bash"}}))
            );
            let reply = encode_connect(&json!({"event": {"start": {"pid": 42}}})).unwrap();
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Type: application/connect+json\r\nContent-Length: {}\r\n\r\n",
                reply.len()
            )
            .unwrap();
            socket.write_all(&reply).unwrap();
        });
        let envd = Envd {
            client: Client::builder().no_proxy().build().unwrap(),
            base,
            sandbox_id: "sandbox-1".into(),
            access_token: "fake-token".into(),
        };
        let mut response = envd.stream("Start", json!({"process": {"cmd": "/bin/bash"}})).unwrap();
        assert_eq!(process_pid(&read_connect(&mut response).unwrap().unwrap()).unwrap(), 42);
        server.join().unwrap();
    }

    #[tokio::test]
    async fn live_contract_only_when_explicitly_enabled() {
        if std::env::var("APHRODY_E2B_LIVE").as_deref() != Ok("1") {
            eprintln!("skipped E2B live conformance: APHRODY_E2B_LIVE is not 1");
            return;
        }
        let config = E2bConfig {
            api_key: std::env::var("E2B_API_KEY").expect("E2B_API_KEY"),
            template_id: std::env::var("E2B_TEMPLATE_ID").expect("E2B_TEMPLATE_ID"),
            lifetime: Duration::from_secs(300),
            limits: HostLimits::default(),
        };
        let mut host = E2bHost::create(config).expect("create E2B sandbox");
        crate::verify_host_contract(&mut host).await.unwrap();
    }
}
