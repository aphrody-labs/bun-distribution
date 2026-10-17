//! Moonlight video transport: RTP + NV video packet headers, Reed-Solomon FEC blocks and the
//! optional AES-128-GCM shard encryption.
//!
//! The packetizer is absorbed from Moonshine (`moonshine-core/src/session/stream/video/
//! packetizer.rs`, BSD-2-Clause, Copyright (c) 2024, Hans Gaiser) and serves the loopback
//! self-test. The receiver is the client side of the same format: it reassembles frames per FEC
//! block, recovers lost data shards and strips the frame header like Moonlight's depacketizer.

use std::collections::{BTreeMap, HashMap};
use std::time::Instant;

use aes_gcm::{
    Aes128Gcm, Key, Nonce, Tag,
    aead::{AeadInPlace, KeyInit},
};

use super::fec::ReedSolomon;

/// Maximum number of shards in one FEC block (data + parity).
pub const MAX_SHARDS: usize = 255;
pub const NV_VIDEO_PACKET_SIZE: usize = 16;
pub const RTP_HEADER_SIZE: usize = 12;
/// The RTP extension word Sunshine/Moonshine emit (`0x90` sets the X bit).
const PADDING_SIZE: usize = 4;
const NV_PACKET_OFFSET: usize = RTP_HEADER_SIZE + PADDING_SIZE;
/// Byte offset of the payload inside a shard.
pub const PAYLOAD_OFFSET: usize = NV_PACKET_OFFSET + NV_VIDEO_PACKET_SIZE;
/// iv(12) + frameNumber(4) + tag(16) in front of every encrypted shard.
pub const ENC_PREFIX_SIZE: usize = 12 + 4 + 16;
const VIDEO_FRAME_HEADER_SIZE: usize = 8;

const FLAG_CONTAINS_PIC_DATA: u8 = 0x1;
const FLAG_EOF: u8 = 0x2;
const FLAG_SOF: u8 = 0x4;

/// Frame type byte of the 8-byte frame header.
pub const FRAME_TYPE_P: u8 = 1;
pub const FRAME_TYPE_IDR: u8 = 2;

fn write_rtp_header(buf: &mut [u8], sequence_number: u16, timestamp: u32) {
    buf[0] = 0x90;
    buf[1] = 0;
    buf[2..4].copy_from_slice(&sequence_number.to_be_bytes());
    buf[4..8].copy_from_slice(&timestamp.to_be_bytes());
    buf[8..12].copy_from_slice(&0u32.to_be_bytes());
}

fn write_nv_video_packet(
    buf: &mut [u8],
    stream_packet_index: u32,
    frame_index: u32,
    flags: u8,
    multi_fec_blocks: u8,
    fec_info: u32,
) {
    buf[0..4].copy_from_slice(&stream_packet_index.to_le_bytes());
    buf[4..8].copy_from_slice(&frame_index.to_le_bytes());
    buf[8] = flags;
    buf[9] = 0;
    buf[10] = 0x10;
    buf[11] = multi_fec_blocks;
    buf[12..16].copy_from_slice(&fec_info.to_le_bytes());
}

/// Server-side packetizer (loopback self-test and protocol reference).
pub struct Packetizer {
    fec_encoders: HashMap<(usize, usize), ReedSolomon>,
    cipher: Option<Aes128Gcm>,
    gcm_iv_counter: u64,
    sequence_number: u32,
}

impl Packetizer {
    pub fn new(key: Option<[u8; 16]>) -> Self {
        Self {
            fec_encoders: HashMap::new(),
            cipher: key.map(|k| Aes128Gcm::new(Key::<Aes128Gcm>::from_slice(&k))),
            gcm_iv_counter: 0,
            sequence_number: 0,
        }
    }

    /// Split one encoded frame into network-ready shards (data then parity, per block).
    #[allow(clippy::too_many_arguments)]
    pub fn packetize(
        &mut self,
        encoded: &[u8],
        key_frame: bool,
        packet_size: usize,
        minimum_fec_packets: usize,
        fec_percentage: usize,
        frame_number: u32,
        rtp_timestamp: u32,
        processing_latency: u16,
    ) -> Vec<Vec<u8>> {
        let payload_size = packet_size - NV_VIDEO_PACKET_SIZE;
        let packet_data_len = VIDEO_FRAME_HEADER_SIZE + encoded.len();
        let last = match packet_data_len % payload_size {
            0 => payload_size,
            n => n,
        };
        let mut header = [0u8; VIDEO_FRAME_HEADER_SIZE];
        header[0] = 0x01;
        header[1..3].copy_from_slice(&processing_latency.to_le_bytes());
        header[3] = if key_frame { FRAME_TYPE_IDR } else { FRAME_TYPE_P };
        header[4..8].copy_from_slice(&(last as u32).to_le_bytes());
        let byte_at = |i: usize| if i < VIDEO_FRAME_HEADER_SIZE { header[i] } else { encoded[i - VIDEO_FRAME_HEADER_SIZE] };

        let shard_size = PAYLOAD_OFFSET + payload_size;
        let nr_data_shards = packet_data_len.div_ceil(payload_size);
        let parity_per_block = MAX_SHARDS * fec_percentage / (100 + fec_percentage);
        let data_per_block = MAX_SHARDS - parity_per_block;
        let nr_blocks = (nr_data_shards - 1) / data_per_block + 1;
        let last_block_index = ((nr_blocks.min(4) as u8) - 1) << 6;
        let mut out = Vec::new();
        for block_index in 0..nr_blocks.min(4) {
            let start = block_index * data_per_block;
            let end = if block_index == 3 { nr_data_shards } else { ((block_index + 1) * data_per_block).min(nr_data_shards) };
            let data = end - start;
            let parity = (data * fec_percentage / 100).max(minimum_fec_packets).min(MAX_SHARDS.saturating_sub(data));
            let pct = parity * 100 / data;
            let mut shards = vec![vec![0u8; shard_size]; data + parity];
            for (i, global) in (start..end).enumerate() {
                let shard = &mut shards[i];
                write_rtp_header(shard, self.sequence_number as u16, rtp_timestamp);
                let mut flags = FLAG_CONTAINS_PIC_DATA;
                if i == 0 {
                    flags |= FLAG_SOF;
                }
                if i == data - 1 {
                    flags |= FLAG_EOF;
                }
                write_nv_video_packet(
                    &mut shard[NV_PACKET_OFFSET..PAYLOAD_OFFSET],
                    self.sequence_number << 8,
                    frame_number,
                    flags,
                    ((block_index as u8) << 4) | last_block_index,
                    (i << 12 | data << 22 | pct << 4) as u32,
                );
                let from = global * payload_size;
                let len = payload_size.min(packet_data_len - from);
                for (k, b) in shard[PAYLOAD_OFFSET..PAYLOAD_OFFSET + len].iter_mut().enumerate() {
                    *b = byte_at(from + k);
                }
                self.sequence_number += 1;
            }
            if parity > 0 {
                let encoder = self
                    .fec_encoders
                    .entry((data, parity))
                    .or_insert_with(|| ReedSolomon::new(data, parity).expect("valid FEC geometry"));
                encoder.encode(&mut shards).expect("uniform shards");
                for p in 0..parity {
                    let shard = &mut shards[data + p];
                    shard[0] = 0x90;
                    shard[1] = 0;
                    shard[2..4].copy_from_slice(&(self.sequence_number as u16).to_be_bytes());
                    let nv = &mut shard[NV_PACKET_OFFSET..PAYLOAD_OFFSET];
                    nv[4..8].copy_from_slice(&frame_number.to_le_bytes());
                    nv[11] = ((block_index as u8) << 4) | last_block_index;
                    nv[12..16].copy_from_slice(&(((data + p) << 12 | data << 22 | pct << 4) as u32).to_le_bytes());
                    self.sequence_number += 1;
                }
            }
            for shard in shards {
                out.push(self.seal(shard, frame_number));
            }
        }
        out
    }

    fn seal(&mut self, mut shard: Vec<u8>, frame_number: u32) -> Vec<u8> {
        let Some(cipher) = self.cipher.as_ref() else { return shard };
        let mut iv = [0u8; 12];
        iv[..8].copy_from_slice(&self.gcm_iv_counter.to_le_bytes());
        iv[11] = b'V';
        self.gcm_iv_counter += 1;
        let tag = cipher
            .encrypt_in_place_detached(Nonce::from_slice(&iv), b"", &mut shard)
            .expect("AES-GCM encrypt");
        let mut packet = Vec::with_capacity(ENC_PREFIX_SIZE + shard.len());
        packet.extend_from_slice(&iv);
        packet.extend_from_slice(&frame_number.to_le_bytes());
        packet.extend_from_slice(&tag);
        packet.extend_from_slice(&shard);
        packet
    }
}

/// One reassembled access unit.
pub struct Frame {
    pub index: u32,
    pub rtp_timestamp: u32,
    pub key_frame: bool,
    /// Host-side processing latency reported by Sunshine-style servers, in 1/10 ms.
    pub host_latency: u16,
    /// Annex B (H.264/HEVC) or OBU (AV1) bitstream.
    pub data: Vec<u8>,
    /// First and last shard arrival.
    pub first_packet: Instant,
    pub completed: Instant,
    /// Data shards rebuilt from parity for this frame.
    pub recovered: u32,
}

struct Block {
    data: usize,
    parity: usize,
    shards: Vec<Option<Vec<u8>>>,
    present: usize,
    done: bool,
}

struct Pending {
    blocks: BTreeMap<u8, Block>,
    last_block: u8,
    rtp_timestamp: u32,
    first_packet: Instant,
    recovered: u32,
}

/// Receive-side statistics.
#[derive(Clone, Copy, Debug, Default)]
pub struct ReceiveStats {
    pub packets: u64,
    pub bytes: u64,
    pub frames: u64,
    pub recovered_shards: u64,
    pub lost_frames: u64,
    pub decrypt_failures: u64,
}

/// Client-side frame reassembly with FEC recovery.
pub struct Depacketizer {
    cipher: Option<Aes128Gcm>,
    decoders: HashMap<(usize, usize), ReedSolomon>,
    pending: BTreeMap<u32, Pending>,
    /// Next frame index expected for in-order delivery.
    next_frame: Option<u32>,
    /// A frame was lost: drop non-IDR frames until the next IDR arrives.
    pub waiting_for_idr: bool,
    pub stats: ReceiveStats,
}

impl Depacketizer {
    pub fn new(key: Option<[u8; 16]>) -> Self {
        Self {
            cipher: key.map(|k| Aes128Gcm::new(Key::<Aes128Gcm>::from_slice(&k))),
            decoders: HashMap::new(),
            pending: BTreeMap::new(),
            next_frame: None,
            waiting_for_idr: true,
            stats: ReceiveStats::default(),
        }
    }

    /// Feed one UDP datagram. Returns completed frames in order; `loss` is set when a frame
    /// had to be dropped (the caller requests an IDR frame).
    pub fn push(&mut self, datagram: &[u8], now: Instant, out: &mut Vec<Frame>, loss: &mut bool) {
        self.stats.packets += 1;
        self.stats.bytes += datagram.len() as u64;
        let shard = match self.cipher.as_ref() {
            Some(cipher) => {
                if datagram.len() < ENC_PREFIX_SIZE + PAYLOAD_OFFSET {
                    return;
                }
                let mut body = datagram[ENC_PREFIX_SIZE..].to_vec();
                let nonce = Nonce::from_slice(&datagram[..12]);
                let tag = Tag::from_slice(&datagram[16..32]);
                if cipher.decrypt_in_place_detached(nonce, b"", &mut body, tag).is_err() {
                    self.stats.decrypt_failures += 1;
                    return;
                }
                body
            }
            None => datagram.to_vec(),
        };
        if shard.len() < PAYLOAD_OFFSET {
            return;
        }
        let rtp_timestamp = u32::from_be_bytes(shard[4..8].try_into().unwrap());
        let nv = &shard[NV_PACKET_OFFSET..PAYLOAD_OFFSET];
        let frame_index = u32::from_le_bytes(nv[4..8].try_into().unwrap());
        let multi = nv[11];
        let fec_info = u32::from_le_bytes(nv[12..16].try_into().unwrap());
        let block_index = (multi >> 4) & 0x3;
        let last_block = (multi >> 6) & 0x3;
        let shard_index = ((fec_info >> 12) & 0x3ff) as usize;
        let data = ((fec_info >> 22) & 0x3ff) as usize;
        let pct = ((fec_info >> 4) & 0xff) as usize;
        if data == 0 {
            return;
        }
        let parity = (data * pct).div_ceil(100);
        if shard_index >= data + parity {
            return;
        }
        if let Some(next) = self.next_frame
            && frame_index.wrapping_sub(next) > u32::MAX / 2
        {
            return; // Late packet of a frame already delivered or dropped.
        }
        let pending = self.pending.entry(frame_index).or_insert_with(|| Pending {
            blocks: BTreeMap::new(),
            last_block,
            rtp_timestamp,
            first_packet: now,
            recovered: 0,
        });
        let block = pending.blocks.entry(block_index).or_insert_with(|| Block {
            data,
            parity,
            shards: vec![None; data + parity],
            present: 0,
            done: false,
        });
        if block.done || block.shards.len() != data + parity || block.shards[shard_index].is_some() {
            return;
        }
        block.shards[shard_index] = Some(shard);
        block.present += 1;
        let data_present = block.shards[..block.data].iter().filter(|s| s.is_some()).count();
        if data_present == block.data {
            block.done = true;
        } else if block.present >= block.data {
            let decoder = self
                .decoders
                .entry((block.data, block.parity))
                .or_insert_with(|| ReedSolomon::new(block.data, block.parity).expect("valid FEC geometry"));
            if decoder.reconstruct_data(&mut block.shards).is_ok() {
                let rebuilt = (block.data - data_present) as u32;
                pending.recovered += rebuilt;
                self.stats.recovered_shards += u64::from(rebuilt);
                block.done = true;
            }
        }
        self.flush(now, out, loss);
    }

    /// Deliver complete frames in order; drop stale incomplete frames.
    fn flush(&mut self, now: Instant, out: &mut Vec<Frame>, loss: &mut bool) {
        loop {
            let Some((&index, pending)) = self.pending.first_key_value() else { return };
            let complete = (0..=pending.last_block).all(|b| pending.blocks.get(&b).is_some_and(|blk| blk.done));
            if complete {
                if let Some(next) = self.next_frame
                    && index != next
                {
                    // An earlier frame never arrived at all.
                    self.stats.lost_frames += u64::from(index.wrapping_sub(next));
                    self.waiting_for_idr = true;
                    *loss = true;
                }
                let pending = self.pending.pop_first().unwrap().1;
                self.next_frame = Some(index.wrapping_add(1));
                if let Some(frame) = assemble(index, pending, now) {
                    if frame.key_frame {
                        self.waiting_for_idr = false;
                    }
                    if !self.waiting_for_idr {
                        self.stats.frames += 1;
                        out.push(frame);
                    }
                }
                continue;
            }
            // Incomplete head frame: give up once a newer frame has completed or it is stale.
            let newer_done = self.pending.iter().skip(1).any(|(_, p)| {
                (0..=p.last_block).all(|b| p.blocks.get(&b).is_some_and(|blk| blk.done))
            });
            let stale = now.duration_since(pending.first_packet).as_millis() > 100;
            if newer_done || stale {
                self.pending.pop_first();
                self.stats.lost_frames += 1;
                self.next_frame = Some(index.wrapping_add(1));
                self.waiting_for_idr = true;
                *loss = true;
                continue;
            }
            return;
        }
    }
}

fn assemble(index: u32, pending: Pending, now: Instant) -> Option<Frame> {
    let mut data = Vec::new();
    let mut payload_size = 0;
    for block in pending.blocks.into_values() {
        for shard in block.shards.into_iter().take(block.data) {
            let shard = shard?;
            payload_size = shard.len() - PAYLOAD_OFFSET;
            data.extend_from_slice(&shard[PAYLOAD_OFFSET..]);
        }
    }
    if data.len() < VIDEO_FRAME_HEADER_SIZE {
        return None;
    }
    let (header_size, host_latency, last_len) = if data[0] == 0x01 {
        (VIDEO_FRAME_HEADER_SIZE, u16::from_le_bytes([data[1], data[2]]), u16::from_le_bytes([data[4], data[5]]) as usize)
    } else {
        (44, 0, 0)
    };
    let key_frame = data[3] == FRAME_TYPE_IDR;
    // Drop the zero padding of the last shard when the server reports its real length.
    if last_len > 0 && last_len < payload_size {
        data.truncate(data.len() - (payload_size - last_len));
    }
    let bitstream = data.split_off(header_size.min(data.len()));
    Some(Frame {
        index,
        rtp_timestamp: pending.rtp_timestamp,
        key_frame,
        host_latency,
        data: bitstream,
        first_packet: pending.first_packet,
        completed: now,
        recovered: pending.recovered,
    })
}
