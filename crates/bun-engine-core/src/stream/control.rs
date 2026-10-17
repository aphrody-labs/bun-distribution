//! GameStream control stream over ENet (rusty_enet): start/IDR requests, periodic pings, input
//! forwarding and host messages, with Sunshine's AES-128-GCM "control v2" framing.
//!
//! The framing and message types follow Moonshine's `session/stream/control/mod.rs`
//! (BSD-2-Clause, Copyright (c) 2024, Hans Gaiser), mirrored for the client direction
//! (client IVs end in "CC", host IVs in "HC").

use std::{
    net::{SocketAddr, UdpSocket},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{Receiver, TryRecvError},
    },
    time::{Duration, Instant},
};

use aes_gcm::{
    Aes128Gcm, AesGcm, Key, Nonce, Tag,
    aead::{AeadInPlace, KeyInit, consts::U16, generic_array::GenericArray},
};

/// Control-stream protection negotiated with the host.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Protection {
    /// Hosts older than GameStream 7.1.431.
    None,
    /// NVIDIA's original scheme: AES-128-GCM with a 16-byte IV whose first byte is the sequence.
    Legacy,
    /// Sunshine "control v2": 12-byte IV = LE sequence + direction tag.
    V2,
}

enum Cipher {
    V2(Aes128Gcm),
    Legacy(AesGcm<aes::Aes128, U16>),
}

impl Cipher {
    fn iv(&self, seq: u32, host: bool) -> Vec<u8> {
        match self {
            Self::V2(_) => {
                let mut iv = vec![0u8; 12];
                iv[..4].copy_from_slice(&seq.to_le_bytes());
                iv[10] = if host { b'H' } else { b'C' };
                iv[11] = b'C';
                iv
            }
            Self::Legacy(_) => {
                let mut iv = vec![0u8; 16];
                iv[0] = seq as u8;
                iv
            }
        }
    }

    fn seal(&self, iv: &[u8], data: &mut Vec<u8>) -> [u8; 16] {
        let tag = match self {
            Self::V2(c) => c.encrypt_in_place_detached(Nonce::from_slice(iv), b"", data),
            Self::Legacy(c) => c.encrypt_in_place_detached(GenericArray::from_slice(iv), b"", data),
        };
        tag.expect("AES-GCM").into()
    }

    fn open(&self, iv: &[u8], data: &mut Vec<u8>, tag: &[u8]) -> bool {
        let tag = Tag::from_slice(tag);
        match self {
            Self::V2(c) => c.decrypt_in_place_detached(Nonce::from_slice(iv), b"", data, tag).is_ok(),
            Self::Legacy(c) => c.decrypt_in_place_detached(GenericArray::from_slice(iv), b"", data, tag).is_ok(),
        }
    }
}
use rusty_enet::{EventNoRef, Host, HostSettings, Packet, PeerID};

use super::input::{InputPacket, channel};

const ENCRYPTED: u16 = 0x0001;
const TERMINATION: u16 = 0x0100;
const TERMINATION_EXTENDED: u16 = 0x0109;
const RUMBLE: u16 = 0x010b;
const PING: u16 = 0x0200;
const INPUT: u16 = 0x0206;
const INVALIDATE_REFERENCE_FRAMES: u16 = 0x0301;
const REQUEST_IDR: u16 = 0x0302;
const START_B: u16 = 0x0307;

pub enum Command {
    Input(InputPacket),
    RequestIdr,
    /// Frames [first, last] were lost; the host may re-reference or send an IDR.
    Invalidate(u32, u32),
}

/// Shared control-stream state read by the session.
#[derive(Default)]
pub struct Status {
    pub connected: AtomicBool,
    pub stopped: AtomicBool,
    pub termination: Mutex<Option<String>>,
    pub rtt: Mutex<Duration>,
}

struct Framer {
    cipher: Option<Cipher>,
    sequence: u32,
}

impl Framer {
    fn seal(&mut self, kind: u16, payload: &[u8]) -> Vec<u8> {
        let Some(cipher) = self.cipher.as_ref() else {
            let mut out = kind.to_le_bytes().to_vec();
            out.extend_from_slice(payload);
            return out;
        };
        let mut plain = Vec::with_capacity(4 + payload.len());
        plain.extend_from_slice(&kind.to_le_bytes());
        plain.extend_from_slice(&(payload.len() as u16).to_le_bytes());
        plain.extend_from_slice(payload);
        let seq = self.sequence;
        self.sequence = self.sequence.wrapping_add(1);
        let tag = cipher.seal(&cipher.iv(seq, false), &mut plain);
        let mut out = Vec::with_capacity(8 + 16 + plain.len());
        out.extend_from_slice(&ENCRYPTED.to_le_bytes());
        out.extend_from_slice(&((4 + 16 + plain.len()) as u16).to_le_bytes());
        out.extend_from_slice(&seq.to_le_bytes());
        out.extend_from_slice(&tag);
        out.extend_from_slice(&plain);
        out
    }

    /// (type, payload) of a host message.
    fn open(&self, data: &[u8]) -> Option<(u16, Vec<u8>)> {
        let kind = u16::from_le_bytes(data.get(0..2)?.try_into().ok()?);
        if kind != ENCRYPTED {
            return Some((kind, data.get(4..).unwrap_or_default().to_vec()));
        }
        let cipher = self.cipher.as_ref()?;
        let seq = u32::from_le_bytes(data.get(4..8)?.try_into().ok()?);
        let tag = data.get(8..24)?;
        let mut body = data.get(24..)?.to_vec();
        if !cipher.open(&cipher.iv(seq, true), &mut body, tag) {
            return None;
        }
        let kind = u16::from_le_bytes(body.get(0..2)?.try_into().ok()?);
        Some((kind, body.get(4..).unwrap_or_default().to_vec()))
    }
}

#[cfg(windows)]
fn rumble(controller: u16, low: u16, high: u16) {
    use windows::Win32::UI::Input::XboxController::{XINPUT_VIBRATION, XInputSetState};
    let vibration = XINPUT_VIBRATION { wLeftMotorSpeed: low, wRightMotorSpeed: high };
    // SAFETY: valid pointer to a stack value for the call.
    unsafe {
        XInputSetState(u32::from(controller & 3), &vibration);
    }
}

#[cfg(not(windows))]
fn rumble(_controller: u16, _low: u16, _high: u16) {}

/// Run the control stream until the host terminates the session or `commands` closes.
pub fn run(address: SocketAddr, connect_data: u32, key: [u8; 16], protection: Protection, commands: Receiver<Command>, status: Arc<Status>) {
    let finish = |why: String| {
        *status.termination.lock().unwrap() = Some(why);
        status.stopped.store(true, Ordering::SeqCst);
    };
    let bind: SocketAddr = if address.is_ipv6() { "[::]:0".parse().unwrap() } else { "0.0.0.0:0".parse().unwrap() };
    let socket = match UdpSocket::bind(bind) {
        Ok(s) => s,
        Err(e) => return finish(format!("control socket: {e}")),
    };
    let settings = HostSettings { peer_limit: 1, channel_limit: channel::COUNT, ..Default::default() };
    let mut host = match Host::new(socket, settings) {
        Ok(h) => h,
        Err(e) => return finish(format!("ENet host: {e:?}")),
    };
    let peer: PeerID = match host.connect(address, channel::COUNT, connect_data) {
        Ok(p) => p.id(),
        Err(e) => return finish(format!("ENet connect: {e:?}")),
    };
    let cipher = match protection {
        Protection::None => None,
        Protection::V2 => Some(Cipher::V2(Aes128Gcm::new(Key::<Aes128Gcm>::from_slice(&key)))),
        Protection::Legacy => Some(Cipher::Legacy(AesGcm::<aes::Aes128, U16>::new(GenericArray::from_slice(&key)))),
    };
    let mut framer = Framer { cipher, sequence: 0 };
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut connected = false;
    let mut next_ping = Instant::now();
    loop {
        // Pump ENet; Windows reports ICMP port-unreachable as recv errors, which are transient.
        loop {
            match host.service().map(|e| e.map(|e| e.no_ref())) {
                Ok(Some(EventNoRef::Connect { .. })) => {
                    connected = true;
                    status.connected.store(true, Ordering::SeqCst);
                    let start = [framer.seal(REQUEST_IDR, &[0, 0]), framer.seal(START_B, &[0])];
                    let p = host.peer_mut(peer);
                    for msg in start {
                        let _ = p.send(channel::GENERIC, &Packet::reliable(msg));
                    }
                }
                Ok(Some(EventNoRef::Disconnect { data, .. })) => return finish(format!("host closed the control stream ({data:#x})")),
                Ok(Some(EventNoRef::Receive { packet, .. })) => {
                    if let Some((kind, payload)) = framer.open(packet.data()) {
                        match kind {
                            TERMINATION | TERMINATION_EXTENDED => {
                                let code = payload.get(0..4).map_or(0, |b| u32::from_be_bytes(b.try_into().unwrap()));
                                return finish(format!("host ended the session ({code:#010x})"));
                            }
                            RUMBLE if payload.len() >= 10 => {
                                let at = |i: usize| u16::from_le_bytes([payload[i], payload[i + 1]]);
                                rumble(at(4), at(6), at(8));
                            }
                            _ => {}
                        }
                    }
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
        if !connected && Instant::now() > deadline {
            return finish("the control stream did not connect within 10 s".into());
        }
        if connected {
            *status.rtt.lock().unwrap() = host.peer_mut(peer).round_trip_time();
            if Instant::now() >= next_ping {
                next_ping = Instant::now() + Duration::from_millis(100);
                let mut ping = Vec::with_capacity(8);
                ping.extend_from_slice(&4u32.to_le_bytes());
                ping.extend_from_slice(&0u32.to_le_bytes());
                let msg = framer.seal(PING, &ping);
                let _ = host.peer_mut(peer).send(channel::GENERIC, &Packet::reliable(msg));
            }
            loop {
                match commands.try_recv() {
                    Ok(Command::Input(input)) => {
                        let msg = framer.seal(INPUT, &input.payload);
                        let packet = if input.reliable { Packet::reliable(msg) } else { Packet::unreliable_unsequenced(msg) };
                        let _ = host.peer_mut(peer).send(input.channel, &packet);
                    }
                    Ok(Command::RequestIdr) => {
                        let msg = framer.seal(REQUEST_IDR, &[0, 0]);
                        let _ = host.peer_mut(peer).send(channel::URGENT, &Packet::reliable(msg));
                    }
                    Ok(Command::Invalidate(first, last)) => {
                        let mut body = Vec::with_capacity(24);
                        body.extend_from_slice(&first.to_le_bytes());
                        body.extend_from_slice(&0u32.to_le_bytes());
                        body.extend_from_slice(&last.to_le_bytes());
                        body.extend_from_slice(&[0u8; 12]);
                        let msg = framer.seal(INVALIDATE_REFERENCE_FRAMES, &body);
                        let _ = host.peer_mut(peer).send(channel::URGENT, &Packet::reliable(msg));
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        host.peer_mut(peer).disconnect(0);
                        host.flush();
                        return finish("client closed".into());
                    }
                }
            }
            host.flush();
        }
        std::thread::sleep(Duration::from_millis(1));
    }
}
