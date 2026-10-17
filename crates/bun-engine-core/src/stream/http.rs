//! GameStream HTTP(S) client: server info, PIN pairing, app list and launch.
//!
//! The client side of Moonshine's `webserver/pairing.rs` and `clients.rs` (BSD-2-Clause,
//! Copyright (c) 2024, Hans Gaiser): the same five pairing steps, AES-128-ECB challenges keyed by
//! SHA-256(salt || PIN), RSA-SHA256 signatures over the secrets and certificate signatures, and the
//! pinned mutual-TLS channel for the paired API.

use std::{
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use aes::{
    Aes128,
    cipher::{BlockDecrypt, BlockEncrypt, KeyInit, generic_array::GenericArray},
};
use ring::{
    rand::{SecureRandom, SystemRandom},
    signature::{RSA_PKCS1_2048_8192_SHA256, RSA_PKCS1_SHA256, RsaKeyPair, UnparsedPublicKey},
};
use rustls::{
    ClientConfig, ClientConnection, DigitallySignedStruct, SignatureScheme, StreamOwned,
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    crypto::{CryptoProvider, WebPkiSupportedAlgorithms},
    pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime},
};

pub const HTTP_PORT: u16 = 47989;
pub const HTTPS_PORT: u16 = 47984;

/// Where the client identity and pinned server certificates live.
pub fn config_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("BUN_STREAM_HOME") {
        return PathBuf::from(dir);
    }
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("bun-engine").join("stream")
}

pub fn random<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    SystemRandom::new().fill(&mut out).expect("system random");
    out
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(text: &str) -> Result<Vec<u8>, String> {
    let text = text.trim();
    if text.len() % 2 != 0 {
        return Err("odd hex length".into());
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).map_err(|e| e.to_string()))
        .collect()
}

fn base64_decode(text: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut acc = 0u32;
    let mut bits = 0;
    for c in text.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            b'\r' | b'\n' | b' ' | b'\t' => continue,
            _ => return Err("bad base64".into()),
        };
        acc = (acc << 6) | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Ok(out)
}

/// DER of the first certificate in a PEM document.
pub fn pem_to_der(pem: &str) -> Result<Vec<u8>, String> {
    let start = pem
        .find("-----BEGIN CERTIFICATE-----")
        .ok_or("no PEM certificate")?
        + 27;
    let end = pem[start..]
        .find("-----END CERTIFICATE-----")
        .ok_or("unterminated PEM")?
        + start;
    base64_decode(&pem[start..end])
}

/// Minimal DER walker: (tag, contents) of the TLVs inside `input`.
fn der_children(input: &[u8]) -> Result<Vec<(u8, &[u8])>, String> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < input.len() {
        let tag = input[i];
        let mut len = *input.get(i + 1).ok_or("truncated DER")? as usize;
        i += 2;
        if len & 0x80 != 0 {
            let n = len & 0x7f;
            if n == 0 || n > 4 || i + n > input.len() {
                return Err("bad DER length".into());
            }
            len = input[i..i + n]
                .iter()
                .fold(0usize, |acc, b| (acc << 8) | *b as usize);
            i += n;
        }
        let body = input.get(i..i + len).ok_or("truncated DER")?;
        out.push((tag, body));
        i += len;
    }
    Ok(out)
}

/// The signature bytes of an X.509 certificate (the GameStream pairing hashes include them).
pub fn certificate_signature(der: &[u8]) -> Result<Vec<u8>, String> {
    let outer = der_children(der)?;
    let cert = der_children(outer.first().ok_or("empty certificate")?.1)?;
    let (_, bits) = cert.get(2).ok_or("certificate without signature")?;
    Ok(bits.get(1..).ok_or("empty signature")?.to_vec())
}

/// The RSAPublicKey DER inside an X.509 certificate.
fn certificate_rsa_key(der: &[u8]) -> Result<Vec<u8>, String> {
    let outer = der_children(der)?;
    let cert = der_children(outer.first().ok_or("empty certificate")?.1)?;
    let tbs = der_children(cert.first().ok_or("no tbsCertificate")?.1)?;
    let skip = usize::from(tbs.first().is_some_and(|(tag, _)| *tag == 0xA0));
    let spki = der_children(tbs.get(skip + 5).ok_or("no subjectPublicKeyInfo")?.1)?;
    let (_, bits) = spki.get(1).ok_or("no subjectPublicKey")?;
    Ok(bits.get(1..).ok_or("empty key")?.to_vec())
}

struct RingRng;

impl rsa::rand_core::RngCore for RingRng {
    fn next_u32(&mut self) -> u32 {
        u32::from_le_bytes(random::<4>())
    }
    fn next_u64(&mut self) -> u64 {
        u64::from_le_bytes(random::<8>())
    }
    fn fill_bytes(&mut self, dest: &mut [u8]) {
        SystemRandom::new().fill(dest).expect("system random");
    }
    fn try_fill_bytes(&mut self, dest: &mut [u8]) -> Result<(), rsa::rand_core::Error> {
        self.fill_bytes(dest);
        Ok(())
    }
}

impl rsa::rand_core::CryptoRng for RingRng {}

/// This client's RSA-2048 key, self-signed certificate and unique id.
pub struct Identity {
    pub unique_id: String,
    pub key_pkcs8: Vec<u8>,
    pub cert_pem: String,
    pub cert_der: Vec<u8>,
}

impl Identity {
    pub fn load_or_create(dir: &Path) -> Result<Self, String> {
        let (key_path, cert_path, id_path) = (
            dir.join("client.key.der"),
            dir.join("client.crt"),
            dir.join("unique-id"),
        );
        if let (Ok(key), Ok(cert), Ok(id)) = (
            std::fs::read(&key_path),
            std::fs::read_to_string(&cert_path),
            std::fs::read_to_string(&id_path),
        ) {
            let der = pem_to_der(&cert)?;
            return Ok(Self {
                unique_id: id.trim().to_string(),
                key_pkcs8: key,
                cert_pem: cert,
                cert_der: der,
            });
        }
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        eprintln!(
            "bun-engine stream: generating the client RSA-2048 identity in {}",
            dir.display()
        );
        use rsa::pkcs8::EncodePrivateKey;
        let key = rsa::RsaPrivateKey::new(&mut RingRng, 2048).map_err(|e| e.to_string())?;
        let key_pkcs8 = key
            .to_pkcs8_der()
            .map_err(|e| e.to_string())?
            .as_bytes()
            .to_vec();
        let pair = rcgen::KeyPair::from_pkcs8_der_and_sign_algo(
            &PrivatePkcs8KeyDer::from(key_pkcs8.clone()),
            &rcgen::PKCS_RSA_SHA256,
        )
        .map_err(|e| e.to_string())?;
        let mut params = rcgen::CertificateParams::default();
        params.distinguished_name = rcgen::DistinguishedName::new();
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, "NVIDIA GameStream Client");
        params.not_before = rcgen::date_time_ymd(2020, 1, 1);
        params.not_after = rcgen::date_time_ymd(2045, 1, 1);
        params.serial_number = Some(rcgen::SerialNumber::from(random::<8>().to_vec()));
        let cert = params.self_signed(&pair).map_err(|e| e.to_string())?;
        let unique_id = hex(&random::<8>()).to_uppercase();
        std::fs::write(&key_path, &key_pkcs8).map_err(|e| e.to_string())?;
        std::fs::write(&cert_path, cert.pem()).map_err(|e| e.to_string())?;
        std::fs::write(&id_path, &unique_id).map_err(|e| e.to_string())?;
        Ok(Self {
            unique_id,
            key_pkcs8,
            cert_pem: cert.pem(),
            cert_der: cert.der().to_vec(),
        })
    }

    fn sign(&self, data: &[u8]) -> Result<Vec<u8>, String> {
        let pair = RsaKeyPair::from_pkcs8(&self.key_pkcs8).map_err(|e| e.to_string())?;
        let mut signature = vec![0u8; pair.public().modulus_len()];
        pair.sign(
            &RSA_PKCS1_SHA256,
            &SystemRandom::new(),
            data,
            &mut signature,
        )
        .map_err(|e| e.to_string())?;
        Ok(signature)
    }
}

/// Accepts exactly the server certificate obtained during pairing.
#[derive(Debug)]
struct Pinned {
    der: Vec<u8>,
    algorithms: WebPkiSupportedAlgorithms,
}

impl ServerCertVerifier for Pinned {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if end_entity.as_ref() == self.der.as_slice() {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General(
                "server certificate differs from the paired one".into(),
            ))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algorithms.supported_schemes()
    }
}

fn tls_config(identity: &Identity, server_der: &[u8]) -> Result<Arc<ClientConfig>, String> {
    let provider: Arc<CryptoProvider> = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = Pinned {
        der: server_der.to_vec(),
        algorithms: provider.signature_verification_algorithms,
    };
    let config = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_client_auth_cert(
            vec![CertificateDer::from(identity.cert_der.clone())],
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(identity.key_pkcs8.clone())),
        )
        .map_err(|e| e.to_string())?;
    Ok(Arc::new(config))
}

/// A GameStream host (Sunshine, Wolf, Moonshine or GeForce Experience).
pub struct GameStreamHost {
    pub address: String,
    pub http_port: u16,
    pub https_port: u16,
    pub server_cert: Option<Vec<u8>>,
    tls: Option<Arc<ClientConfig>>,
}

#[derive(Debug, Default, Clone)]
pub struct ServerInfo {
    pub hostname: String,
    pub app_version: String,
    pub state: String,
    pub current_game: u32,
    pub paired: bool,
    pub codec_support: u32,
}

impl ServerInfo {
    /// Major, minor and build of `appversion` ("7.1.431.-1").
    pub fn version(&self) -> (u32, u32, u32) {
        let mut parts = self
            .app_version
            .split('.')
            .map(|p| p.parse::<i64>().unwrap_or(0).max(0) as u32);
        (
            parts.next().unwrap_or(0),
            parts.next().unwrap_or(0),
            parts.next().unwrap_or(0),
        )
    }
}

pub fn xml(body: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let start = body.find(&open)? + open.len();
    let end = body[start..].find(&format!("</{tag}>"))? + start;
    Some(body[start..end].to_string())
}

fn xml_all(body: &str, tag: &str) -> Vec<String> {
    let (open, close) = (format!("<{tag}>"), format!("</{tag}>"));
    let mut out = Vec::new();
    let mut rest = body;
    while let Some(s) = rest.find(&open) {
        let after = &rest[s + open.len()..];
        let Some(e) = after.find(&close) else { break };
        out.push(after[..e].to_string());
        rest = &after[e + close.len()..];
    }
    out
}

fn check_status(body: &str) -> Result<(), String> {
    if let Some(i) = body.find("status_code=\"") {
        let code = &body[i + 13..];
        let code = &code[..code.find('"').unwrap_or(0)];
        if code != "200" {
            let message = body.find("status_message=\"").map_or("", |j| {
                let m = &body[j + 16..];
                &m[..m.find('"').unwrap_or(0)]
            });
            return Err(format!("server returned {code}: {message}"));
        }
    }
    Ok(())
}

fn read_response(stream: &mut impl Read) -> Result<String, String> {
    let mut raw = Vec::new();
    let _ = stream.read_to_end(&mut raw);
    let text = String::from_utf8_lossy(&raw).into_owned();
    let split = text.find("\r\n\r\n").ok_or("malformed HTTP response")?;
    let (head, body) = (&text[..split], &text[split + 4..]);
    let status = head.lines().next().unwrap_or("");
    if !status.contains(" 200") {
        return Err(format!("HTTP {status}: {}", body.trim()));
    }
    if head
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked")
    {
        let mut out = String::new();
        let mut rest = body;
        while let Some(line_end) = rest.find("\r\n") {
            let size = usize::from_str_radix(rest[..line_end].trim(), 16).unwrap_or(0);
            if size == 0 {
                break;
            }
            let start = line_end + 2;
            out.push_str(rest.get(start..start + size).unwrap_or(""));
            rest = rest.get(start + size + 2..).unwrap_or("");
        }
        return Ok(out);
    }
    Ok(body.to_string())
}

impl GameStreamHost {
    pub fn new(address: &str, identity: &Identity) -> Self {
        let (address, http_port) = match address.rsplit_once(':') {
            Some((a, p)) if !a.contains(':') => (a.to_string(), p.parse().unwrap_or(HTTP_PORT)),
            _ => (address.to_string(), HTTP_PORT),
        };
        let server_cert = std::fs::read(Self::cert_path(&address)).ok();
        let tls = server_cert
            .as_ref()
            .and_then(|der| tls_config(identity, der).ok());
        Self {
            address,
            http_port,
            https_port: http_port.wrapping_sub(5),
            server_cert,
            tls,
        }
    }

    fn cert_path(address: &str) -> PathBuf {
        config_dir()
            .join("hosts")
            .join(format!("{}.der", address.replace([':', '/', '\\'], "_")))
    }

    fn connect(&self, port: u16, timeout: Duration) -> Result<TcpStream, String> {
        let addr = (self.address.as_str(), port)
            .to_socket_addrs()
            .map_err(|e| e.to_string())?
            .next()
            .ok_or("unresolved host")?;
        let stream = TcpStream::connect_timeout(&addr, Duration::from_secs(5))
            .map_err(|e| format!("{addr}: {e}"))?;
        stream.set_read_timeout(Some(timeout)).ok();
        stream.set_nodelay(true).ok();
        Ok(stream)
    }

    fn query(identity: &Identity, path: &str, extra: &str) -> String {
        format!(
            "/{path}?uniqueid={}&uuid={}{extra}",
            identity.unique_id,
            hex(&random::<16>())
        )
    }

    /// Plain HTTP request (pairing and unpaired server info).
    pub fn http(&self, target: &str, timeout: Duration) -> Result<String, String> {
        let mut stream = self.connect(self.http_port, timeout)?;
        write!(
            stream,
            "GET {target} HTTP/1.1\r\nHost: {}:{}\r\nConnection: close\r\n\r\n",
            self.address, self.http_port
        )
        .map_err(|e| e.to_string())?;
        let body = read_response(&mut stream)?;
        check_status(&body)?;
        Ok(body)
    }

    /// Mutual-TLS request pinned to the paired server certificate.
    pub fn https(&self, target: &str, timeout: Duration) -> Result<String, String> {
        let config = self
            .tls
            .clone()
            .ok_or("not paired with this host (run `bun-engine stream --pair <host>`)")?;
        let name = ServerName::try_from(self.address.clone()).map_err(|e| e.to_string())?;
        let connection = ClientConnection::new(config, name).map_err(|e| e.to_string())?;
        let mut tls = StreamOwned::new(connection, self.connect(self.https_port, timeout)?);
        write!(
            tls,
            "GET {target} HTTP/1.1\r\nHost: {}:{}\r\nConnection: close\r\n\r\n",
            self.address, self.https_port
        )
        .map_err(|e| e.to_string())?;
        let body = read_response(&mut tls)?;
        check_status(&body)?;
        Ok(body)
    }

    pub fn server_info(&self, identity: &Identity) -> Result<ServerInfo, String> {
        let target = Self::query(identity, "serverinfo", "");
        let body = if self.tls.is_some() {
            self.https(&target, Duration::from_secs(10))
                .or_else(|_| self.http(&target, Duration::from_secs(10)))?
        } else {
            self.http(&target, Duration::from_secs(10))?
        };
        Ok(ServerInfo {
            hostname: xml(&body, "hostname").unwrap_or_default(),
            app_version: xml(&body, "appversion").unwrap_or_default(),
            state: xml(&body, "state").unwrap_or_default(),
            current_game: xml(&body, "currentgame")
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or(0),
            paired: xml(&body, "PairStatus").is_some_and(|v| v.trim() == "1"),
            codec_support: xml(&body, "ServerCodecModeSupport")
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or(0),
        })
    }

    /// Run the PIN pairing handshake. The owner enters `pin` on the server while step 1 waits.
    pub fn pair(
        &mut self,
        identity: &Identity,
        pin: &str,
        device_name: &str,
    ) -> Result<(), String> {
        let salt = random::<16>();
        let key: [u8; 16] = ring::digest::digest(
            &ring::digest::SHA256,
            &[salt.as_slice(), pin.as_bytes()].concat(),
        )
        .as_ref()[..16]
            .try_into()
            .unwrap();
        let cipher = Aes128::new(GenericArray::from_slice(&key));
        let ecb = |data: &[u8], encrypt: bool| -> Vec<u8> {
            let mut out = data.to_vec();
            for block in out.chunks_mut(16) {
                let block = GenericArray::from_mut_slice(block);
                if encrypt {
                    cipher.encrypt_block(block);
                } else {
                    cipher.decrypt_block(block);
                }
            }
            out
        };
        let base = format!("&devicename={device_name}&updateState=1");
        // 1. Exchange certificates; blocks until the PIN is entered on the server.
        let body = self.http(
            &Self::query(
                identity,
                "pair",
                &format!(
                    "{base}&phrase=getservercert&salt={}&clientcert={}",
                    hex(&salt),
                    hex(identity.cert_pem.as_bytes())
                ),
            ),
            Duration::from_secs(300),
        )?;
        if xml(&body, "paired").as_deref() != Some("1") {
            return Err("pairing refused at getservercert".into());
        }
        let server_pem = String::from_utf8(unhex(
            &xml(&body, "plaincert").ok_or("no server certificate")?,
        )?)
        .map_err(|e| e.to_string())?;
        let server_der = pem_to_der(&server_pem)?;
        // 2. Client challenge.
        let client_challenge = random::<16>();
        let body = self.http(
            &Self::query(
                identity,
                "pair",
                &format!(
                    "{base}&clientchallenge={}",
                    hex(&ecb(&client_challenge, true))
                ),
            ),
            Duration::from_secs(30),
        )?;
        let response = ecb(
            &unhex(&xml(&body, "challengeresponse").ok_or("no challenge response")?)?,
            false,
        );
        if response.len() < 48 {
            return Err("short challenge response".into());
        }
        let (server_hash, server_challenge) = (&response[..32], &response[32..48]);
        // 3. Answer the server challenge.
        let client_secret = random::<16>();
        let client_hash = ring::digest::digest(
            &ring::digest::SHA256,
            &[
                server_challenge,
                &certificate_signature(&identity.cert_der)?,
                &client_secret,
            ]
            .concat(),
        );
        let body = self.http(
            &Self::query(
                identity,
                "pair",
                &format!(
                    "{base}&serverchallengeresp={}",
                    hex(&ecb(client_hash.as_ref(), true))
                ),
            ),
            Duration::from_secs(30),
        )?;
        let pairing = unhex(&xml(&body, "pairingsecret").ok_or("no pairing secret")?)?;
        if pairing.len() < 16 + 256 {
            return Err("short pairing secret".into());
        }
        let (server_secret, server_signature) = pairing.split_at(16);
        // The server proves it holds the certificate's key ...
        UnparsedPublicKey::new(
            &RSA_PKCS1_2048_8192_SHA256,
            certificate_rsa_key(&server_der)?,
        )
        .verify(server_secret, server_signature)
        .map_err(|_| "server signature mismatch: possible man-in-the-middle")?;
        // ... and knew the PIN.
        let expected = ring::digest::digest(
            &ring::digest::SHA256,
            &[
                client_challenge.as_slice(),
                &certificate_signature(&server_der)?,
                server_secret,
            ]
            .concat(),
        );
        if expected.as_ref() != server_hash {
            return Err("wrong PIN".into());
        }
        // 4. Send our signed secret.
        let mut client_pairing = client_secret.to_vec();
        client_pairing.extend(identity.sign(&client_secret)?);
        let body = self.http(
            &Self::query(
                identity,
                "pair",
                &format!("{base}&clientpairingsecret={}", hex(&client_pairing)),
            ),
            Duration::from_secs(30),
        )?;
        if xml(&body, "paired").as_deref() != Some("1") {
            return Err("pairing refused at clientpairingsecret".into());
        }
        // 5. Pair challenge over the pinned TLS channel.
        self.tls = Some(tls_config(identity, &server_der)?);
        let body = self.https(
            &Self::query(identity, "pair", &format!("{base}&phrase=pairchallenge")),
            Duration::from_secs(30),
        )?;
        if xml(&body, "paired").as_deref() != Some("1") {
            self.tls = None;
            return Err("pairing refused at pairchallenge".into());
        }
        let path = Self::cert_path(&self.address);
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::write(&path, &server_der).map_err(|e| e.to_string())?;
        self.server_cert = Some(server_der);
        Ok(())
    }

    /// (title, id) of every app the host offers.
    pub fn apps(&self, identity: &Identity) -> Result<Vec<(String, u32)>, String> {
        let body = self.https(
            &Self::query(identity, "applist", ""),
            Duration::from_secs(10),
        )?;
        Ok(xml_all(&body, "App")
            .iter()
            .filter_map(|app| Some((xml(app, "AppTitle")?, xml(app, "ID")?.trim().parse().ok()?)))
            .collect())
    }

    /// Launch (or resume) `app_id`; returns the RTSP session URL.
    #[allow(clippy::too_many_arguments)]
    pub fn launch(
        &self,
        identity: &Identity,
        info: &ServerInfo,
        app_id: u32,
        mode: (u32, u32, u32),
        rikey: &[u8; 16],
        rikey_id: i32,
    ) -> Result<String, String> {
        let resume = info.current_game != 0;
        let verb = if resume { "resume" } else { "launch" };
        let extra = format!(
            "&appid={app_id}&mode={}x{}x{}&additionalStates=1&sops=0&rikey={}&rikeyid={rikey_id}&localAudioPlayMode=0&surroundAudioInfo=196610&remoteControllersBitmap=15&gcmap=15&gcpersist=0",
            mode.0,
            mode.1,
            mode.2,
            hex(rikey)
        );
        let body = self.https(
            &Self::query(identity, verb, &extra),
            Duration::from_secs(120),
        )?;
        if xml(&body, "gamesession")
            .or_else(|| xml(&body, "resume"))
            .as_deref()
            .is_some_and(|v| v.trim() == "0")
        {
            return Err(format!("{verb} refused"));
        }
        Ok(xml(&body, "sessionUrl0").unwrap_or_else(|| format!("rtsp://{}:48010", self.address)))
    }

    /// Stop the running app on the host.
    pub fn cancel(&self, identity: &Identity) -> Result<(), String> {
        self.https(
            &Self::query(identity, "cancel", ""),
            Duration::from_secs(10),
        )
        .map(|_| ())
    }
}
