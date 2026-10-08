// SPDX-License-Identifier: Apache-2.0
//! RFB client session (`vnc-rs`): keeps a BGRA copy of the remote framebuffer and sends
//! pointer/keyboard events, so any VNC server can be screenshotted and driven.

use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use vnc::{
    ClientKeyEvent, ClientMouseEvent, PixelFormat, Rect, VncConnector, VncEncoding, VncEvent, X11Event,
};

use super::buttons;
use crate::encode::encode_jpeg;
use crate::keymap::{char_to_keysym, combo_to_keysyms};

/// Mouse button of [`VncSession::click`].
pub use crate::backend::MouseButton;

#[derive(Default)]
struct Screen {
    width: u16,
    height: u16,
    bgra: Vec<u8>,
    updates: u64,
    last_update: Option<Instant>,
    error: Option<String>,
}

impl Screen {
    fn resize(&mut self, width: u16, height: u16) {
        self.width = width;
        self.height = height;
        self.bgra = vec![0; usize::from(width) * usize::from(height) * 4];
    }

    fn blit(&mut self, rect: Rect, data: &[u8]) {
        let (w, h) = (usize::from(self.width), usize::from(self.height));
        let (rx, ry, rw, rh) =
            (usize::from(rect.x), usize::from(rect.y), usize::from(rect.width), usize::from(rect.height));
        if data.len() < rw * rh * 4 {
            return;
        }
        for row in 0..rh {
            let y = ry + row;
            if y >= h || rx >= w {
                break;
            }
            let n = rw.min(w - rx) * 4;
            let dst = (y * w + rx) * 4;
            let src = row * rw * 4;
            self.bgra[dst..dst + n].copy_from_slice(&data[src..src + n]);
        }
    }

    fn copy(&mut self, dst: Rect, src: Rect) {
        let w = usize::from(self.width);
        let (dx, dy, sx, sy) =
            (usize::from(dst.x), usize::from(dst.y), usize::from(src.x), usize::from(src.y));
        let (rw, rh) = (usize::from(dst.width), usize::from(dst.height));
        if dx.max(sx) + rw > w || dy.max(sy) + rh > usize::from(self.height) {
            return;
        }
        let snapshot: Vec<u8> = (0..rh)
            .flat_map(|r| {
                let s = ((sy + r) * w + sx) * 4;
                self.bgra[s..s + rw * 4].to_vec()
            })
            .collect();
        for r in 0..rh {
            let d = ((dy + r) * w + dx) * 4;
            self.bgra[d..d + rw * 4].copy_from_slice(&snapshot[r * rw * 4..(r + 1) * rw * 4]);
        }
    }

    fn touched(&mut self) {
        self.updates += 1;
        self.last_update = Some(Instant::now());
    }
}

/// A screenshot of the remote framebuffer.
pub struct Screenshot {
    pub width: u32,
    pub height: u32,
    pub jpeg: Vec<u8>,
}

/// A connected RFB session.
pub struct VncSession {
    client: vnc::VncClient,
    screen: Arc<Mutex<Screen>>,
    pointer: Mutex<(u16, u16, u8)>,
    pump: JoinHandle<()>,
}

impl Drop for VncSession {
    fn drop(&mut self) {
        self.pump.abort();
    }
}

fn vnc_err(e: vnc::VncError) -> anyhow::Error {
    anyhow!("vnc: {e}")
}

impl VncSession {
    /// Connect to `addr` (`host:port`) with an optional password (DES; 8 significant characters).
    pub async fn connect(addr: &str, password: Option<String>) -> Result<Self> {
        let tcp = tokio::time::timeout(Duration::from_secs(10), TcpStream::connect(addr))
            .await
            .with_context(|| format!("{addr}: connection timed out"))?
            .with_context(|| format!("{addr}: connection failed"))?;
        let _ = tcp.set_nodelay(true);
        let had_password = password.is_some();
        let password = password.unwrap_or_default();
        let client = tokio::time::timeout(Duration::from_secs(15), async move {
            VncConnector::new(tcp)
                .set_auth_method(async move { Ok::<_, vnc::VncError>(password) })
                .add_encoding(VncEncoding::Zrle)
                .add_encoding(VncEncoding::CopyRect)
                .add_encoding(VncEncoding::Raw)
                .add_encoding(VncEncoding::DesktopSizePseudo)
                .allow_shared(true)
                .set_pixel_format(PixelFormat::bgra())
                .build()?
                .try_start()
                .await?
                .finish()
        })
        .await
        .with_context(|| format!("{addr}: RFB handshake timed out"))?
        .map_err(|e| {
            if had_password {
                anyhow!("{addr}: RFB handshake failed (wrong password?): {e}")
            } else {
                anyhow!("{addr}: RFB handshake failed (server may need a password): {e}")
            }
        })?;
        let screen = Arc::new(Mutex::new(Screen::default()));
        let pump = tokio::spawn(pump(client.clone(), Arc::clone(&screen)));
        let session = Self { client, screen, pointer: Mutex::new((0, 0, 0)), pump };
        // The server announces its geometry right after the handshake.
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            {
                let s = session.screen.lock().await;
                if let Some(e) = &s.error {
                    bail!("{addr}: {e}");
                }
                if s.width > 0 {
                    break;
                }
            }
            if Instant::now() > deadline {
                bail!("{addr}: server sent no desktop size");
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        Ok(session)
    }

    /// Remote desktop size.
    pub async fn size(&self) -> (u16, u16) {
        let s = self.screen.lock().await;
        (s.width, s.height)
    }

    /// Refresh the framebuffer and wait until the update settles.
    async fn refresh(&self, full: bool) -> Result<()> {
        let before = self.screen.lock().await.updates;
        self.client
            .input(if full { X11Event::FullRefresh } else { X11Event::Refresh })
            .await
            .map_err(vnc_err)?;
        let started = Instant::now();
        loop {
            tokio::time::sleep(Duration::from_millis(25)).await;
            let s = self.screen.lock().await;
            if let Some(e) = &s.error {
                bail!("{e}");
            }
            let settled = s.last_update.is_some_and(|t| t.elapsed() >= Duration::from_millis(120));
            if (s.updates > before && settled) || started.elapsed() > Duration::from_secs(3) {
                return Ok(());
            }
        }
    }

    /// Current desktop as top-down BGRA.
    pub async fn frame(&self) -> Result<(u16, u16, Vec<u8>)> {
        self.refresh(true).await?;
        let s = self.screen.lock().await;
        Ok((s.width, s.height, s.bgra.clone()))
    }

    /// Current desktop as JPEG (`scale` 1..=4 downscales).
    pub async fn screenshot(&self, quality: u8, scale: u8) -> Result<Screenshot> {
        let (w, h, bgra) = self.frame().await?;
        let (width, height) = (u32::from(w), u32::from(h));
        let jpeg = tokio::task::spawn_blocking(move || encode_jpeg(&bgra, width, height, quality, scale))
            .await??;
        Ok(Screenshot { width, height, jpeg })
    }

    async fn pointer(&self, x: u16, y: u16, mask: u8) -> Result<()> {
        *self.pointer.lock().await = (x, y, mask);
        self.client
            .input(X11Event::PointerEvent(ClientMouseEvent { position_x: x, position_y: y, bottons: mask }))
            .await
            .map_err(vnc_err)
    }

    async fn clamp(&self, x: i32, y: i32) -> (u16, u16) {
        let (w, h) = self.size().await;
        let c = |v: i32, max: u16| u16::try_from(v.clamp(0, i32::from(max.saturating_sub(1)))).unwrap_or(0);
        (c(x, w), c(y, h))
    }

    /// Move the pointer, keeping held buttons.
    pub async fn move_to(&self, x: i32, y: i32) -> Result<()> {
        let (x, y) = self.clamp(x, y).await;
        let mask = self.pointer.lock().await.2;
        self.pointer(x, y, mask).await
    }

    /// Click `count` times at `(x, y)`.
    pub async fn click(&self, x: i32, y: i32, button: MouseButton, count: u8) -> Result<()> {
        let (x, y) = self.clamp(x, y).await;
        let bit = match button {
            MouseButton::Left => buttons::LEFT,
            MouseButton::Middle => buttons::MIDDLE,
            MouseButton::Right => buttons::RIGHT,
        };
        self.pointer(x, y, 0).await?;
        for _ in 0..count.max(1) {
            self.pointer(x, y, bit).await?;
            self.pointer(x, y, 0).await?;
        }
        Ok(())
    }

    /// Press the left button at the start, move in steps and release at the end.
    pub async fn drag(&self, from: (i32, i32), to: (i32, i32)) -> Result<()> {
        let (sx, sy) = self.clamp(from.0, from.1).await;
        let (ex, ey) = self.clamp(to.0, to.1).await;
        self.pointer(sx, sy, 0).await?;
        self.pointer(sx, sy, buttons::LEFT).await?;
        const STEPS: i32 = 12;
        for i in 1..=STEPS {
            let lerp = |a: u16, b: u16| {
                let v = i32::from(a) + (i32::from(b) - i32::from(a)) * i / STEPS;
                u16::try_from(v).unwrap_or(b)
            };
            self.pointer(lerp(sx, ex), lerp(sy, ey), buttons::LEFT).await?;
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        self.pointer(ex, ey, 0).await
    }

    /// Scroll by wheel notches (120 units each): positive `dy` scrolls down, positive `dx` right.
    pub async fn scroll(&self, dx: i32, dy: i32) -> Result<()> {
        let (x, y, held) = *self.pointer.lock().await;
        let notches = |d: i32| (d.unsigned_abs().div_ceil(120)).clamp(1, 50);
        for (delta, neg, pos) in
            [(dy, buttons::WHEEL_UP, buttons::WHEEL_DOWN), (dx, buttons::WHEEL_LEFT, buttons::WHEEL_RIGHT)]
        {
            if delta == 0 {
                continue;
            }
            let bit = if delta > 0 { pos } else { neg };
            for _ in 0..notches(delta) {
                self.pointer(x, y, held | bit).await?;
                self.pointer(x, y, held).await?;
            }
        }
        Ok(())
    }

    /// Press or release one keysym.
    pub async fn key(&self, keysym: u32, down: bool) -> Result<()> {
        self.client
            .input(X11Event::KeyEvent(ClientKeyEvent { keycode: keysym, down }))
            .await
            .map_err(vnc_err)
    }

    /// Press a key or shortcut (`Enter`, `ctrl+s`, `Alt+F4`).
    pub async fn keypress(&self, combo: &str) -> Result<()> {
        let keys = combo_to_keysyms(combo).with_context(|| format!("unknown key {combo}"))?;
        for k in &keys {
            self.key(*k, true).await?;
        }
        for k in keys.iter().rev() {
            self.key(*k, false).await?;
        }
        Ok(())
    }

    /// Type text, one keysym per character.
    pub async fn type_text(&self, text: &str) -> Result<()> {
        for c in text.chars() {
            let k = char_to_keysym(c);
            self.key(k, true).await?;
            self.key(k, false).await?;
        }
        Ok(())
    }

    /// Close the session.
    pub async fn close(&self) {
        let _ = self.client.close().await;
    }
}

/// Drain engine events into the framebuffer copy. `poll_event` releases the client lock between
/// events so input can be sent concurrently (`recv_event` would hold it while waiting).
async fn pump(client: vnc::VncClient, screen: Arc<Mutex<Screen>>) {
    loop {
        match client.poll_event().await {
            Ok(Some(event)) => {
                let mut s = screen.lock().await;
                match event {
                    VncEvent::SetResolution(r) => {
                        s.resize(r.width, r.height);
                        s.touched();
                    },
                    VncEvent::RawImage(rect, data) => {
                        s.blit(rect, &data);
                        s.touched();
                    },
                    VncEvent::Copy(dst, src) => {
                        s.copy(dst, src);
                        s.touched();
                    },
                    VncEvent::Error(e) => {
                        s.error = Some(e);
                        return;
                    },
                    _ => {},
                }
            },
            Ok(None) => tokio::time::sleep(Duration::from_millis(5)).await,
            Err(e) => {
                screen.lock().await.error = Some(format!("session closed: {e}"));
                return;
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blit_and_copy_stay_in_bounds() {
        let mut s = Screen::default();
        s.resize(4, 2);
        s.blit(Rect { x: 1, y: 0, width: 2, height: 1 }, &[1, 1, 1, 1, 2, 2, 2, 2]);
        assert_eq!(&s.bgra[4..12], &[1, 1, 1, 1, 2, 2, 2, 2]);
        s.copy(Rect { x: 1, y: 1, width: 2, height: 1 }, Rect { x: 1, y: 0, width: 2, height: 1 });
        assert_eq!(&s.bgra[20..28], &[1, 1, 1, 1, 2, 2, 2, 2]);
        // Out-of-range rectangles are clipped or ignored.
        s.blit(Rect { x: 3, y: 1, width: 4, height: 4 }, &[9; 64]);
        s.copy(Rect { x: 3, y: 1, width: 4, height: 4 }, Rect { x: 0, y: 0, width: 4, height: 4 });
        assert_eq!(s.bgra.len(), 32);
    }

    /// Our RFB server (behind the allowlist splice) and our client against each other.
    #[cfg(feature = "vnc-server")]
    #[tokio::test]
    async fn client_reads_framebuffer_of_rustvncserver() {
        use rustvncserver::VncServer;
        let (server, mut events) = VncServer::new(8, 4, "t".into(), Some("pw".into()));
        let mut rgba = vec![0u8; 8 * 4 * 4];
        rgba[0..4].copy_from_slice(&[10, 20, 30, 255]);
        server.framebuffer().update_from_slice(&rgba).await.unwrap();
        let server = Arc::new(server);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        // Reverse session dialled to our listener, as the allowlist splice does.
        let srv = Arc::clone(&server);
        tokio::spawn(async move {
            let _ = srv.connect_reverse("127.0.0.1".into(), port).await;
        });
        let (stream, _) = listener.accept().await.unwrap();
        let front = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = front.local_addr().unwrap().to_string();
        tokio::spawn(async move {
            let (mut outer, _) = front.accept().await.unwrap();
            let mut inner = stream;
            let _ = tokio::io::copy_bidirectional(&mut outer, &mut inner).await;
        });
        let session = VncSession::connect(&addr, Some("pw".into())).await.unwrap();
        assert_eq!(session.size().await, (8, 4));
        let (_, _, bgra) = session.frame().await.unwrap();
        assert_eq!(&bgra[0..3], &[30, 20, 10], "{:?}", &bgra[0..16]);
        session.click(3, 2, MouseButton::Left, 1).await.unwrap();
        session.keypress("ctrl+a").await.unwrap();
        let mut saw_pointer = false;
        let mut saw_key = false;
        let deadline = Instant::now() + Duration::from_secs(5);
        while !(saw_pointer && saw_key) && Instant::now() < deadline {
            if let Ok(Some(ev)) = tokio::time::timeout(Duration::from_millis(200), events.recv()).await {
                match ev {
                    rustvncserver::server::ServerEvent::PointerMove { x: 3, y: 2, .. } => saw_pointer = true,
                    rustvncserver::server::ServerEvent::KeyPress { key: 0xFFE3, down: true, .. } => {
                        saw_key = true;
                    },
                    _ => {},
                }
            }
        }
        assert!(saw_pointer && saw_key);
        let shot = session.screenshot(80, 1).await.unwrap();
        assert_eq!((shot.width, shot.height), (8, 4));
        assert!(shot.jpeg.starts_with(&[0xFF, 0xD8]));
        session.close().await;
    }

    #[tokio::test]
    async fn wrong_password_is_reported() {
        #[cfg(feature = "vnc-server")]
        {
            use rustvncserver::VncServer;
            let (server, _events) = VncServer::new(2, 2, "t".into(), Some("right".into()));
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let server = Arc::new(server);
            let srv = Arc::clone(&server);
            tokio::spawn(async move {
                let _ = srv.connect_reverse("127.0.0.1".into(), port).await;
            });
            let (stream, _) = listener.accept().await.unwrap();
            let front = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = front.local_addr().unwrap().to_string();
            tokio::spawn(async move {
                let (mut outer, _) = front.accept().await.unwrap();
                let mut inner = stream;
                let _ = tokio::io::copy_bidirectional(&mut outer, &mut inner).await;
            });
            let err = VncSession::connect(&addr, Some("wrong".into())).await.err().unwrap();
            assert!(format!("{err:#}").contains("handshake"), "{err:#}");
        }
    }
}
