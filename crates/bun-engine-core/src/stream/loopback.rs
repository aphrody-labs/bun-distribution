//! Loopback self-test host: a synthetic NV12 test pattern encoded with Media Foundation H.264,
//! packetized with the same RTP/NV headers and Reed-Solomon FEC a GameStream host uses, and sent
//! over UDP on 127.0.0.1 (optionally dropping packets to exercise FEC recovery).

use std::{
    net::{SocketAddr, UdpSocket},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use super::{encode::Encoder, video::Packetizer};

const SLOTS: usize = 4096;

/// Capture and encode timestamps shared with the client side of the same process.
pub struct Clock {
    pub epoch: Instant,
    capture: Vec<AtomicU64>,
    encode: Vec<AtomicU64>,
}

impl Clock {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            epoch: Instant::now(),
            capture: (0..SLOTS).map(|_| AtomicU64::new(0)).collect(),
            encode: (0..SLOTS).map(|_| AtomicU64::new(0)).collect(),
        })
    }

    pub fn capture_of(&self, index: u32) -> Option<Instant> {
        let ns = self.capture[index as usize % SLOTS].load(Ordering::Acquire);
        (ns != 0).then(|| self.epoch + Duration::from_nanos(ns))
    }

    pub fn encode_ms(&self, index: u32) -> Option<f64> {
        let ns = self.encode[index as usize % SLOTS].load(Ordering::Acquire);
        (ns != 0).then(|| ns as f64 / 1e6)
    }
}

fn yuv(r: f32, g: f32, b: f32) -> (u8, u8, u8) {
    let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let cb = (b - y) / 1.8556;
    let cr = (r - y) / 1.5748;
    (
        (16.0 + 219.0 * y).round() as u8,
        (128.0 + 224.0 * cb).round() as u8,
        (128.0 + 224.0 * cr).round() as u8,
    )
}

/// Moving SMPTE-like bars, a gradient, a 1-pixel checker band, a moving box and a frame counter.
pub struct Pattern {
    width: usize,
    height: usize,
    bars_y: Vec<u8>,
    bars_uv: Vec<u8>,
    frame: Vec<u8>,
}

const SEGMENTS: [u8; 10] = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F];

impl Pattern {
    pub fn new(width: u32, height: u32) -> Self {
        let (w, h) = (width as usize, height as usize);
        let colors = [
            (1.0, 1.0, 1.0),
            (1.0, 1.0, 0.0),
            (0.0, 1.0, 1.0),
            (0.0, 1.0, 0.0),
            (1.0, 0.0, 1.0),
            (1.0, 0.0, 0.0),
            (0.0, 0.0, 1.0),
            (0.1, 0.1, 0.1),
        ];
        let mut bars_y = vec![0u8; w];
        let mut bars_uv = vec![0u8; w];
        for x in 0..w {
            let (r, g, b) = colors[x * colors.len() / w];
            let (y, u, v) = yuv(r * 0.75, g * 0.75, b * 0.75);
            bars_y[x] = y;
            if x % 2 == 0 {
                bars_uv[x] = u;
                bars_uv[x + 1] = v;
            }
        }
        Self {
            width: w,
            height: h,
            bars_y,
            bars_uv,
            frame: vec![0u8; w * h * 3 / 2],
        }
    }

    fn rect(&mut self, x0: usize, y0: usize, w: usize, h: usize, (y, u, v): (u8, u8, u8)) {
        let (fw, fh) = (self.width, self.height);
        for yy in y0.min(fh)..(y0 + h).min(fh) {
            self.frame[yy * fw + x0.min(fw)..yy * fw + (x0 + w).min(fw)].fill(y);
        }
        let uv = fw * fh;
        for yy in (y0 / 2).min(fh / 2)..((y0 + h) / 2).min(fh / 2) {
            for xx in (x0 / 2).min(fw / 2)..((x0 + w) / 2).min(fw / 2) {
                self.frame[uv + yy * fw + xx * 2] = u;
                self.frame[uv + yy * fw + xx * 2 + 1] = v;
            }
        }
    }

    fn digit(&mut self, x: usize, y: usize, s: usize, d: usize) {
        let on = SEGMENTS[d % 10];
        let t = s / 5;
        let white = (235, 128, 128);
        let segs = [
            (x, y, s, t),
            (x + s - t, y, t, s),
            (x + s - t, y + s, t, s),
            (x, y + 2 * s - t, s, t),
            (x, y + s, t, s),
            (x, y, t, s),
            (x, y + s - t / 2, s, t),
        ];
        for (i, &(rx, ry, rw, rh)) in segs.iter().enumerate() {
            if on & (1 << i) != 0 {
                self.rect(rx, ry, rw, rh, white);
            }
        }
    }

    /// NV12 frame `n`.
    pub fn render(&mut self, n: u64) -> &[u8] {
        let (w, h) = (self.width, self.height);
        let shift = (n as usize * 6) % w & !1;
        let bars_end = h * 2 / 3;
        for y in 0..h {
            let row = &mut self.frame[y * w..(y + 1) * w];
            if y < bars_end {
                row[..w - shift].copy_from_slice(&self.bars_y[shift..]);
                row[w - shift..].copy_from_slice(&self.bars_y[..shift]);
            } else if y < bars_end + h / 12 {
                // 1-pixel checkerboard: the sharpest detail the upscaler has to keep.
                for (x, p) in row.iter_mut().enumerate() {
                    *p = if (x + y) % 2 == 0 { 235 } else { 16 };
                }
            } else {
                for (x, p) in row.iter_mut().enumerate() {
                    *p = (16 + x * 219 / w) as u8;
                }
            }
        }
        let uv = w * h;
        for y in 0..h / 2 {
            let row = &mut self.frame[uv + y * w..uv + (y + 1) * w];
            if y * 2 < bars_end {
                row[..w - shift].copy_from_slice(&self.bars_uv[shift..]);
                row[w - shift..].copy_from_slice(&self.bars_uv[..shift]);
            } else {
                row.fill(128);
            }
        }
        // A box bouncing across the frame.
        let size = h / 6;
        let period_x = (w - size) * 2;
        let period_y = (h - size) * 2;
        let px = (n as usize * 9) % period_x;
        let py = (n as usize * 5) % period_y;
        let bx = if px < w - size { px } else { period_x - px };
        let by = if py < h - size { py } else { period_y - py };
        self.rect(bx & !1, by & !1, size, size, yuv(1.0, 0.45, 0.0));
        // Frame counter.
        let s = h / 14;
        let mut value = n;
        for i in 0..6 {
            let x = w - (i + 1) * (s + s / 2) - s;
            self.digit(x, s / 2, s, (value % 10) as usize);
            value /= 10;
        }
        &self.frame
    }
}

pub struct Config {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub packet_size: usize,
    pub fec_percent: usize,
    pub loss_percent: f32,
}

/// Run the synthetic host until `stop`; packets go to `dest`.
pub fn run(
    config: Config,
    dest: SocketAddr,
    clock: Arc<Clock>,
    force_idr: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
    sent: Arc<AtomicU64>,
) -> Result<(), String> {
    let mut encoder = Encoder::new(config.width, config.height, config.fps, config.bitrate_kbps)?;
    let mut packetizer = Packetizer::new(None);
    let mut pattern = Pattern::new(config.width, config.height);
    let socket = UdpSocket::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let period = Duration::from_secs_f64(1.0 / f64::from(config.fps));
    let mut next = Instant::now();
    let mut rng = 0x9E37_79B9_7F4A_7C15u64;
    let threshold =
        (f64::from(config.loss_percent.clamp(0.0, 100.0)) / 100.0 * u64::MAX as f64) as u64;
    let mut n: u64 = 0;
    while !stop.load(Ordering::Relaxed) {
        let now = Instant::now();
        if now < next {
            std::thread::sleep(next - now);
        }
        next += period;
        let captured = Instant::now();
        let index = n as u32;
        clock.capture[index as usize % SLOTS].store(
            captured.duration_since(clock.epoch).as_nanos() as u64,
            Ordering::Release,
        );
        let nv12 = pattern.render(n);
        let idr = n == 0 || force_idr.swap(false, Ordering::AcqRel);
        let units = encoder.encode(nv12, idr)?;
        clock.encode[index as usize % SLOTS]
            .store(captured.elapsed().as_nanos() as u64, Ordering::Release);
        let rtp = (n * 90_000 / u64::from(config.fps)) as u32;
        for (au, key) in units {
            let latency = (captured.elapsed().as_secs_f64() * 10_000.0) as u16;
            for shard in packetizer.packetize(
                &au,
                key,
                config.packet_size,
                2,
                config.fec_percent,
                index,
                rtp,
                latency,
            ) {
                rng ^= rng << 13;
                rng ^= rng >> 7;
                rng ^= rng << 17;
                if threshold > 0 && rng < threshold {
                    continue;
                }
                let _ = socket.send_to(&shard, dest);
                sent.fetch_add(1, Ordering::Relaxed);
            }
        }
        n += 1;
    }
    Ok(())
}
