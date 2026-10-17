//! Native game-stream client, a Bevy plugin ([`session::StreamPlugin`]) of the engine runtime.
//!
//! `bun-engine stream <host>` speaks the Moonlight/GameStream protocol to Sunshine, Wolf or
//! Moonshine: PIN pairing and launch over HTTPS, RTSP setup, the encrypted ENet control stream
//! with keyboard / raw-mouse / gamepad input, and RTP video with Reed-Solomon FEC. Video is
//! decoded by the GPU (Media Foundation + DXVA on a D3D11 device of the wgpu adapter) into a ring
//! of NT-shared NV12 textures that Bevy's wgpu device samples directly through D3D12, then upscaled
//! with AMD FSR1 (EASU + RCAS, `runtime::fsr1`) in the `Core2d` render schedule and presented with a
//! low-latency present mode.
//! `bun-engine stream --loopback` runs an in-process host (synthetic pattern, Media Foundation
//! H.264 encoder, the same packetizer and FEC) to measure the client without a server.
//!
//! Absorbed sources and licenses: see `crates/bun-engine-core/STREAM-PROVENANCE.md`.

pub mod control;
pub mod fec;
pub mod http;
pub mod input;
pub mod pacing;
pub mod rtsp;
pub mod stats;
pub mod video;

#[cfg(windows)]
pub mod decode;
#[cfg(windows)]
pub mod encode;
#[cfg(windows)]
mod hud;
#[cfg(windows)]
pub mod loopback;
#[cfg(windows)]
mod present;
#[cfg(windows)]
pub mod session;

/// Video codecs of the GameStream protocol.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Codec {
    H264,
    Hevc,
    Av1,
}

impl Codec {
    pub fn name(self) -> &'static str {
        match self {
            Self::H264 => "H.264",
            Self::Hevc => "HEVC",
            Self::Av1 => "AV1",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text.to_ascii_lowercase().as_str() {
            "h264" | "h.264" | "avc" => Some(Self::H264),
            "hevc" | "h265" | "h.265" => Some(Self::Hevc),
            "av1" => Some(Self::Av1),
            _ => None,
        }
    }
}

pub const USAGE: &str = "usage: bun-engine stream <host[:port]> [--pair] [--apps] [--app NAME|ID] [--quit-app] \
[--size WxH] [--fps N] [--bitrate KBPS] [--codec h264|hevc|av1|auto] [--packet-size N] [--encrypt-video] \
[--window WxH] [--vsync] [--sharpness STOPS] [--no-hud] [--seconds N]\n       \
bun-engine stream --loopback [--size WxH] [--fps N] [--bitrate KBPS] [--loss PERCENT] [--fec PERCENT] [--window WxH] [--seconds N]";

#[derive(Clone, Debug)]
pub struct Options {
    pub host: Option<String>,
    pub loopback: bool,
    pub pair: bool,
    pub list_apps: bool,
    pub quit_app: bool,
    pub app: Option<String>,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub codec: Option<Codec>,
    pub packet_size: u32,
    pub encrypt_video: bool,
    pub window: Option<(u32, u32)>,
    pub vsync: bool,
    pub sharpness: f32,
    pub hud: bool,
    pub seconds: Option<f64>,
    pub loss_percent: f32,
    pub fec_percent: u32,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            host: None,
            loopback: false,
            pair: false,
            list_apps: false,
            quit_app: false,
            app: None,
            width: 1920,
            height: 1080,
            fps: 60,
            bitrate_kbps: 20_000,
            codec: None,
            packet_size: 1392,
            encrypt_video: false,
            window: None,
            vsync: false,
            sharpness: 0.25,
            hud: true,
            seconds: None,
            loss_percent: 0.0,
            fec_percent: 20,
        }
    }
}

fn size(text: Option<String>) -> Result<(u32, u32), String> {
    let text = text.ok_or("missing WxH")?;
    let (w, h) = text.split_once(['x', 'X']).ok_or_else(|| format!("bad size {text}"))?;
    let (w, h) = (w.parse::<u32>().map_err(|e| e.to_string())?, h.parse::<u32>().map_err(|e| e.to_string())?);
    Ok((w & !1, h & !1))
}

impl Options {
    pub fn parse(args: impl Iterator<Item = String>) -> Result<Self, String> {
        let mut o = Self::default();
        let mut args = args.peekable();
        let mut sized = false;
        while let Some(a) = args.next() {
            let mut value = || args.next().ok_or_else(|| format!("{a} needs a value"));
            match a.as_str() {
                "--loopback" => o.loopback = true,
                "--pair" => o.pair = true,
                "--apps" => o.list_apps = true,
                "--quit-app" => o.quit_app = true,
                "--app" => o.app = Some(value()?),
                "--size" => {
                    (o.width, o.height) = size(Some(value()?))?;
                    sized = true;
                }
                "--fps" => o.fps = value()?.parse().map_err(|e| format!("--fps: {e}"))?,
                "--bitrate" => o.bitrate_kbps = value()?.parse().map_err(|e| format!("--bitrate: {e}"))?,
                "--codec" => {
                    let v = value()?;
                    o.codec = if v == "auto" { None } else { Some(Codec::parse(&v).ok_or_else(|| format!("unknown codec {v}"))?) };
                }
                "--packet-size" => o.packet_size = value()?.parse().map_err(|e| format!("--packet-size: {e}"))?,
                "--encrypt-video" => o.encrypt_video = true,
                "--window" => o.window = Some(size(Some(value()?))?),
                "--vsync" => o.vsync = true,
                "--sharpness" => o.sharpness = value()?.parse().map_err(|e| format!("--sharpness: {e}"))?,
                "--no-hud" => o.hud = false,
                "--seconds" => o.seconds = Some(value()?.parse().map_err(|e| format!("--seconds: {e}"))?),
                "--loss" => o.loss_percent = value()?.parse().map_err(|e| format!("--loss: {e}"))?,
                "--fec" => o.fec_percent = value()?.parse().map_err(|e| format!("--fec: {e}"))?,
                flag if flag.starts_with("--") => return Err(format!("unknown option {flag}")),
                host => o.host = Some(host.to_string()),
            }
        }
        if o.loopback && !sized {
            (o.width, o.height) = (1280, 720);
        }
        if o.loopback && o.window.is_none() {
            // Upscale 1.5x by default so FSR1 has work to do.
            o.window = Some((o.width * 3 / 2, o.height * 3 / 2));
        }
        if !o.loopback && o.host.is_none() {
            return Err(USAGE.into());
        }
        Ok(o)
    }
}

/// Entry point of `bun-engine stream`.
#[cfg(windows)]
pub fn main(args: impl Iterator<Item = String>) -> Result<(), String> {
    use std::sync::{Arc, mpsc};

    let opts = Options::parse(args)?;
    if opts.loopback {
        return run(session::StreamPlugin::new(opts, Codec::H264, session::Feed::Loopback));
    }
    let address = opts.host.clone().unwrap();
    let identity = http::Identity::load_or_create(&http::config_dir())?;
    let mut host = http::GameStreamHost::new(&address, &identity);
    let info = host.server_info(&identity)?;
    println!(
        "host {} ({}), GameStream {}, state {}, paired {}",
        host.address, info.hostname, info.app_version, info.state, info.paired
    );
    if opts.pair || host.server_cert.is_none() || !info.paired {
        let digits = http::random::<4>();
        let pin: String = digits.iter().map(|d| char::from(b'0' + d % 10)).collect();
        println!("pairing: enter PIN {pin} on the host (Sunshine web UI > PIN, or the Wolf pairing URL from its log)");
        host.pair(&identity, &pin, "bun-engine")?;
        println!("paired with {}", host.address);
        if opts.pair {
            return Ok(());
        }
    }
    let apps = host.apps(&identity)?;
    if opts.list_apps {
        for (title, id) in &apps {
            println!("{id}\t{title}");
        }
        return Ok(());
    }
    if opts.quit_app {
        host.cancel(&identity)?;
        println!("stopped the running app");
        return Ok(());
    }
    let app = match opts.app.as_deref() {
        Some(wanted) => apps
            .iter()
            .find(|(title, id)| title.eq_ignore_ascii_case(wanted) || id.to_string() == wanted)
            .ok_or_else(|| format!("no app {wanted}; available: {apps:?}"))?,
        None => apps.first().ok_or("the host offers no app")?,
    };
    // Pick the best codec the host and this PC both decode in hardware.
    let codec = opts.codec.unwrap_or_else(|| {
        [Codec::Av1, Codec::Hevc, Codec::H264]
            .into_iter()
            .find(|c| {
                let host_ok = match c {
                    Codec::H264 => true,
                    Codec::Hevc => info.codec_support & 0x0F00 != 0 || info.codec_support == 0,
                    Codec::Av1 => info.codec_support & 0x30000 != 0,
                };
                host_ok && decode::decoder_available(*c)
            })
            .unwrap_or(Codec::H264)
    });
    let rikey = http::random::<16>();
    let rikey_id = i32::from_be_bytes(http::random::<4>());
    println!("launching {} ({}) at {}x{}@{}", app.0, app.1, opts.width, opts.height, opts.fps);
    let url = host.launch(&identity, &info, app.1, (opts.width, opts.height, opts.fps), &rikey, rikey_id)?;
    let mut rtsp = rtsp::RtspClient::new(&url, &host.address);
    let mut config = rtsp::StreamConfig {
        width: opts.width,
        height: opts.height,
        fps: opts.fps,
        bitrate_kbps: opts.bitrate_kbps,
        packet_size: opts.packet_size,
        codec,
        encrypt_video: opts.encrypt_video,
    };
    let session = rtsp.handshake(&mut config)?;
    println!(
        "RTSP ready: video {} control {} codec {} encryption {:#x}",
        session.video_port,
        session.control_port,
        config.codec.name(),
        session.encryption_enabled
    );
    let control_addr = session::socket_addr(rtsp.host(), session.control_port)?;
    let video_addr = session::socket_addr(rtsp.host(), session.video_port)?;
    let (tx, rx) = mpsc::channel();
    let status = Arc::new(control::Status::default());
    let control_thread = {
        let status = status.clone();
        let protection = if info.version() < (7, 1, 431) {
            control::Protection::None
        } else if session.encryption_enabled & 0x01 != 0 {
            control::Protection::V2
        } else {
            control::Protection::Legacy
        };
        let connect_data = session.connect_data;
        std::thread::Builder::new()
            .name("stream-control".into())
            .spawn(move || control::run(control_addr, connect_data, rikey, protection, rx, status))
            .map_err(|e| e.to_string())?
    };
    let feed = session::Feed::Remote {
        host: format!("{} ({})", host.address, app.0),
        video: video_addr,
        ping: session.video_ping,
        video_key: (session.encryption_enabled & 0x02 != 0).then_some(rikey),
        control: tx,
        control_status: status,
    };
    let opts = Options { packet_size: config.packet_size, ..opts };
    let result = run(session::StreamPlugin::new(opts, config.codec, feed));
    let _ = control_thread.join();
    result
}

/// One Bevy app: the low-latency engine runtime and the stream plugin.
#[cfg(windows)]
fn run(plugin: session::StreamPlugin) -> Result<(), String> {
    use std::sync::{Arc, Mutex};

    use crate::bevy::{
        app::{App, AppExit, Last},
        ecs::prelude::*,
    };

    #[derive(Resource)]
    struct Failure(Arc<Mutex<Option<String>>>);

    fn collect(mut exits: MessageReader<AppExit>, engine: Res<crate::runtime::EngineExit>, sink: Res<Failure>) {
        if exits.read().next().is_some() && engine.failure.is_some() {
            *sink.0.lock().unwrap() = engine.failure.clone();
        }
    }

    let failure = Arc::new(Mutex::new(None));
    let mut app = App::new();
    app.add_plugins(plugin.engine())
        .add_plugins(plugin)
        .insert_resource(Failure(failure.clone()))
        .add_systems(Last, collect.after(session::finish));
    let exit = app.run();
    if let Some(why) = failure.lock().unwrap().take() {
        return Err(why);
    }
    match exit {
        AppExit::Success => Ok(()),
        AppExit::Error(code) => Err(format!("stream exited with code {code}")),
    }
}

#[cfg(not(windows))]
pub fn main(_args: impl Iterator<Item = String>) -> Result<(), String> {
    Err("bun-engine stream needs the Windows hardware decoder path (Media Foundation + D3D12)".into())
}
