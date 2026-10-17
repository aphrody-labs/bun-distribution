//! Open-source BIOS and firmware loading shared by native hosts and the WebAssembly build.
//!
//! The registry is `packages/bun-engine/plugins/consoles/free-firmware.json` (embedded at build
//! time): only open-source replacements are listed, each with its size and SHA-256/SHA-512 digests.
//! Bytes arrive as a stream of chunks (a file, a `fetch` body or an OPFS read); [`FirmwareStream`]
//! detects gzip or Zstandard framing, decompresses incrementally, hashes the decoded payload and
//! checks it against the registry before the machine sees it. Proprietary dumps are never listed;
//! a user-supplied file goes through [`FirmwareStream::user`], which bounds its size and reports
//! its digests without comparing them to anything.

use std::fmt;

use miniz_oxide::inflate::stream::{InflateState, inflate};
use miniz_oxide::{DataFormat, MZFlush, MZStatus};
use sha2::{Digest, Sha256, Sha512};

/// The embedded open-source firmware registry.
pub const REGISTRY_JSON: &str =
    include_str!("../../../packages/bun-engine/plugins/consoles/free-firmware.json");

/// Firmware images are small; anything larger is rejected before it is buffered.
pub const MAX_FIRMWARE_BYTES: usize = 128 * 1024 * 1024;

/// One open-source firmware component from the registry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Component {
    pub id: String,
    /// bun-engine console id (`sony-playstation`, `nintendo-game-boy-advance`, ...).
    pub console: String,
    pub file: String,
    pub size: Option<usize>,
    pub sha256: Option<String>,
    pub sha512: Option<String>,
    pub url: Option<String>,
    pub license: String,
}

/// Every component of the embedded registry.
///
/// # Panics
/// Never for the embedded file, which is checked by the crate's tests.
#[must_use]
pub fn registry() -> Vec<Component> {
    parse_registry(REGISTRY_JSON).expect("embedded free-firmware.json is valid")
}

/// Parse a `free-firmware.json` document.
///
/// # Errors
/// Returns a message when the document is not a valid registry.
pub fn parse_registry(json: &str) -> Result<Vec<Component>, String> {
    let root: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let entries = root
        .get("firmware")
        .and_then(serde_json::Value::as_object)
        .ok_or("free-firmware.json has no `firmware` object")?;
    let text = |v: &serde_json::Value, key: &str| v.get(key).and_then(|s| s.as_str()).map(str::to_owned);
    entries
        .iter()
        .map(|(id, v)| {
            Ok(Component {
                id: id.clone(),
                console: text(v, "console").ok_or_else(|| format!("{id}: missing console"))?,
                file: text(v, "file").ok_or_else(|| format!("{id}: missing file"))?,
                size: v.get("size").and_then(serde_json::Value::as_u64).map(|n| n as usize),
                sha256: text(v, "sha256"),
                sha512: text(v, "sha512"),
                url: text(v, "url"),
                license: text(v, "license").unwrap_or_default(),
            })
        })
        .collect()
}

/// The registry component `id`.
///
/// # Errors
/// [`FirmwareError::Unknown`] when the registry has no such component.
pub fn component(id: &str) -> Result<Component, FirmwareError> {
    registry().into_iter().find(|c| c.id == id).ok_or_else(|| FirmwareError::Unknown(id.to_owned()))
}

/// The open-source components that can boot `console`, in registry order.
#[must_use]
pub fn for_console(console: &str) -> Vec<Component> {
    registry().into_iter().filter(|c| c.console == console).collect()
}

/// Why firmware could not be used. Every variant names the component.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FirmwareError {
    /// The registry has no component with this id.
    Unknown(String),
    /// The machine needs a component that was not supplied.
    Missing { component: String, console: String, file: String },
    /// The decoded payload does not match the registry digest.
    Integrity { component: String, algorithm: &'static str, expected: String, actual: String },
    /// The decoded payload has the wrong size.
    Size { component: String, expected: usize, actual: usize },
    /// The compressed stream is malformed or truncated.
    Decode { component: String, reason: String },
}

impl fmt::Display for FirmwareError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unknown(id) => write!(f, "firmware `{id}` is not in the open-source registry"),
            Self::Missing { component, console, file } => write!(
                f,
                "{console} needs the open-source firmware `{component}` ({file}); fetch it with \
                 `bep add free-firmware {component}` or supply your own dump"
            ),
            Self::Integrity { component, algorithm, expected, actual } => write!(
                f,
                "firmware `{component}`: {algorithm} {actual} does not match the registry ({expected})"
            ),
            Self::Size { component, expected, actual } => {
                write!(f, "firmware `{component}`: {actual} bytes, the registry lists {expected}")
            }
            Self::Decode { component, reason } => write!(f, "firmware `{component}`: {reason}"),
        }
    }
}

impl std::error::Error for FirmwareError {}

/// Verified firmware bytes.
#[derive(Clone, Debug)]
pub struct Firmware {
    pub component: String,
    pub bytes: Vec<u8>,
    pub sha256: String,
    pub sha512: String,
}

enum Codec {
    /// Waiting for enough bytes to recognise the framing.
    Sniff,
    Raw,
    Gzip { header_done: bool, state: Box<InflateState> },
    Zstd(Box<ruzstd::decoding::FrameDecoder>),
}

/// Incremental decoder and verifier: `push` chunks as they arrive, then `finish`.
pub struct FirmwareStream {
    expected: Option<Component>,
    name: String,
    codec: Codec,
    pending: Vec<u8>,
    out: Vec<u8>,
    sha256: Sha256,
    sha512: Sha512,
    hashed: usize,
}

impl FirmwareStream {
    /// A stream checked against registry component `id`.
    ///
    /// # Errors
    /// [`FirmwareError::Unknown`] when `id` is not in the registry.
    pub fn registered(id: &str) -> Result<Self, FirmwareError> {
        let expected = component(id)?;
        Ok(Self::new(expected.id.clone(), Some(expected)))
    }

    /// A user-supplied file: decoded and hashed, never compared or uploaded.
    #[must_use]
    pub fn user(name: &str) -> Self {
        Self::new(name.to_owned(), None)
    }

    fn new(name: String, expected: Option<Component>) -> Self {
        Self {
            expected,
            name,
            codec: Codec::Sniff,
            pending: Vec::new(),
            out: Vec::new(),
            sha256: Sha256::new(),
            sha512: Sha512::new(),
            hashed: 0,
        }
    }

    fn decode_error(&self, reason: impl Into<String>) -> FirmwareError {
        FirmwareError::Decode { component: self.name.clone(), reason: reason.into() }
    }

    /// Feed the next chunk of the (possibly compressed) file.
    ///
    /// # Errors
    /// A decode error or a payload larger than [`MAX_FIRMWARE_BYTES`].
    pub fn push(&mut self, chunk: &[u8]) -> Result<(), FirmwareError> {
        self.pending.extend_from_slice(chunk);
        self.pump(false)
    }

    fn pump(&mut self, end: bool) -> Result<(), FirmwareError> {
        if matches!(self.codec, Codec::Sniff) {
            if self.pending.len() < 4 && !end {
                return Ok(());
            }
            self.codec = match self.pending.get(..4) {
                Some([0x1f, 0x8b, ..]) => Codec::Gzip {
                    header_done: false,
                    state: InflateState::new_boxed(DataFormat::Raw),
                },
                Some([0x28, 0xb5, 0x2f, 0xfd]) => {
                    Codec::Zstd(Box::new(ruzstd::decoding::FrameDecoder::new()))
                }
                _ => Codec::Raw,
            };
        }
        match self.codec {
            Codec::Sniff => unreachable!(),
            Codec::Raw => {
                let data = std::mem::take(&mut self.pending);
                self.emit(&data)?;
            }
            Codec::Gzip { .. } => self.pump_gzip(end)?,
            Codec::Zstd(_) => self.pump_zstd(end)?,
        }
        Ok(())
    }

    fn pump_gzip(&mut self, end: bool) -> Result<(), FirmwareError> {
        let Codec::Gzip { header_done, .. } = &mut self.codec else { unreachable!() };
        if !*header_done {
            match gzip_header_len(&self.pending) {
                Some(len) => {
                    *header_done = true;
                    self.pending.drain(..len);
                }
                None if end => return Err(self.decode_error("truncated gzip header")),
                None => return Ok(()),
            }
        }
        let mut buf = vec![0_u8; 64 * 1024];
        loop {
            let Codec::Gzip { state, .. } = &mut self.codec else { unreachable!() };
            let flush = if end { MZFlush::Finish } else { MZFlush::None };
            let result = inflate(state, &self.pending, &mut buf, flush);
            self.pending.drain(..result.bytes_consumed);
            let (consumed, produced) = (result.bytes_consumed, result.bytes_written);
            self.emit(&buf[..produced])?;
            match result.status {
                Ok(MZStatus::StreamEnd) => {
                    // The 8-byte gzip trailer (CRC32, ISIZE) follows; the digests cover the
                    // payload, so the trailer is dropped.
                    self.pending.clear();
                    return Ok(());
                }
                Ok(_) if produced == 0 && consumed == 0 => {
                    return if end { Err(self.decode_error("truncated deflate stream")) } else { Ok(()) };
                }
                Ok(_) => {}
                Err(miniz_oxide::MZError::Buf) if produced == 0 && !end => return Ok(()),
                Err(e) => return Err(self.decode_error(format!("deflate: {e:?}"))),
            }
        }
    }

    fn pump_zstd(&mut self, end: bool) -> Result<(), FirmwareError> {
        let mut buf = vec![0_u8; 256 * 1024];
        loop {
            // The frame header must be complete before the first call.
            if self.hashed == 0 && self.pending.len() < 18 && !end {
                return Ok(());
            }
            let Codec::Zstd(decoder) = &mut self.codec else { unreachable!() };
            let decoded = decoder.decode_from_to(&self.pending, &mut buf);
            let finished = decoder.is_finished() && decoder.can_collect() == 0;
            let (read, written) = decoded.map_err(|e| self.decode_error(format!("zstd: {e}")))?;
            self.pending.drain(..read);
            self.emit(&buf[..written])?;
            if finished || (read == 0 && written == 0) {
                break;
            }
        }
        let Codec::Zstd(decoder) = &self.codec else { unreachable!() };
        if end && !decoder.is_finished() {
            return Err(self.decode_error("truncated zstd frame"));
        }
        Ok(())
    }

    fn emit(&mut self, data: &[u8]) -> Result<(), FirmwareError> {
        if data.is_empty() {
            return Ok(());
        }
        self.hashed += data.len();
        let limit = self.expected.as_ref().and_then(|c| c.size).unwrap_or(MAX_FIRMWARE_BYTES);
        if self.hashed > limit.min(MAX_FIRMWARE_BYTES) {
            return Err(FirmwareError::Size {
                component: self.name.clone(),
                expected: limit,
                actual: self.hashed,
            });
        }
        self.sha256.update(data);
        self.sha512.update(data);
        self.out.extend_from_slice(data);
        Ok(())
    }

    /// End of input: verify size and digests and return the payload.
    ///
    /// # Errors
    /// Truncated streams, size or digest mismatches.
    pub fn finish(mut self) -> Result<Firmware, FirmwareError> {
        self.pump(true)?;
        let sha256 = hex(&self.sha256.finalize());
        let sha512 = hex(&self.sha512.finalize());
        if let Some(c) = &self.expected {
            if let Some(size) = c.size.filter(|&s| s != self.out.len()) {
                return Err(FirmwareError::Size {
                    component: c.id.clone(),
                    expected: size,
                    actual: self.out.len(),
                });
            }
            for (algorithm, expected, actual) in
                [("sha256", &c.sha256, &sha256), ("sha512", &c.sha512, &sha512)]
            {
                if let Some(expected) = expected.as_ref().filter(|e| !e.eq_ignore_ascii_case(actual)) {
                    return Err(FirmwareError::Integrity {
                        component: c.id.clone(),
                        algorithm,
                        expected: expected.clone(),
                        actual: actual.clone(),
                    });
                }
            }
        }
        Ok(Firmware { component: self.name, bytes: self.out, sha256, sha512 })
    }
}

/// Length of a complete gzip member header (RFC 1952), or `None` while it is incomplete.
fn gzip_header_len(data: &[u8]) -> Option<usize> {
    if data.len() < 10 {
        return None;
    }
    let flags = data[3];
    let mut at = 10;
    if flags & 0x04 != 0 {
        let extra = usize::from(u16::from_le_bytes([*data.get(at)?, *data.get(at + 1)?]));
        at += 2 + extra;
    }
    for bit in [0x08, 0x10] {
        if flags & bit != 0 {
            at += data.get(at..)?.iter().position(|&b| b == 0)? + 1;
        }
    }
    if flags & 0x02 != 0 {
        at += 2;
    }
    (data.len() >= at).then_some(at)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Read and verify registry component `id` from a local file (native hosts).
///
/// # Errors
/// [`FirmwareError::Missing`] when the file does not exist, then any stream error.
#[cfg(not(target_arch = "wasm32"))]
pub fn load_file(id: &str, path: &std::path::Path) -> Result<Firmware, FirmwareError> {
    use std::io::Read;
    let c = component(id)?;
    let mut file = std::fs::File::open(path).map_err(|_| FirmwareError::Missing {
        component: c.id.clone(),
        console: c.console.clone(),
        file: c.file.clone(),
    })?;
    let mut stream = FirmwareStream::new(c.id.clone(), Some(c));
    let mut buf = vec![0_u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| stream.decode_error(e.to_string()))?;
        if n == 0 {
            break;
        }
        stream.push(&buf[..n])?;
    }
    stream.finish()
}
