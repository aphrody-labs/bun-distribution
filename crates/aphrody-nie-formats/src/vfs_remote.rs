//! Bounded HTTP Range and native SFTP reads; a worker keeps blocking I/O out of caller runtimes.
use crate::FormatError;
use aphrody_ssh::in_process::{HostConfig, SftpDriver};
use reqwest::Url;
use std::io::Read;
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
    mpsc,
};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

const MAX_READ: usize = 256 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(30);
type Result<T> = std::result::Result<T, String>;

enum Request {
    Read { path: String, range: Option<(u64, usize)>, reply: mpsc::Sender<Result<Vec<u8>>> },
    List { path: String, reply: mpsc::Sender<Result<Vec<String>>> },
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Write, net::TcpListener, sync::atomic::AtomicBool};

    struct Server {
        source: String,
        stop: Arc<AtomicBool>,
        thread: Option<std::thread::JoinHandle<()>>,
    }
    impl Server {
        fn start(
            ignore_range: bool,
            wrong_range: bool,
            bad_encoding: bool,
            files: Option<std::collections::HashMap<String, Vec<u8>>>,
        ) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let stop = Arc::new(AtomicBool::new(false));
            let flag = stop.clone();
            let thread = std::thread::spawn(move || {
                for connection in listener.incoming() {
                    if flag.load(Ordering::Relaxed) {
                        break;
                    }
                    let mut stream = connection.unwrap();
                    stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                    let mut bytes = Vec::new();
                    while !bytes.ends_with(b"\r\n\r\n") {
                        let mut buffer = [0; 1024];
                        let size = stream.read(&mut buffer).unwrap();
                        if size == 0 {
                            break;
                        }
                        bytes.extend_from_slice(&buffer[..size]);
                    }
                    let request = String::from_utf8_lossy(&bytes);
                    let range = request.lines().find_map(|line| {
                        line.to_ascii_lowercase().strip_prefix("range: bytes=").map(str::to_owned)
                    });
                    let path = request.lines().next().unwrap().split_whitespace().nth(1).unwrap();
                    let payload = if let Some(files) = &files {
                        let Some(payload) = files.get(path) else {
                            stream.write_all(b"HTTP/1.1 404 Missing\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
                            continue;
                        };
                        payload.as_slice()
                    } else {
                        b"0123456789".as_slice()
                    };
                    let (status, content_range, body) =
                        if let Some(range) = range.filter(|_| !ignore_range) {
                            let (start, end) = range.split_once('-').unwrap();
                            let start: usize = start.parse().unwrap();
                            let end: usize = end.parse().unwrap();
                            (
                                206,
                                format!(
                                    "Content-Range: bytes {}-{end}/{}\r\n",
                                    if wrong_range { start + 1 } else { start },
                                    payload.len()
                                ),
                                &payload[start..=end],
                            )
                        } else {
                            (200, String::new(), payload)
                        };
                    let encoding = if bad_encoding { "Content-Encoding: gzip\r\n" } else { "" };
                    write!(stream, "HTTP/1.1 {status} OK\r\n{content_range}{encoding}Content-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
                    stream.write_all(body).unwrap();
                }
            });
            Self { source: format!("http://{address}/"), stop, thread: Some(thread) }
        }
    }
    impl Drop for Server {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Relaxed);
            let _ = std::net::TcpStream::connect(
                self.source.trim_start_matches("http://").trim_end_matches('/'),
            );
            self.thread.take().unwrap().join().unwrap();
        }
    }

    #[test]
    fn http_requires_exact_ranges_and_returns_requested_bytes() {
        for (ignore, wrong, encoding) in [
            (false, false, false),
            (true, false, false),
            (false, true, false),
            (false, false, true),
        ] {
            let server = Server::start(ignore, wrong, encoding, None);
            let storage = RemoteStorage::connect(&server.source).unwrap();
            let result = storage.range("packs/resource.cpk", 3, 4);
            if ignore || wrong || encoding {
                assert!(result.is_err());
            } else {
                assert_eq!(result.unwrap(), b"3456");
                assert_eq!(storage.stats(), (1, 4));
            }
            assert!(storage.range("../secret", 0, 1).is_err());
            assert!(storage.range("large", 0, MAX_READ + 1).is_err());
        }
    }

    #[test]
    fn remote_mount_includes_extra_archives_without_fetching_archive_bodies() {
        use crate::{
            cfgbin::{CfgEntry, Value},
            cpk_encode::{CpkWriteEntry, encode_cpk},
        };
        let primary = encode_cpk(&[
            CpkWriteEntry {
                filename: "tiny.bin".into(),
                directory: "data/common".into(),
                data: b"abc".to_vec(),
            },
            CpkWriteEntry {
                filename: "large.bin".into(),
                directory: "data/common".into(),
                data: vec![9; 2 * 1024 * 1024],
            },
        ])
        .unwrap();
        let extra = encode_cpk(&[CpkWriteEntry {
            filename: "extra.bin".into(),
            directory: "data/common".into(),
            data: b"extra".to_vec(),
        }])
        .unwrap();
        let mut index = crate::cfgbin::encode_t2b(&[CfgEntry {
            name: "PACKS_BEG".into(),
            variables: vec![],
            children: vec![CfgEntry {
                name: "FILE".into(),
                children: vec![],
                variables: vec![
                    Value::String("data/common/".into()),
                    Value::String("tiny.bin".into()),
                    Value::Int(0),
                    Value::String("fixture.cpk".into()),
                    Value::Int(3),
                ],
            }],
        }]);
        crate::cpk::decrypt_block(&mut index, 0, crate::cpk::VIOLA_FIXED_KEY);
        let files: std::collections::HashMap<String, Vec<u8>> = [
            ("/data/cpk_list.cfg.bin".into(), index),
            (
                "/data/packs/".into(),
                b"<a href=\"fixture.cpk\">pack</a><a href=\"extra.cpk\">extra</a>".to_vec(),
            ),
            ("/data/packs/fixture.cpk".into(), primary),
            ("/data/packs/extra.cpk".into(), extra),
        ]
        .into_iter()
        .collect();
        // Optional private fixture staging for a real configured SSH server; never game input.
        if let Some(out) = std::env::var_os("NIE_REMOTE_FIXTURE_OUT") {
            let out = std::path::PathBuf::from(out);
            std::fs::create_dir(&out).expect("fixture output must not already exist");
            std::fs::create_dir_all(out.join("data/packs")).unwrap();
            for (name, bytes) in &files {
                if !name.ends_with('/') {
                    std::fs::write(out.join(name.trim_start_matches('/')), bytes).unwrap();
                }
            }
        }
        let mut missing = files.clone();
        missing.insert("/data/packs/".into(), Vec::new());
        let incomplete = Server::start(false, false, false, Some(missing));
        assert!(crate::vfs::Vfs::new().init_source(&incomplete.source).is_err());
        let server = Server::start(false, false, false, Some(files));
        let mut vfs = crate::vfs::Vfs::new();
        vfs.init_source(&server.source).unwrap();
        assert_eq!(vfs.asset_count(), 2);
        assert_eq!(vfs.cpk_count(), 2);
        assert_eq!(vfs.read("data/common/tiny.bin").unwrap(), b"abc");
        assert_eq!(vfs.read("data/common/extra.bin").unwrap(), b"extra");
        assert!(vfs.remote_stats().unwrap().1 < 4096);
        assert!(vfs.cache_stats().octets < 4096, "metadata cached, not the 2 MiB pack");
    }

    #[test]
    fn uri_credentials_are_rejected_before_connecting() {
        for uri in [
            "https://user:secret@example.test/game",
            "ssh://user:secret@example.test/game",
            "https://example.test/game?token=secret",
        ] {
            assert!(RemoteStorage::connect(uri).is_err());
            assert!(crate::game_source::resolve(Some(uri)).is_err());
        }
    }
}

#[derive(Clone)]
pub(crate) struct RemoteStorage {
    worker: Arc<Worker>,
    bytes: Arc<AtomicU64>,
    calls: Arc<AtomicU64>,
}

struct Worker {
    sender: Option<mpsc::Sender<Request>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Drop for Worker {
    fn drop(&mut self) {
        // Finish native code before an FFI caller can unload its library.
        self.sender.take();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl RemoteStorage {
    pub fn connect(source: &str) -> std::result::Result<Self, FormatError> {
        let mut url =
            Url::parse(source).map_err(|_| FormatError::Corrupt("invalid game source URI"))?;
        if url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || (matches!(url.scheme(), "http" | "https") && !url.username().is_empty())
        {
            return Err(FormatError::Corrupt(
                "URI credentials/query/fragment are unsupported; use SSH config or NIE_HTTP_AUTH_TOKEN",
            ));
        }
        if url.path().ends_with("/nie.exe") {
            let root_path = url.path().trim_end_matches("/nie.exe").to_owned();
            url.set_path(&root_path);
        }
        if !url.path().ends_with('/') {
            url.set_path(&format!("{}/", url.path()));
        }
        let (sender, receiver) = mpsc::channel();
        let (ready, start) = mpsc::channel();
        let bytes = Arc::new(AtomicU64::new(0));
        let calls = Arc::new(AtomicU64::new(0));
        let worker_bytes = bytes.clone();
        let worker_calls = calls.clone();
        let thread = std::thread::Builder::new()
            .name("nie-vfs-remote".into())
            .spawn(move || {
                let mut backend = match Backend::connect(url) {
                    Ok(backend) => {
                        let _ = ready.send(Ok(()));
                        backend
                    },
                    Err(error) => {
                        let _ = ready.send(Err(error));
                        return;
                    },
                };
                while let Ok(request) = receiver.recv() {
                    worker_calls.fetch_add(1, Ordering::Relaxed);
                    match request {
                        Request::Read { path, range, reply } => {
                            let result = backend.read(&path, range);
                            if let Ok(data) = &result {
                                worker_bytes.fetch_add(data.len() as u64, Ordering::Relaxed);
                            }
                            let _ = reply.send(result);
                        },
                        Request::List { path, reply } => {
                            let _ = reply.send(backend.list(&path));
                        },
                    }
                }
            })
            .map_err(|e| FormatError::Malformed(e.to_string()))?;
        let worker = Arc::new(Worker { sender: Some(sender), thread: Some(thread) });
        start
            .recv_timeout(TIMEOUT)
            .map_err(|_| FormatError::Corrupt("remote VFS connection timed out"))?
            .map_err(FormatError::Malformed)?;
        Ok(Self { worker, bytes, calls })
    }

    pub fn read(&self, path: &str) -> std::result::Result<Vec<u8>, FormatError> {
        self.read_inner(path, None)
    }
    pub fn range(
        &self,
        path: &str,
        offset: u64,
        length: usize,
    ) -> std::result::Result<Vec<u8>, FormatError> {
        if length == 0 {
            return Ok(Vec::new());
        }
        if length > MAX_READ || offset.checked_add(length as u64).is_none() {
            return Err(FormatError::Corrupt("remote read exceeds 256 MiB or offset space"));
        }
        self.read_inner(path, Some((offset, length)))
    }
    fn read_inner(
        &self,
        path: &str,
        range: Option<(u64, usize)>,
    ) -> std::result::Result<Vec<u8>, FormatError> {
        validate_path(path)?;
        let (reply, result) = mpsc::channel();
        self.worker
            .sender
            .as_ref()
            .ok_or(FormatError::Corrupt("remote VFS worker stopped"))?
            .send(Request::Read { path: path.into(), range, reply })
            .map_err(|_| FormatError::Corrupt("remote VFS worker stopped"))?;
        result
            .recv_timeout(TIMEOUT + Duration::from_secs(1))
            .map_err(|_| FormatError::Corrupt("remote VFS read timed out"))?
            .map_err(FormatError::Malformed)
    }
    pub fn list(&self, path: &str) -> std::result::Result<Vec<String>, FormatError> {
        validate_path(path)?;
        let (reply, result) = mpsc::channel();
        self.worker
            .sender
            .as_ref()
            .ok_or(FormatError::Corrupt("remote VFS worker stopped"))?
            .send(Request::List { path: path.into(), reply })
            .map_err(|_| FormatError::Corrupt("remote VFS worker stopped"))?;
        result
            .recv_timeout(TIMEOUT + Duration::from_secs(1))
            .map_err(|_| FormatError::Corrupt("remote directory read timed out"))?
            .map_err(FormatError::Malformed)
    }
    pub fn stats(&self) -> (u64, u64) {
        (self.calls.load(Ordering::Relaxed), self.bytes.load(Ordering::Relaxed))
    }
}

fn validate_path(path: &str) -> std::result::Result<(), FormatError> {
    if path.starts_with('/')
        || path.contains(['\\', '\0'])
        || path.split('/').any(|s| s == ".." || s == ".")
    {
        return Err(FormatError::Corrupt(
            "remote resource must be a relative path without traversal",
        ));
    }
    Ok(())
}

struct VerifiedHost {
    host: String,
    alias: String,
    port: u16,
}
impl russh::client::Handler for VerifiedHost {
    type Error = russh::Error;
    async fn check_server_key(
        &mut self,
        key: &russh::keys::PublicKeyOrCertificate,
    ) -> std::result::Result<bool, Self::Error> {
        let check = |host: &str| {
            if let Some(path) = std::env::var_os("NIE_SSH_KNOWN_HOSTS") {
                russh::keys::check_known_hosts_path(host, self.port, &key.public_key(), path)
            } else {
                russh::keys::check_known_hosts(host, self.port, &key.public_key())
            }
        };
        Ok(match check(&self.host) {
            Ok(true) => true,
            Ok(false) => check(&self.alias).unwrap_or(false),
            Err(_) => false,
        })
    }
}

enum Backend {
    Http {
        client: reqwest::blocking::Client,
        base: Url,
        token: Option<String>,
    },
    Sftp {
        runtime: tokio::runtime::Runtime,
        session: russh_sftp::client::SftpSession,
        _connection: russh::client::Handle<VerifiedHost>,
        root: String,
    },
}

impl Backend {
    fn connect(url: Url) -> Result<Self> {
        if matches!(url.scheme(), "http" | "https") {
            let client = reqwest::blocking::Client::builder()
                .timeout(TIMEOUT)
                .no_gzip()
                .no_brotli()
                .no_deflate()
                .no_zstd()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|e| e.without_url().to_string())?;
            return Ok(Self::Http {
                client,
                base: url,
                token: std::env::var("NIE_HTTP_AUTH_TOKEN").ok(),
            });
        }
        let alias = url.host_str().ok_or("SSH alias required")?;
        let mut config = HostConfig::resolve(alias).map_err(|e| e.to_string())?;
        if let Some(port) = url.port() {
            config.port = port;
        }
        if !url.username().is_empty() {
            config.user = percent_encoding::percent_decode_str(url.username())
                .decode_utf8()
                .map_err(|e| e.to_string())?
                .into_owned();
        }
        let root = percent_encoding::percent_decode_str(url.path())
            .decode_utf8()
            .map_err(|e| e.to_string())?
            .into_owned();
        if root.contains('\0') {
            return Err("invalid SFTP root".into());
        }
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .map_err(|e| e.to_string())?;
        let (connection, session) = runtime.block_on(async {
            tokio::time::timeout(TIMEOUT, async {
                let key = russh::keys::load_secret_key(
                    &config.identity_path,
                    std::env::var("NIE_SSH_KEY_PASSPHRASE").ok().as_deref(),
                )
                .map_err(|e| e.to_string())?;
                let handler = VerifiedHost {
                    host: config.hostname.clone(),
                    alias: alias.into(),
                    port: config.port,
                };
                let client_config =
                    russh::client::Config { inactivity_timeout: None, ..Default::default() };
                let mut connection = russh::client::connect(
                    Arc::new(client_config),
                    (config.hostname.as_str(), config.port),
                    handler,
                )
                .await
                .map_err(|e| format!("SSH connection/known_hosts verification: {e}"))?;
                let hash = connection
                    .best_supported_rsa_hash()
                    .await
                    .map_err(|e| e.to_string())?
                    .flatten();
                if !connection
                    .authenticate_publickey(
                        &config.user,
                        russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                    )
                    .await
                    .map_err(|e| e.to_string())?
                    .success()
                {
                    return Err("SSH public-key authentication rejected".to_owned());
                }
                let channel = connection.channel_open_session().await.map_err(|e| e.to_string())?;
                channel.request_subsystem(true, "sftp").await.map_err(|e| e.to_string())?;
                let session = russh_sftp::client::SftpSession::new(channel.into_stream())
                    .await
                    .map_err(|e| e.to_string())?;
                Ok((connection, session))
            })
            .await
            .map_err(|_| "SSH connect timeout".to_owned())?
        })?;
        Ok(Self::Sftp { runtime, session, _connection: connection, root })
    }

    fn read(&mut self, path: &str, range: Option<(u64, usize)>) -> Result<Vec<u8>> {
        match self {
            Self::Http { client, base, token } => {
                let mut target = base.clone();
                {
                    let mut segments =
                        target.path_segments_mut().map_err(|_| "invalid HTTP base")?;
                    segments.pop_if_empty();
                    for part in path.split('/') {
                        segments.push(part);
                    }
                }
                let mut request =
                    client.get(target).header(reqwest::header::ACCEPT_ENCODING, "identity");
                if let Some(token) = token {
                    request = request.bearer_auth(token);
                }
                if let Some((offset, size)) = range {
                    request = request.header(
                        reqwest::header::RANGE,
                        format!("bytes={offset}-{}", offset + size as u64 - 1),
                    );
                }
                let response = request.send().map_err(|e| e.without_url().to_string())?;
                if let Some((offset, size)) = range {
                    if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
                        return Err("HTTP server must support byte ranges (206)".into());
                    }
                    let header = response
                        .headers()
                        .get(reqwest::header::CONTENT_RANGE)
                        .and_then(|h| h.to_str().ok())
                        .ok_or("HTTP Content-Range required")?;
                    let expected = format!("bytes {offset}-{}/", offset + size as u64 - 1);
                    if !header.strip_prefix(&expected).is_some_and(|total| {
                        total.parse::<u64>().is_ok_and(|n| n >= offset + size as u64)
                    }) {
                        return Err("HTTP Content-Range does not match requested bytes".into());
                    }
                } else if !response.status().is_success() {
                    return Err(format!("HTTP status {}", response.status().as_u16()));
                }
                if response
                    .headers()
                    .get(reqwest::header::CONTENT_ENCODING)
                    .is_some_and(|h| h != "identity")
                {
                    return Err("HTTP resource encoding must be identity".into());
                }
                let bound = range.map_or(
                    if path.is_empty() || path.ends_with('/') { 4 * 1024 * 1024 } else { MAX_READ },
                    |(_, length)| length,
                );
                if response.content_length().is_some_and(|n| n > bound as u64) {
                    return Err("HTTP response exceeds requested budget".into());
                }
                let mut data = Vec::new();
                response
                    .take(bound as u64 + 1)
                    .read_to_end(&mut data)
                    .map_err(|e| e.to_string())?;
                if data.len() > bound || range.is_some_and(|(_, n)| data.len() != n) {
                    return Err("HTTP response is oversized or truncated".into());
                }
                Ok(data)
            },
            Self::Sftp { runtime, session, root, .. } => runtime.block_on(async {
                tokio::time::timeout(TIMEOUT, async {
                    let path = format!("{root}{path}");
                    let (offset, length) = if let Some(range) = range {
                        range
                    } else {
                        let size =
                            SftpDriver::stat(session, &path).await.map_err(|e| e.to_string())?.size;
                        if size > MAX_READ as u64 {
                            return Err("SFTP resource exceeds 256 MiB read budget".into());
                        }
                        (0, size as usize)
                    };
                    let mut file = session.open(path).await.map_err(|e| e.to_string())?;
                    file.seek(std::io::SeekFrom::Start(offset)).await.map_err(|e| e.to_string())?;
                    let mut data = vec![0; length];
                    file.read_exact(&mut data).await.map_err(|e| e.to_string())?;
                    file.shutdown().await.map_err(|e| e.to_string())?;
                    Ok(data)
                })
                .await
                .map_err(|_| "SFTP read timeout".to_owned())?
            }),
        }
    }

    fn list(&mut self, path: &str) -> Result<Vec<String>> {
        match self {
            Self::Http { base, .. } => {
                let base = base.clone();
                let bytes = self.read(path, None)?;
                if bytes.len() > 4 * 1024 * 1024 {
                    return Err("HTTP directory listing exceeds 4 MiB".into());
                }
                let text = std::str::from_utf8(&bytes).map_err(|e| e.to_string())?;
                let selector = scraper::Selector::parse("a[href]").map_err(|e| e.to_string())?;
                let directory = base.join(path).map_err(|e| e.to_string())?;
                let mut names = Vec::new();
                for anchor in scraper::Html::parse_document(text).select(&selector) {
                    let Some(href) = anchor.value().attr("href") else {
                        continue;
                    };
                    let Ok(url) = directory.join(href) else {
                        continue;
                    };
                    if url.origin() != directory.origin()
                        || url.query().is_some()
                        || url.fragment().is_some()
                    {
                        continue;
                    }
                    let Some(name) = url.path().strip_prefix(directory.path()) else {
                        continue;
                    };
                    let decoded = percent_encoding::percent_decode_str(name)
                        .decode_utf8()
                        .map_err(|e| e.to_string())?
                        .into_owned();
                    if !decoded.is_empty()
                        && !decoded.trim_end_matches('/').contains('/')
                        && validate_path(&decoded).is_ok()
                    {
                        names.push(decoded);
                    }
                }
                names.sort();
                names.dedup();
                Ok(names)
            },
            Self::Sftp { runtime, session, root, .. } => runtime.block_on(async {
                tokio::time::timeout(
                    TIMEOUT,
                    SftpDriver::read_dir(session, &format!("{root}{path}")),
                )
                .await
                .map_err(|_| "SFTP listing timeout".to_owned())?
                .map(|items| {
                    items
                        .into_iter()
                        .map(|i| if i.is_dir { format!("{}/", i.name) } else { i.name })
                        .collect()
                })
                .map_err(|e| e.to_string())
            }),
        }
    }
}
