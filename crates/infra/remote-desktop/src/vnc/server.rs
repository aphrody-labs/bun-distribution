// SPDX-License-Identifier: Apache-2.0
//! RFB server of this desktop on top of `rustvncserver`, fed by the same capture backend and
//! input injection as the WebSocket server (GDI + SendInput on Windows, X11 + XTEST on Linux).
//!
//! `rustvncserver` only listens on `0.0.0.0`, so the server never calls its `listen`: this module
//! binds the requested address itself, filters peers against an allowlist and splices each
//! admitted connection to a reverse RFB session the library opens to a loopback rendezvous
//! listener. A local process could race that rendezvous; it would only reach the peer that
//! already passed the allowlist, never the desktop.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use ipnet::IpNet;
use rustvncserver::VncServer;
use rustvncserver::server::ServerEvent;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

use super::buttons;
use crate::backend::{MouseButton, create_backend};

/// Options of [`serve`].
#[derive(Clone)]
pub struct VncServeOptions {
    pub bind: SocketAddr,
    /// RFB (DES) password; only the first 8 characters are significant. Must not be empty.
    pub password: String,
    /// Admitted peers besides loopback. Empty admits loopback only.
    pub allow: Vec<IpNet>,
    pub fps: u32,
    pub desktop_name: String,
}

impl std::fmt::Debug for VncServeOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VncServeOptions")
            .field("bind", &self.bind)
            .field("password", &"<redacted>")
            .field("allow", &self.allow)
            .field("fps", &self.fps)
            .field("desktop_name", &self.desktop_name)
            .finish()
    }
}

impl VncServeOptions {
    #[must_use]
    pub fn new(bind: SocketAddr, password: String) -> Self {
        Self { bind, password, allow: Vec::new(), fps: 10, desktop_name: "aphrody".into() }
    }
}

/// Parse an allowlist entry: an address (`10.200.77.4`), a network (`10.200.77.0/24`) or `any`.
pub fn parse_allow(entry: &str) -> Result<Vec<IpNet>> {
    let entry = entry.trim();
    if entry.eq_ignore_ascii_case("any") {
        return Ok(vec!["0.0.0.0/0".parse()?, "::/0".parse()?]);
    }
    if let Ok(net) = entry.parse::<IpNet>() {
        return Ok(vec![net]);
    }
    let ip: IpAddr = entry.parse().with_context(|| format!("invalid allow entry {entry}"))?;
    Ok(vec![IpNet::from(ip)])
}

/// Whether `ip` may connect: loopback always, others when an allowlist network contains it.
#[must_use]
pub fn peer_allowed(allow: &[IpNet], ip: IpAddr) -> bool {
    let ip = ip.to_canonical();
    ip.is_loopback() || allow.iter().any(|n| n.contains(&ip))
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Input {
    Move(i32, i32),
    Button(MouseButton, bool),
    Wheel(i32, i32),
    Keysym(u32, bool),
}

/// Translate one RFB pointer event (absolute position, previous and new button masks).
fn pointer_inputs(prev: u8, mask: u8, x: i32, y: i32) -> Vec<Input> {
    let mut out = vec![Input::Move(x, y)];
    for (bit, button) in [
        (buttons::LEFT, MouseButton::Left),
        (buttons::MIDDLE, MouseButton::Middle),
        (buttons::RIGHT, MouseButton::Right),
    ] {
        if (prev ^ mask) & bit != 0 {
            out.push(Input::Button(button, mask & bit != 0));
        }
    }
    let pressed = mask & !prev;
    for (bit, dx, dy) in [
        (buttons::WHEEL_UP, 0, 120),
        (buttons::WHEEL_DOWN, 0, -120),
        (buttons::WHEEL_LEFT, -120, 0),
        (buttons::WHEEL_RIGHT, 120, 0),
    ] {
        if pressed & bit != 0 {
            out.push(Input::Wheel(dx, dy));
        }
    }
    out
}

struct Shared {
    clients: AtomicUsize,
    origin_x: AtomicI32,
    origin_y: AtomicI32,
    stop: AtomicBool,
}

struct Frame {
    width: u16,
    height: u16,
    rgba: Vec<u8>,
}

fn to_frame(frame: crate::backend::RawFrame) -> Result<Frame> {
    let width = u16::try_from(frame.width).context("screen wider than RFB allows")?;
    let height = u16::try_from(frame.height).context("screen taller than RFB allows")?;
    let mut rgba = frame.bgra;
    for px in rgba.as_chunks_mut::<4>().0 {
        px.swap(0, 2);
        px[3] = 0xFF;
    }
    Ok(Frame { width, height, rgba })
}

fn capture_loop(shared: &Shared, fps: u32, tx: &mpsc::Sender<Frame>) {
    let mut backend = match create_backend() {
        Ok(b) => b,
        Err(e) => {
            eprintln!("vnc: capture backend unavailable: {e:#}");
            return;
        },
    };
    let period = Duration::from_micros(1_000_000 / u64::from(fps.clamp(1, 60)));
    while !shared.stop.load(Ordering::Relaxed) {
        if shared.clients.load(Ordering::Relaxed) == 0 {
            std::thread::sleep(Duration::from_millis(200));
            continue;
        }
        let started = Instant::now();
        match backend.capture().and_then(|f| {
            shared.origin_x.store(f.origin_x, Ordering::Relaxed);
            shared.origin_y.store(f.origin_y, Ordering::Relaxed);
            to_frame(f)
        }) {
            Ok(frame) => {
                if tx.blocking_send(frame).is_err() {
                    return;
                }
            },
            // Transient on the lock screen / secure desktop.
            Err(_) => std::thread::sleep(Duration::from_millis(200)),
        }
        if let Some(rest) = period.checked_sub(started.elapsed()) {
            std::thread::sleep(rest);
        }
    }
}

fn input_loop(shared: &Shared, rx: &std::sync::mpsc::Receiver<Input>) {
    let mut backend = match create_backend() {
        Ok(b) => b,
        Err(e) => {
            eprintln!("vnc: input backend unavailable: {e:#}");
            return;
        },
    };
    while let Ok(first) = rx.recv() {
        let mut batch = vec![first];
        while let Ok(next) = rx.try_recv() {
            match (batch.last_mut(), next) {
                (Some(last @ Input::Move(..)), next @ Input::Move(..)) => *last = next,
                (_, next) => batch.push(next),
            }
        }
        if shared.stop.load(Ordering::Relaxed) {
            return;
        }
        for ev in batch {
            let _ = match ev {
                Input::Move(x, y) => backend.mouse_move(x, y),
                Input::Button(b, down) => backend.mouse_button(b, down),
                Input::Wheel(dx, dy) => backend.wheel(dx, dy),
                Input::Keysym(k, down) => backend.keysym(k, down),
            };
        }
    }
}

async fn splice(
    server: Arc<VncServer>,
    rendezvous: Arc<TcpListener>,
    port: u16,
    mut outer: TcpStream,
) -> Result<()> {
    let srv = Arc::clone(&server);
    let handshake =
        tokio::spawn(async move { srv.connect_reverse(Ipv4Addr::LOCALHOST.to_string(), port).await });
    let (mut inner, from) = tokio::time::timeout(Duration::from_secs(10), rendezvous.accept())
        .await
        .context("RFB session did not reach the rendezvous")??;
    if !from.ip().is_loopback() {
        bail!("unexpected rendezvous peer {from}");
    }
    let _ = outer.set_nodelay(true);
    let _ = inner.set_nodelay(true);
    let _ = tokio::io::copy_bidirectional(&mut outer, &mut inner).await;
    handshake.abort();
    Ok(())
}

/// Serve this desktop over RFB until Ctrl-C.
pub async fn serve(opts: VncServeOptions) -> Result<()> {
    if opts.password.is_empty() {
        bail!("refusing to serve VNC without a password");
    }
    let first = tokio::task::spawn_blocking(|| create_backend()?.capture())
        .await?
        .context("initial screen capture failed")?;
    let shared = Arc::new(Shared {
        clients: AtomicUsize::new(0),
        origin_x: AtomicI32::new(first.origin_x),
        origin_y: AtomicI32::new(first.origin_y),
        stop: AtomicBool::new(false),
    });
    let first = to_frame(first)?;
    let (server, mut events) =
        VncServer::new(first.width, first.height, opts.desktop_name.clone(), Some(opts.password.clone()));
    let server = Arc::new(server);
    server.framebuffer().update_from_slice(&first.rgba).await.map_err(anyhow::Error::msg)?;

    let listener =
        TcpListener::bind(opts.bind).await.with_context(|| format!("cannot bind {}", opts.bind))?;
    let rendezvous = Arc::new(TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?);
    let rendezvous_port = rendezvous.local_addr()?.port();

    let (frame_tx, mut frame_rx) = mpsc::channel::<Frame>(1);
    let (input_tx, input_rx) = std::sync::mpsc::sync_channel::<Input>(512);
    let cap_shared = Arc::clone(&shared);
    let fps = opts.fps;
    std::thread::Builder::new()
        .name("vnc-capture".into())
        .spawn(move || capture_loop(&cap_shared, fps, &frame_tx))?;
    let inp_shared = Arc::clone(&shared);
    std::thread::Builder::new()
        .name("vnc-input".into())
        .spawn(move || input_loop(&inp_shared, &input_rx))?;

    let fb_server = Arc::clone(&server);
    let frames = tokio::spawn(async move {
        while let Some(frame) = frame_rx.recv().await {
            let fb = fb_server.framebuffer();
            if (fb.width(), fb.height()) != (frame.width, frame.height)
                && let Err(e) = fb.resize(frame.width, frame.height).await
            {
                eprintln!("vnc: resize failed: {e}");
                continue;
            }
            let _ = fb.update_from_slice(&frame.rgba).await;
        }
    });

    let ev_shared = Arc::clone(&shared);
    let dispatch = tokio::spawn(async move {
        let mut masks: HashMap<usize, u8> = HashMap::new();
        while let Some(event) = events.recv().await {
            let inputs = match event {
                ServerEvent::ClientConnected { client_id } => {
                    ev_shared.clients.fetch_add(1, Ordering::Relaxed);
                    eprintln!("vnc: session {client_id} opened");
                    continue;
                },
                ServerEvent::ClientDisconnected { client_id } => {
                    let _ = ev_shared.clients.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                        Some(n.saturating_sub(1))
                    });
                    masks.remove(&client_id);
                    eprintln!("vnc: session {client_id} closed");
                    continue;
                },
                ServerEvent::KeyPress { down, key, .. } => vec![Input::Keysym(key, down)],
                ServerEvent::PointerMove { client_id, x, y, button_mask } => {
                    let prev = masks.insert(client_id, button_mask).unwrap_or(0);
                    pointer_inputs(
                        prev,
                        button_mask,
                        ev_shared.origin_x.load(Ordering::Relaxed) + i32::from(x),
                        ev_shared.origin_y.load(Ordering::Relaxed) + i32::from(y),
                    )
                },
                _ => continue,
            };
            for input in inputs {
                // Best effort: a full queue drops the event rather than stalling the session.
                let _ = input_tx.try_send(input);
            }
        }
    });

    let shutdown = tokio::signal::ctrl_c();
    tokio::pin!(shutdown);
    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            accepted = listener.accept() => {
                let (outer, peer) = match accepted {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("vnc: accept failed: {e}");
                        continue;
                    },
                };
                if !peer_allowed(&opts.allow, peer.ip()) {
                    eprintln!("vnc: refused {peer} (not in the allowlist)");
                    continue;
                }
                let (server, rendezvous) = (Arc::clone(&server), Arc::clone(&rendezvous));
                tokio::spawn(async move {
                    if let Err(e) = splice(server, rendezvous, rendezvous_port, outer).await {
                        eprintln!("vnc: {peer}: {e:#}");
                    }
                });
            },
        }
    }
    shared.stop.store(true, Ordering::Relaxed);
    server.disconnect_all_clients().await;
    frames.abort();
    dispatch.abort();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_admits_loopback_and_listed_peers_only() {
        let allow = parse_allow("10.200.77.4").unwrap();
        assert!(peer_allowed(&allow, "10.200.77.4".parse().unwrap()));
        assert!(peer_allowed(&allow, "127.0.0.1".parse().unwrap()));
        assert!(peer_allowed(&allow, "::ffff:10.200.77.4".parse().unwrap()));
        assert!(!peer_allowed(&allow, "10.200.77.10".parse().unwrap()));
        assert!(!peer_allowed(&[], "10.200.77.4".parse().unwrap()));
        let net = parse_allow("10.200.77.0/24").unwrap();
        assert!(peer_allowed(&net, "10.200.77.10".parse().unwrap()));
        assert!(peer_allowed(&parse_allow("any").unwrap(), "8.8.8.8".parse().unwrap()));
        assert!(parse_allow("nope").is_err());
    }

    #[test]
    fn pointer_masks_become_button_and_wheel_events() {
        assert_eq!(pointer_inputs(0, 0, 5, 6), vec![Input::Move(5, 6)]);
        assert_eq!(
            pointer_inputs(0, buttons::LEFT, 1, 2),
            vec![Input::Move(1, 2), Input::Button(MouseButton::Left, true)]
        );
        assert_eq!(
            pointer_inputs(buttons::LEFT | buttons::RIGHT, buttons::RIGHT, 1, 2),
            vec![Input::Move(1, 2), Input::Button(MouseButton::Left, false)]
        );
        assert_eq!(
            pointer_inputs(0, buttons::WHEEL_DOWN, 0, 0),
            vec![Input::Move(0, 0), Input::Wheel(0, -120)]
        );
        // Wheel release is not a second notch.
        assert_eq!(pointer_inputs(buttons::WHEEL_UP, 0, 0, 0), vec![Input::Move(0, 0)]);
    }

    #[test]
    fn frames_are_converted_to_rgba() {
        let raw = crate::backend::RawFrame {
            origin_x: 0,
            origin_y: 0,
            width: 1,
            height: 1,
            bgra: vec![1, 2, 3, 0],
        };
        let f = to_frame(raw).unwrap();
        assert_eq!((f.width, f.height, f.rgba), (1, 1, vec![3, 2, 1, 255]));
    }

    #[tokio::test]
    async fn splice_bridges_a_viewer_to_an_rfb_session() {
        let (server, _events) = VncServer::new(4, 4, "t".into(), Some("secret".into()));
        let server = Arc::new(server);
        let rendezvous = Arc::new(TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap());
        let port = rendezvous.local_addr().unwrap().port();
        let front = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let addr = front.local_addr().unwrap().to_string();
        tokio::spawn(async move {
            let (outer, _) = front.accept().await.unwrap();
            let _ = splice(server, rendezvous, port, outer).await;
        });
        assert_eq!(
            super::super::probe(&addr, Duration::from_secs(5)).await.unwrap(),
            "RFB 003.008"
        );
    }
}
