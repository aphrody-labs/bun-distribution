//! The stream client as a Bevy plugin: network receive, hardware decode and loopback threads,
//! input forwarding from Bevy messages, the HUD, and a render system in the `Core2d` schedule that
//! samples the decoder's shared NV12 ring through FSR1 straight into the camera output.

use std::{
    collections::HashSet,
    net::{SocketAddr, ToSocketAddrs, UdpSocket},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        mpsc::{self, Receiver, Sender},
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

use aphrody_gpu_backend::wgpu;

use crate::bevy::{
    app::{App, AppExit, Last, Plugin, Update},
    core_pipeline::{schedule::Core2d, upscaling::upscaling},
    ecs::prelude::*,
    input::{
        ButtonState,
        keyboard::{KeyCode, KeyboardInput},
        mouse::{MouseButton, MouseButtonInput, MouseMotion, MouseScrollUnit, MouseWheel},
    },
    render::{
        Render, RenderApp, RenderSystems,
        camera::ExtractedCamera,
        renderer::{RenderContext, RenderDevice, RenderQueue, ViewQuery},
        view::ViewTarget,
    },
    window::{CursorGrabMode, CursorOptions, Monitor, PrimaryMonitor, PrimaryWindow, Window, WindowFocused},
    winit::{EventLoopProxyWrapper, WinitUserEvent},
};

use super::{
    Codec, Options,
    control::{self, Command},
    decode::{Decoder, FrameMeta, GpuClock, Mailbox, Picture, wgpu_adapter_luid},
    hud::HudRaster,
    input, loopback,
    pacing::{FrameAgeTracker, PresentDecision, decide_present},
    present::{Presenter, Source},
    stats::{Sample, Stats, between},
    video::{Depacketizer, Frame, ReceiveStats},
};
use crate::{runtime::EngineExit, window::Pad};

/// How the client gets its video.
pub enum Feed {
    /// A GameStream host after RTSP setup.
    Remote {
        host: String,
        video: SocketAddr,
        ping: Option<[u8; 16]>,
        video_key: Option<[u8; 16]>,
        control: Sender<Command>,
        control_status: Arc<control::Status>,
    },
    /// The in-process synthetic host.
    Loopback,
}

/// Wakes the reactive winit loop from producer threads (decoded frames, failures).
#[derive(Clone)]
pub struct Waker(Arc<dyn Fn() + Send + Sync>);

impl Waker {
    pub fn wake(&self) {
        (self.0)();
    }
}

struct Shared {
    receive: Mutex<ReceiveStats>,
    decoder: Mutex<String>,
    zero_copy: AtomicBool,
    loopback_sent: Arc<AtomicU64>,
    stop: Arc<AtomicBool>,
}

/// What the render world last presented, for the HUD and the report.
#[derive(Clone, Copy, Default)]
struct ViewInfo {
    stream: (u32, u32),
    viewport: (f32, f32, f32, f32),
    drops: u64,
}

/// State shared by the main world, the render world and the worker threads.
pub(crate) struct Core {
    opts: Options,
    codec: Codec,
    host_label: String,
    control: Mutex<Option<Sender<Command>>>,
    control_status: Option<Arc<control::Status>>,
    mailbox: Arc<Mailbox>,
    shared: Arc<Shared>,
    stats: Arc<Mutex<Stats>>,
    clock: Mutex<Option<Arc<loopback::Clock>>>,
    show_hud: AtomicBool,
    hud_bitmap: Mutex<Option<Vec<u8>>>,
    view: Mutex<ViewInfo>,
    refresh_mhz: AtomicU32,
    present_mode: Mutex<String>,
    failure: Mutex<Option<String>>,
    started: Instant,
}

impl Core {
    fn send(&self, command: Command) {
        if let Some(tx) = self.control.lock().unwrap().as_ref() {
            let _ = tx.send(command);
        }
    }

    fn remote(&self) -> bool {
        self.control_status.is_some()
    }

    fn fail(&self, why: String) {
        self.failure.lock().unwrap().get_or_insert(why);
    }

    fn hud_lines(&self, captured: bool) -> Vec<String> {
        let stats = self.stats.lock().unwrap();
        let recent = stats.recent();
        let receive = *self.shared.receive.lock().unwrap();
        let view = *self.view.lock().unwrap();
        let elapsed = self.started.elapsed().as_secs_f64().max(0.001);
        let mbps = receive.bytes as f64 * 8.0 / elapsed / 1e6;
        let m = recent.mean;
        let mut lines = vec![
            format!(
                "{} {} {}x{} -> {}x{} FSR1 EASU+RCAS  {}  Bevy",
                self.host_label,
                self.codec.name(),
                view.stream.0,
                view.stream.1,
                view.viewport.2 as u32,
                view.viewport.3 as u32,
                self.present_mode.lock().unwrap()
            ),
            format!(
                "decoder {} [{}]",
                self.shared.decoder.lock().unwrap(),
                if self.shared.zero_copy.load(Ordering::Relaxed) { "zero-copy D3D11->D3D12" } else { "CPU copy" }
            ),
            format!("fps {:.1}  recv {:.1} Mb/s  frames {}  skipped {}", recent.fps, mbps, stats.presented, view.drops),
            format!(
                "net+fec {:.2}  decode cpu {:.2} gpu {:.2}  render {:.2}  present gpu {:.2} ms",
                m.net,
                m.decode,
                m.decode_gpu.unwrap_or(0.0),
                m.render,
                m.present_gpu.unwrap_or(m.gpu)
            ),
            format!("recv->glass {:.2} ms (p95 {:.2})  host {:.1} ms", m.recv_to_glass, recent.p95_recv_to_glass, m.host),
            format!(
                "fec rebuilt {} shards  lost {} frames  pkts {}",
                receive.recovered_shards, receive.lost_frames, receive.packets
            ),
        ];
        if let Some(c2g) = m.capture_to_glass {
            lines.push(format!(
                "capture->glass {:.2} ms (p95 {:.2})  encode {:.2} ms",
                c2g,
                recent.p95_capture_to_glass.unwrap_or(0.0),
                m.encode.unwrap_or(0.0)
            ));
        } else if let Some(status) = self.control_status.as_ref() {
            lines.push(format!(
                "control rtt {:.1} ms  mouse {}  (Ctrl+Alt+Shift+Z capture, +Q quit, +S HUD)",
                status.rtt.lock().unwrap().as_secs_f64() * 1000.0,
                if captured { "captured" } else { "free" }
            ));
        }
        lines
    }
}

/// The shared stream state, present in the main and the render world.
#[derive(Resource, Clone)]
pub(crate) struct StreamCore(Arc<Core>);

/// The GameStream client (`bun-engine stream`): add after `BunEnginePlugin` built with
/// [`StreamPlugin::engine`].
pub struct StreamPlugin {
    core: Arc<Core>,
    feed: Mutex<Option<Feed>>,
}

impl StreamPlugin {
    pub fn new(opts: Options, codec: Codec, feed: Feed) -> Self {
        let (control, control_status, host_label) = match &feed {
            Feed::Remote { control, control_status, host, .. } => {
                (Some(control.clone()), Some(control_status.clone()), host.clone())
            }
            Feed::Loopback => (None, None, "loopback".into()),
        };
        let core = Core {
            codec,
            host_label,
            control: Mutex::new(control),
            control_status,
            mailbox: Mailbox::new(),
            shared: Arc::new(Shared {
                receive: Mutex::new(ReceiveStats::default()),
                decoder: Mutex::new("starting".into()),
                zero_copy: AtomicBool::new(false),
                loopback_sent: Arc::new(AtomicU64::new(0)),
                stop: Arc::new(AtomicBool::new(false)),
            }),
            stats: Arc::new(Mutex::new(Stats::default())),
            clock: Mutex::new(None),
            show_hud: AtomicBool::new(opts.hud),
            hud_bitmap: Mutex::new(None),
            view: Mutex::new(ViewInfo::default()),
            refresh_mhz: AtomicU32::new(60_000),
            present_mode: Mutex::new(String::new()),
            failure: Mutex::new(None),
            started: Instant::now(),
            opts,
        };
        Self { core: Arc::new(core), feed: Mutex::new(Some(feed)) }
    }

    /// The engine plugin this client needs: DX12 (NV12 sharing), low-latency present, reactive
    /// redraws, no pipelined rendering.
    pub fn engine(&self) -> crate::runtime::BunEnginePlugin {
        use crate::bevy::window::PresentMode;
        let opts = &self.core.opts;
        let mut engine = crate::runtime::BunEnginePlugin::windowed(format!("Bun Engine stream - {}", self.core.host_label));
        engine.size = Some(opts.window.unwrap_or((opts.width, opts.height)));
        engine.escape_exits = false;
        engine.low_latency = true;
        engine.present_mode = if opts.vsync { PresentMode::AutoVsync } else { PresentMode::AutoNoVsync };
        engine.frame_latency = Some(1);
        engine.backends = Some(wgpu::Backends::DX12);
        engine
    }
}

/// Main-world input state.
#[derive(Resource, Default)]
struct StreamInput {
    captured: bool,
    modifiers: u8,
    held: HashSet<u8>,
    pads: [Option<Pad>; 4],
    slots: Vec<Entity>,
    motion: (f64, f64),
    hud_due: Option<Instant>,
}

/// Worker threads, joined when the app exits.
#[derive(Resource, Default)]
pub(crate) struct StreamThreads(Mutex<Vec<JoinHandle<()>>>);

/// The feed, consumed when the render device exists.
#[derive(Resource)]
struct PendingFeed(Mutex<Option<Feed>>);

/// The GDI HUD rasterizer (main thread).
struct Hud(Option<HudRaster>);

impl Plugin for StreamPlugin {
    fn build(&self, app: &mut App) {
        let core = StreamCore(self.core.clone());
        app.insert_resource(core.clone())
            .insert_resource(PendingFeed(Mutex::new(self.feed.lock().unwrap().take())))
            .init_resource::<StreamInput>()
            .init_resource::<StreamThreads>()
            .insert_non_send(Hud(HudRaster::new()))
            .add_systems(Update, (start, forward_input, status, hud).chain())
            .add_systems(Last, finish);
        let Some(render_app) = app.get_sub_app_mut(RenderApp) else { return };
        render_app
            .insert_resource(core)
            .insert_resource(StreamGpu(Mutex::new(GpuState::default())))
            .add_systems(Core2d, render_stream.after(upscaling))
            .add_systems(Render, signal_presented.in_set(RenderSystems::Cleanup));
    }
}

fn receive_loop(
    socket: UdpSocket,
    key: Option<[u8; 16]>,
    ping: Option<(SocketAddr, Option<[u8; 16]>)>,
    frames: Sender<Frame>,
    on_loss: impl Fn(),
    shared: Arc<Shared>,
) {
    let _ = socket.set_read_timeout(Some(Duration::from_millis(5)));
    let mut depacketizer = Depacketizer::new(key);
    let mut buf = vec![0u8; 65536];
    let mut next_ping = Instant::now();
    let mut ping_seq = 0u32;
    let mut last_idr_request = Instant::now() - Duration::from_secs(1);
    let mut out = Vec::new();
    while !shared.stop.load(Ordering::Relaxed) {
        if let Some((addr, payload)) = ping.as_ref()
            && Instant::now() >= next_ping
        {
            next_ping = Instant::now() + Duration::from_millis(500);
            ping_seq += 1;
            // Sunshine session ping (payload + BE sequence) or the legacy "PING".
            let packet = match payload {
                Some(payload) => [payload.as_slice(), &ping_seq.to_be_bytes()].concat(),
                None => b"PING".to_vec(),
            };
            let _ = socket.send_to(&packet, addr);
        }
        let mut loss = false;
        match socket.recv_from(&mut buf) {
            Ok((n, _)) => depacketizer.push(&buf[..n], Instant::now(), &mut out, &mut loss),
            Err(_) => continue,
        }
        if loss && last_idr_request.elapsed() > Duration::from_millis(50) {
            last_idr_request = Instant::now();
            on_loss();
        }
        for frame in out.drain(..) {
            if frames.send(frame).is_err() {
                return;
            }
        }
        *shared.receive.lock().unwrap() = depacketizer.stats;
    }
}

fn decode_loop(
    codec: Codec,
    luid: windows::Win32::Foundation::LUID,
    size: (u32, u32, u32),
    mailbox: Arc<Mailbox>,
    frames: Receiver<Frame>,
    waker: Waker,
    shared: Arc<Shared>,
) {
    let mut decoder = match Decoder::new(codec, luid, size.0, size.1, size.2, mailbox.clone()) {
        Ok(d) => d,
        Err(e) => {
            mailbox.close(e);
            return waker.wake();
        }
    };
    *shared.decoder.lock().unwrap() = format!("{}{}", decoder.name, if decoder.hardware { " (DXVA)" } else { " (software)" });
    shared.zero_copy.store(decoder.zero_copy(), Ordering::Relaxed);
    for frame in frames {
        let meta = FrameMeta {
            index: frame.index,
            rtp_timestamp: frame.rtp_timestamp,
            host_latency: frame.host_latency,
            first_packet: frame.first_packet,
            completed: frame.completed,
            decode_start: Instant::now(),
            decoded: Instant::now(),
            recovered: frame.recovered,
            bytes: frame.data.len(),
            fence_value: 0,
        };
        match decoder.decode(&frame.data, meta) {
            Ok(0) => {}
            Ok(_) => waker.wake(),
            Err(e) => {
                mailbox.close(e);
                return waker.wake();
            }
        }
    }
}

/// `Update`: once the render device exists, start the decode, receive and loopback threads on its
/// adapter.
fn start(
    core: Res<StreamCore>,
    pending: Res<PendingFeed>,
    threads: Res<StreamThreads>,
    device: Option<Res<RenderDevice>>,
    proxy: Option<Res<EventLoopProxyWrapper>>,
    monitors: Query<&Monitor, With<PrimaryMonitor>>,
    windows: Query<&Window, With<PrimaryWindow>>,
    mut exit: MessageWriter<AppExit>,
) {
    let Some(device) = device else { return };
    let Some(feed) = pending.0.lock().unwrap().take() else { return };
    let core = &core.0;
    if let Some(mhz) = monitors.iter().next().and_then(|m| m.refresh_rate_millihertz) {
        core.refresh_mhz.store(mhz, Ordering::Relaxed);
    }
    if let Ok(window) = windows.single() {
        *core.present_mode.lock().unwrap() = format!("{:?}", window.present_mode);
    }
    let waker = match proxy {
        Some(proxy) => {
            let proxy = (**proxy).clone();
            Waker(Arc::new(move || {
                let _ = proxy.send_event(WinitUserEvent::WakeUp);
            }))
        }
        None => Waker(Arc::new(|| {})),
    };
    if let Err(e) = spawn_threads(core, feed, device.wgpu_device(), waker, &threads) {
        core.fail(e);
        exit.write(AppExit::error());
    }
}

fn spawn_threads(core: &Arc<Core>, feed: Feed, device: &wgpu::Device, waker: Waker, threads: &StreamThreads) -> Result<(), String> {
    let mut threads = threads.0.lock().unwrap();
    let luid = wgpu_adapter_luid(device)?;
    let (frames_tx, frames_rx) = mpsc::channel::<Frame>();
    let (mailbox, shared) = (core.mailbox.clone(), core.shared.clone());
    let (codec, size) = (core.codec, (core.opts.width, core.opts.height, core.opts.fps));
    let decode_waker = waker.clone();
    threads.push(
        std::thread::Builder::new()
            .name("stream-decode".into())
            .spawn(move || decode_loop(codec, luid, size, mailbox, frames_rx, decode_waker, shared))
            .map_err(|e| e.to_string())?,
    );
    match feed {
        Feed::Remote { video, ping, video_key, control, .. } => {
            let bind = if video.is_ipv6() { "[::]:0" } else { "0.0.0.0:0" };
            let socket = UdpSocket::bind(bind).map_err(|e| e.to_string())?;
            let shared = core.shared.clone();
            let ping = Some((video, ping));
            threads.push(
                std::thread::Builder::new()
                    .name("stream-receive".into())
                    .spawn(move || {
                        receive_loop(socket, video_key, ping, frames_tx, || {
                            let _ = control.send(Command::RequestIdr);
                        }, shared)
                    })
                    .map_err(|e| e.to_string())?,
            );
        }
        Feed::Loopback => {
            let socket = UdpSocket::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
            let dest = socket.local_addr().map_err(|e| e.to_string())?;
            let clock = loopback::Clock::new();
            *core.clock.lock().unwrap() = Some(clock.clone());
            let force_idr = Arc::new(AtomicBool::new(false));
            let (stop, sent) = (core.shared.stop.clone(), core.shared.loopback_sent.clone());
            let o = &core.opts;
            let config = loopback::Config {
                width: o.width,
                height: o.height,
                fps: o.fps,
                bitrate_kbps: o.bitrate_kbps,
                packet_size: o.packet_size as usize,
                fec_percent: o.fec_percent as usize,
                loss_percent: o.loss_percent,
            };
            let mailbox = core.mailbox.clone();
            let idr = force_idr.clone();
            threads.push(
                std::thread::Builder::new()
                    .name("loopback-host".into())
                    .spawn(move || {
                        if let Err(e) = loopback::run(config, dest, clock, idr, stop, sent) {
                            mailbox.close(format!("loopback host: {e}"));
                            waker.wake();
                        }
                    })
                    .map_err(|e| e.to_string())?,
            );
            let shared = core.shared.clone();
            threads.push(
                std::thread::Builder::new()
                    .name("stream-receive".into())
                    .spawn(move || receive_loop(socket, None, None, frames_tx, || force_idr.store(true, Ordering::Release), shared))
                    .map_err(|e| e.to_string())?,
            );
        }
    }
    Ok(())
}

fn set_capture(core: &Core, state: &mut StreamInput, cursor: &mut Query<&mut CursorOptions, With<PrimaryWindow>>, on: bool) {
    if !core.remote() {
        return;
    }
    state.captured = on;
    if let Ok(mut options) = cursor.single_mut() {
        options.grab_mode = if on { CursorGrabMode::Confined } else { CursorGrabMode::None };
        options.visible = !on;
    }
}

fn release_all_keys(core: &Core, state: &mut StreamInput) {
    for vk in std::mem::take(&mut state.held) {
        core.send(Command::Input(input::key(vk, false, 0)));
    }
    state.modifiers = 0;
}

/// `Update`: keyboard, raw mouse, wheel, gamepads and focus to the control stream.
#[allow(clippy::too_many_arguments)]
fn forward_input(
    core: Res<StreamCore>,
    mut state: ResMut<StreamInput>,
    mut keys: MessageReader<KeyboardInput>,
    mut motion: MessageReader<MouseMotion>,
    mut buttons: MessageReader<MouseButtonInput>,
    mut wheel: MessageReader<MouseWheel>,
    mut focus: MessageReader<WindowFocused>,
    mut cursor: Query<&mut CursorOptions, With<PrimaryWindow>>,
    #[cfg(feature = "gamepad")] pads: Query<(Entity, &crate::bevy::input::gamepad::Gamepad)>,
    mut exit: MessageWriter<AppExit>,
) {
    let core = &core.0;
    let state = &mut *state;
    let remote = core.remote();
    for event in keys.read() {
        let (code, pressed) = (event.key_code, event.state == ButtonState::Pressed);
        state.modifiers =
            if pressed { state.modifiers | input::modifier_bit(code) } else { state.modifiers & !input::modifier_bit(code) };
        let combo = input::MODIFIER_CTRL | input::MODIFIER_ALT | input::MODIFIER_SHIFT;
        if pressed && state.modifiers & combo == combo {
            match code {
                KeyCode::KeyQ => {
                    exit.write(AppExit::Success);
                    continue;
                }
                KeyCode::KeyZ => {
                    release_all_keys(core, state);
                    let on = !state.captured;
                    set_capture(core, state, &mut cursor, on);
                    continue;
                }
                KeyCode::KeyS => {
                    core.show_hud.fetch_xor(true, Ordering::Relaxed);
                    state.hud_due = None;
                    continue;
                }
                _ => {}
            }
        }
        if !remote {
            if pressed && code == KeyCode::Escape {
                exit.write(AppExit::Success);
            }
            continue;
        }
        if event.repeat {
            continue;
        }
        if let Some(vk) = input::virtual_key(code) {
            if pressed {
                state.held.insert(vk);
            } else {
                state.held.remove(&vk);
            }
            core.send(Command::Input(input::key(vk, pressed, state.modifiers)));
        }
    }
    for event in motion.read() {
        if !state.captured {
            continue;
        }
        state.motion.0 += f64::from(event.delta.x);
        state.motion.1 += f64::from(event.delta.y);
        let (mx, my) = (state.motion.0.trunc(), state.motion.1.trunc());
        if mx != 0.0 || my != 0.0 {
            state.motion.0 -= mx;
            state.motion.1 -= my;
            core.send(Command::Input(input::mouse_move(mx.clamp(-32768.0, 32767.0) as i16, my.clamp(-32768.0, 32767.0) as i16)));
        }
    }
    for event in buttons.read() {
        let pressed = event.state == ButtonState::Pressed;
        if !state.captured && remote && pressed && event.button == MouseButton::Left {
            set_capture(core, state, &mut cursor, true);
        } else if state.captured
            && let Some(packet) = input::mouse_button(event.button, pressed)
        {
            core.send(Command::Input(packet));
        }
    }
    for event in wheel.read() {
        if !state.captured {
            continue;
        }
        let (dx, dy) = match event.unit {
            MouseScrollUnit::Line => (event.x, event.y),
            MouseScrollUnit::Pixel => (event.x / 120.0, event.y / 120.0),
        };
        if dy != 0.0 {
            core.send(Command::Input(input::scroll((dy * 120.0) as i16)));
        }
        if dx != 0.0 {
            core.send(Command::Input(input::hscroll((dx * 120.0) as i16)));
        }
    }
    for event in focus.read() {
        if !event.focused {
            release_all_keys(core, state);
            set_capture(core, state, &mut cursor, false);
        }
    }
    #[cfg(feature = "gamepad")]
    if remote {
        state.slots.retain(|e| pads.contains(*e));
        for (entity, _) in &pads {
            if !state.slots.contains(&entity) && state.slots.len() < 4 {
                state.slots.push(entity);
            }
        }
        for index in 0..4u8 {
            let slot = usize::from(index);
            let pad = state.slots.get(slot).and_then(|e| pads.get(*e).ok()).map(|(_, p)| crate::window::pad_from_bevy(p));
            if pad == state.pads[slot] {
                continue;
            }
            if pad.is_some() && state.pads[slot].is_none() {
                core.send(Command::Input(input::controller_arrival(index)));
            }
            state.pads[slot] = pad;
            let mask = state.pads.iter().enumerate().fold(0u16, |m, (i, p)| if p.is_some() { m | (1 << i) } else { m });
            core.send(Command::Input(input::gamepad(index, mask, &pad.unwrap_or_default())));
        }
    }
}

/// `Update`: decoder failure, host termination and `--seconds` end the app.
fn status(core: Res<StreamCore>, mut exit: MessageWriter<AppExit>) {
    let core = &core.0;
    if let Some(why) = core.mailbox.closed() {
        core.fail(why);
        exit.write(AppExit::error());
    } else if let Some(status) = core.control_status.as_ref()
        && status.stopped.load(Ordering::SeqCst)
    {
        let why = status.termination.lock().unwrap().clone().unwrap_or_default();
        eprintln!("bun-engine stream: {why}");
        exit.write(AppExit::Success);
    } else if core.opts.seconds.is_some_and(|s| core.started.elapsed().as_secs_f64() >= s) {
        exit.write(AppExit::Success);
    }
}

/// `Update`: every 250 ms, the HUD bitmap and the window title.
fn hud(
    core: Res<StreamCore>,
    mut state: ResMut<StreamInput>,
    mut raster: NonSendMut<Hud>,
    mut windows: Query<&mut Window, With<PrimaryWindow>>,
) {
    let now = Instant::now();
    if state.hud_due.is_some_and(|due| now < due) {
        return;
    }
    state.hud_due = Some(now + Duration::from_millis(250));
    let core = &core.0;
    let lines = core.hud_lines(state.captured);
    if let Ok(mut window) = windows.single_mut() {
        let title = lines.join("  |  ");
        window.title = format!("Bun Engine stream - {}", title.chars().take(200).collect::<String>());
    }
    if core.show_hud.load(Ordering::Relaxed)
        && let Some(raster) = raster.0.as_mut()
    {
        *core.hud_bitmap.lock().unwrap() = Some(raster.render(&lines));
    }
}

/// `Last`: stop the threads and print the report once the app exits.
pub(crate) fn finish(
    mut exits: MessageReader<AppExit>,
    core: Res<StreamCore>,
    threads: Res<StreamThreads>,
    mut engine: ResMut<EngineExit>,
    mut done: Local<bool>,
) {
    if *done || exits.read().next().is_none() {
        return;
    }
    *done = true;
    let core = &core.0;
    core.shared.stop.store(true, Ordering::SeqCst);
    *core.control.lock().unwrap() = None;
    // Unblock a decoder waiting for a free ring slot.
    for slot in 0..super::decode::RING {
        core.mailbox.release(slot);
    }
    for thread in threads.0.lock().unwrap().drain(..) {
        let _ = thread.join();
    }
    let receive = *core.shared.receive.lock().unwrap();
    let (decoded, replaced) = core.mailbox.counters();
    let view = *core.view.lock().unwrap();
    println!("bun-engine stream report ({}, {}, Bevy runtime)", core.host_label, core.codec.name());
    println!(
        "decoder: {} [{}]",
        core.shared.decoder.lock().unwrap(),
        if core.shared.zero_copy.load(Ordering::Relaxed) { "zero-copy D3D11 -> D3D12 NV12 ring" } else { "CPU copy" }
    );
    println!(
        "present mode: {}  stream {}x{}@{}",
        core.present_mode.lock().unwrap(),
        core.opts.width,
        core.opts.height,
        core.opts.fps
    );
    println!(
        "packets {} ({} sent by loopback host), frames reassembled {}, FEC-rebuilt shards {}, lost frames {}, decoded {}, superseded before present {}, skipped late {}",
        receive.packets,
        core.shared.loopback_sent.load(Ordering::Relaxed),
        receive.frames,
        receive.recovered_shards,
        receive.lost_frames,
        decoded,
        replaced,
        view.drops
    );
    print!("{}", core.stats.lock().unwrap().report());
    if let Some(why) = core.failure.lock().unwrap().take() {
        engine.fail(why);
    }
}

/// Render-world state: the presenter on the Bevy device and the frame being presented.
#[derive(Default)]
struct GpuState {
    presenter: Option<Presenter>,
    gpu_clock: Option<GpuClock>,
    tracker: FrameAgeTracker,
    current_slot: Option<usize>,
    retire: Vec<usize>,
    pending_wait: Option<u64>,
    pending_meta: Option<FrameMeta>,
    /// Recorded this frame, signalled after Bevy submits and presents.
    recorded: Option<(Vec<usize>, Option<FrameMeta>, Instant)>,
}

#[derive(Resource)]
struct StreamGpu(Mutex<GpuState>);

/// `Core2d`, after Bevy's upscaling: take the newest decoded frame and draw it with FSR1 + HUD
/// into the camera output.
fn render_stream(
    view: ViewQuery<(&ViewTarget, &ExtractedCamera)>,
    core: Res<StreamCore>,
    gpu: Res<StreamGpu>,
    device: Res<RenderDevice>,
    queue: Res<RenderQueue>,
    mut ctx: RenderContext,
) {
    let core = &core.0;
    let (target, camera) = view.into_inner();
    let (Some(out), Some(format), Some(size)) = (target.out_texture(), target.out_texture_view_format(), camera.physical_target_size)
    else {
        return;
    };
    let device = device.wgpu_device();
    let queue: &wgpu::Queue = &queue;
    let mut gpu = gpu.0.lock().unwrap();
    let gpu = &mut *gpu;
    if gpu.presenter.as_ref().is_none_or(|p| p.target_format() != format) {
        gpu.presenter = Some(Presenter::new(device, format, core.opts.sharpness));
        gpu.current_slot = None;
    }
    if gpu.gpu_clock.is_none() {
        match GpuClock::new(device) {
            Ok(clock) => gpu.gpu_clock = Some(clock),
            Err(e) => return core.fail(e),
        }
    }
    let presenter = gpu.presenter.as_mut().unwrap();
    let (announce, frame) = core.mailbox.take();
    if let Some(set) = announce {
        if let Err(e) = presenter.import(device, &set) {
            return core.fail(format!("importing the decoder ring: {e}"));
        }
        gpu.current_slot = None;
        gpu.retire.clear();
        gpu.pending_wait = None;
    }
    let mut fresh = false;
    if let Some(frame) = frame {
        let age = frame.meta.completed.elapsed().as_nanos() as u64;
        let decision = decide_present(age, core.refresh_mhz.load(Ordering::Relaxed), &mut gpu.tracker);
        match frame.picture {
            Picture::Shared { generation, slot, fence_value } => {
                let current = presenter.ring().is_some_and(|r| r.generation == generation);
                if decision == PresentDecision::Skip || !current {
                    core.mailbox.release(slot);
                } else {
                    if let Some(old) = gpu.current_slot.replace(slot)
                        && old != slot
                    {
                        gpu.retire.push(old);
                    }
                    presenter.source = Some(Source::Ring(slot));
                    gpu.pending_wait = Some(fence_value);
                    gpu.pending_meta = Some(frame.meta);
                    fresh = true;
                }
            }
            Picture::Cpu { width, height, pitch, nv12 } => {
                if decision == PresentDecision::Render {
                    presenter.upload_cpu(device, queue, width, height, pitch, &nv12);
                    gpu.pending_meta = Some(frame.meta);
                    fresh = true;
                }
            }
        }
    }
    if let Some(bitmap) = core.hud_bitmap.lock().unwrap().take() {
        presenter.upload_hud(queue, &bitmap);
    }
    let render_start = Instant::now();
    if let (Some(value), Some(ring)) = (gpu.pending_wait.take(), presenter.ring())
        && let Err(e) = ring.gpu_wait(queue, value)
    {
        return core.fail(e);
    }
    let size = (size.x, size.y);
    presenter.encode(device, queue, ctx.command_encoder(), out, size, core.show_hud.load(Ordering::Relaxed));
    *core.view.lock().unwrap() = ViewInfo {
        stream: presenter.stream_size().unwrap_or((0, 0)),
        viewport: presenter.viewport(size).unwrap_or_default(),
        drops: gpu.tracker.drops,
    };
    let meta = if fresh { gpu.pending_meta.take() } else { None };
    gpu.recorded = Some((std::mem::take(&mut gpu.retire), meta, render_start));
}

/// `Render` cleanup, after Bevy submitted and presented: fence the frame and record its latency
/// samples when the GPU finishes it; release the ring slots it superseded.
fn signal_presented(core: Res<StreamCore>, gpu: Res<StreamGpu>, device: Res<RenderDevice>, queue: Res<RenderQueue>) {
    let core = core.0.clone();
    let mut gpu = gpu.0.lock().unwrap();
    let gpu = &mut *gpu;
    if let Some((retired, meta, render_start)) = gpu.recorded.take()
        && let Some(gpu_clock) = gpu.gpu_clock.as_mut()
    {
        let submitted = Instant::now();
        let clock = core.clock.lock().unwrap().clone();
        let (mailbox, stats) = (core.mailbox.clone(), core.stats.clone());
        gpu_clock.signal(&queue, move |done| {
            for slot in retired {
                mailbox.release(slot);
            }
            let Some(meta) = meta else { return };
            let capture = clock.as_ref().and_then(|c| c.capture_of(meta.index));
            let decoded_gpu = (meta.fence_value != 0).then(|| mailbox.decode_clock.done(meta.fence_value)).flatten();
            let sample = Sample {
                net: between(meta.first_packet, meta.completed),
                queue: between(meta.completed, meta.decode_start),
                decode: between(meta.decode_start, meta.decoded),
                decode_gpu: decoded_gpu.map(|t| between(meta.decode_start, t)),
                present_gpu: decoded_gpu.map(|t| between(t.max(submitted), done)),
                wait: between(meta.decoded, render_start),
                render: between(render_start, submitted),
                gpu: between(submitted, done),
                recv_to_glass: between(meta.first_packet, done),
                capture_to_glass: capture.map(|c| between(c, done)),
                encode: clock.as_ref().and_then(|c| c.encode_ms(meta.index)),
                host: f64::from(meta.host_latency) / 10.0,
            };
            stats.lock().unwrap().push(done, sample);
        });
    }
    let _ = device.wgpu_device().poll(wgpu::PollType::Poll);
}

/// Resolve `host:port` for UDP streams.
pub fn socket_addr(host: &str, port: u16) -> Result<SocketAddr, String> {
    (host, port).to_socket_addrs().map_err(|e| e.to_string())?.next().ok_or_else(|| format!("cannot resolve {host}"))
}
