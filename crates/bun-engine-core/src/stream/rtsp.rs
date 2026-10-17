//! RTSP session setup (client side of Moonshine's `rtsp.rs`, BSD-2-Clause, Copyright (c) 2024,
//! Hans Gaiser): OPTIONS, DESCRIBE, SETUP audio/video/control, ANNOUNCE with the stream SDP and
//! PLAY, one TCP connection per request as GameStream servers expect.

use std::{
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    time::Duration,
};

use super::Codec;

const CLIENT_VERSION: u32 = 14;

pub struct StreamConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub packet_size: u32,
    pub codec: Codec,
    pub encrypt_video: bool,
}

/// What the server told us during setup.
#[derive(Debug, Default, Clone)]
pub struct Session {
    pub video_port: u16,
    pub audio_port: u16,
    pub control_port: u16,
    pub video_ping: Option<[u8; 16]>,
    pub connect_data: u32,
    pub encryption_supported: u32,
    pub encryption_enabled: u32,
    pub supports_hevc: bool,
    pub supports_av1: bool,
}

struct Response {
    status: u32,
    headers: Vec<(String, String)>,
    body: String,
}

impl Response {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

pub struct RtspClient {
    host: String,
    port: u16,
    target: String,
    cseq: u32,
    session: Option<String>,
}

fn sdp_attribute(body: &str, name: &str) -> Option<u32> {
    let key = format!("a={name}:");
    let start = body.find(&key)? + key.len();
    body[start..].lines().next()?.trim().parse().ok()
}

impl RtspClient {
    pub fn new(url: &str, fallback_host: &str) -> Self {
        let rest = url.split("://").nth(1).unwrap_or(url);
        let authority = rest.split('/').next().unwrap_or(rest);
        let (host, port) = match authority.rsplit_once(':') {
            Some((h, p)) if !h.is_empty() => (h.trim_matches(['[', ']']).to_string(), p.parse().unwrap_or(48010)),
            _ => (authority.to_string(), 48010),
        };
        let host = if host.is_empty() || host == "0.0.0.0" { fallback_host.to_string() } else { host };
        let target = format!("rtsp://{host}:{port}");
        Self { host, port, target, cseq: 0, session: None }
    }

    pub fn host(&self) -> &str {
        &self.host
    }

    fn request(&mut self, method: &str, target: &str, headers: &[(&str, String)], body: &str) -> Result<Response, String> {
        self.cseq += 1;
        let mut text = format!("{method} {target} RTSP/1.0\r\nCSeq: {}\r\nX-GS-ClientVersion: {CLIENT_VERSION}\r\nHost: {}\r\n", self.cseq, self.host);
        if let Some(session) = self.session.as_ref() {
            text.push_str(&format!("Session: {session}\r\n"));
        }
        for (k, v) in headers {
            text.push_str(&format!("{k}: {v}\r\n"));
        }
        text.push_str("\r\n");
        text.push_str(body);
        let addr = (self.host.as_str(), self.port).to_socket_addrs().map_err(|e| e.to_string())?.next().ok_or("unresolved RTSP host")?;
        let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(5)).map_err(|e| format!("RTSP {addr}: {e}"))?;
        stream.set_read_timeout(Some(Duration::from_secs(15))).ok();
        stream.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        let mut raw = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            match stream.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    raw.extend_from_slice(&buf[..n]);
                    // Stop once the declared body is complete (some servers keep the socket open).
                    let text = String::from_utf8_lossy(&raw);
                    if let Some(split) = text.find("\r\n\r\n") {
                        let len = text[..split]
                            .lines()
                            .find_map(|l| l.split_once(':').filter(|(k, _)| k.trim().eq_ignore_ascii_case("content-length")))
                            .and_then(|(_, v)| v.trim().parse::<usize>().ok())
                            .unwrap_or(0);
                        if raw.len() >= split + 4 + len {
                            break;
                        }
                    }
                }
                Err(e) if raw.is_empty() => return Err(format!("RTSP {method}: {e}")),
                Err(_) => break,
            }
        }
        let text = String::from_utf8_lossy(&raw).into_owned();
        let split = text.find("\r\n\r\n").unwrap_or(text.len());
        let mut lines = text[..split].lines();
        let status_line = lines.next().unwrap_or("");
        let status = status_line.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
        let headers = lines
            .filter_map(|l| l.split_once(':').map(|(k, v)| (k.trim().to_string(), v.trim().to_string())))
            .collect();
        let response = Response { status, headers, body: text.get(split + 4..).unwrap_or("").to_string() };
        if response.status != 200 {
            return Err(format!("RTSP {method} {target}: {status_line}"));
        }
        Ok(response)
    }

    fn server_port(response: &Response) -> Result<u16, String> {
        let transport = response.header("Transport").ok_or("no Transport header")?;
        let start = transport.find("server_port=").ok_or("no server_port")? + 12;
        transport[start..]
            .split(|c: char| !c.is_ascii_digit())
            .next()
            .and_then(|p| p.parse().ok())
            .ok_or_else(|| "bad server_port".into())
    }

    /// Full handshake; `config.codec` is downgraded when the host lacks it.
    pub fn handshake(&mut self, config: &mut StreamConfig) -> Result<Session, String> {
        let mut session = Session::default();
        let target = self.target.clone();
        self.request("OPTIONS", &target, &[], "")?;
        let describe = self.request(
            "DESCRIBE",
            &target,
            &[("Accept", "application/sdp".into()), ("If-Modified-Since", "Thu, 01 Jan 1970 00:00:00 GMT".into())],
            "",
        )?;
        session.supports_av1 = describe.body.contains("AV1/90000");
        session.supports_hevc = describe.body.contains("sprop-parameter-sets=AAAAAU");
        session.encryption_supported = sdp_attribute(&describe.body, "x-ss-general.encryptionSupported").unwrap_or(0);
        let requested = sdp_attribute(&describe.body, "x-ss-general.encryptionRequested").unwrap_or(0);
        if config.codec == Codec::Av1 && !session.supports_av1 {
            config.codec = if session.supports_hevc { Codec::Hevc } else { Codec::H264 };
        }
        if config.codec == Codec::Hevc && !session.supports_hevc {
            config.codec = Codec::H264;
        }
        let setup = |client: &mut Self, stream: &str| {
            client.request(
                "SETUP",
                stream,
                &[
                    ("Transport", "unicast;X-GS-ClientPort=50000-50001".into()),
                    ("If-Modified-Since", "Thu, 01 Jan 1970 00:00:00 GMT".into()),
                ],
                "",
            )
        };
        let audio = setup(self, "streamid=audio/0/0")?;
        session.audio_port = Self::server_port(&audio).unwrap_or(48000);
        let id = audio.header("Session").ok_or("RTSP SETUP returned no session")?;
        self.session = Some(id.split(';').next().unwrap_or(id).trim().to_string());
        let video = setup(self, "streamid=video/0/0")?;
        session.video_port = Self::server_port(&video)?;
        session.video_ping = video.header("X-SS-Ping-Payload").and_then(|p| p.as_bytes().try_into().ok());
        let control = setup(self, "streamid=control/13/0")?;
        session.control_port = Self::server_port(&control)?;
        session.connect_data = control.header("X-SS-Connect-Data").and_then(|v| v.parse().ok()).unwrap_or(0);

        // Encrypted control is always used when offered; video encryption on request (or demand).
        let mut enabled = session.encryption_supported & 0x01;
        if session.encryption_supported & 0x02 != 0 && (config.encrypt_video || requested & 0x02 != 0) {
            enabled |= 0x02;
        }
        session.encryption_enabled = enabled;
        if enabled & 0x02 != 0 {
            config.packet_size -= 32;
        }
        let sdp = self.sdp(config, &session);
        self.request(
            "ANNOUNCE",
            "streamid=control/13/0",
            &[("Content-type", "application/sdp".into()), ("Content-length", sdp.len().to_string())],
            &sdp,
        )?;
        self.request("PLAY", "/", &[], "")?;
        Ok(session)
    }

    fn sdp(&self, config: &StreamConfig, session: &Session) -> String {
        let bitrate = (config.bitrate_kbps as f64 * 0.8) as u32;
        let bitrate = bitrate.min(100_000);
        let mut a: Vec<(&str, String)> = vec![
            ("x-ml-general.featureFlags", "2".into()),
            ("x-ss-general.encryptionEnabled", session.encryption_enabled.to_string()),
            ("x-ss-video[0].chromaSamplingType", "0".into()),
            ("x-nv-video[0].clientViewportWd", config.width.to_string()),
            ("x-nv-video[0].clientViewportHt", config.height.to_string()),
            ("x-nv-video[0].maxFPS", config.fps.to_string()),
            ("x-nv-video[0].packetSize", config.packet_size.to_string()),
            ("x-nv-video[0].rateControlMode", "4".into()),
            ("x-nv-video[0].timeoutLengthMs", "7000".into()),
            ("x-nv-video[0].framesWithInvalidRefThreshold", "0".into()),
            ("x-nv-video[0].initialBitrateKbps", bitrate.to_string()),
            ("x-nv-video[0].initialPeakBitrateKbps", bitrate.to_string()),
            ("x-nv-vqos[0].bw.minimumBitrateKbps", bitrate.to_string()),
            ("x-nv-vqos[0].bw.maximumBitrateKbps", bitrate.to_string()),
            ("x-ml-video.configuredBitrateKbps", config.bitrate_kbps.to_string()),
            ("x-nv-vqos[0].fec.enable", "1".into()),
            ("x-nv-vqos[0].videoQualityScoreUpdateTime", "5000".into()),
            ("x-nv-vqos[0].qosTrafficType", "0".into()),
            ("x-nv-aqos.qosTrafficType", "0".into()),
            ("x-nv-general.featureFlags", "135".into()),
            ("x-nv-general.useReliableUdp", "13".into()),
            ("x-nv-vqos[0].fec.minRequiredFecPackets", "2".into()),
            ("x-nv-vqos[0].bllFec.enable", "0".into()),
            ("x-nv-vqos[0].drc.enable", "0".into()),
            ("x-nv-general.enableRecoveryMode", "0".into()),
            ("x-nv-video[0].videoEncoderSlicesPerFrame", "1".into()),
        ];
        match config.codec {
            Codec::Av1 => a.push(("x-nv-vqos[0].bitStreamFormat", "2".into())),
            Codec::Hevc => {
                a.push(("x-nv-clientSupportHevc", "1".into()));
                a.push(("x-nv-vqos[0].bitStreamFormat", "1".into()));
            }
            Codec::H264 => {
                a.push(("x-nv-clientSupportHevc", "0".into()));
                a.push(("x-nv-vqos[0].bitStreamFormat", "0".into()));
            }
        }
        a.extend([
            ("x-nv-video[0].dynamicRangeMode", "0".into()),
            ("x-nv-video[0].maxNumReferenceFrames", "1".into()),
            ("x-nv-video[0].clientRefreshRateX100", (config.fps * 100).to_string()),
            ("x-nv-audio.surround.numChannels", "2".into()),
            ("x-nv-audio.surround.channelMask", "3".into()),
            ("x-nv-audio.surround.enable", "0".into()),
            ("x-nv-audio.surround.AudioQuality", "0".into()),
            ("x-nv-aqos.packetDuration", "5".into()),
            // Rec. 709, limited range.
            ("x-nv-video[0].encoderCscMode", "2".into()),
        ]);
        let family = if self.host.contains(':') { "IPv6" } else { "IPv4" };
        let mut sdp = format!("v=0\r\no=android 0 {CLIENT_VERSION} IN {family} {}\r\ns=NVIDIA Streaming Client\r\n", self.host);
        for (k, v) in a {
            sdp.push_str(&format!("a={k}:{v} \r\n"));
        }
        sdp.push_str(&format!("t=0 0\r\nm=video {}  \r\n", session.video_port));
        sdp
    }
}
