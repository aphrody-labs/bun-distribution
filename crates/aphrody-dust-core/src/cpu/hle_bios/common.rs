use crate::{cpu::Engine, emu::Emu, utils::mem_prelude::*};

pub fn div(numer: u32, denom: u32) -> (u32, u32, u32) {
    if denom == 0 {
        // This would get stuck
        (0, numer, 0)
    } else {
        let quot = numer as i32 / denom as i32;
        let rem = numer as i32 % denom as i32;
        (quot as u32, rem as u32, quot.unsigned_abs())
    }
}

pub fn sqrt(mut input: u32) -> u32 {
    let mut bit = 1 << 30;
    let mut result = 0;
    while bit > input {
        bit >>= 2;
    }
    while bit != 0 {
        if input >= result + bit {
            input -= result + bit;
            result = (result >> 1) + bit;
        } else {
            result >>= 1;
        }
        bit >>= 2;
    }
    result
}

static CRC_TABLE: [u16; 16] = [
    0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401, 0xA001, 0x6C00, 0x7800, 0xB401,
    0x5000, 0x9C01, 0x8801, 0x4400,
];

pub fn crc16(init: u32, len: u32, r3: u32, mut f: impl FnMut() -> u16) -> (u32, u32) {
    let mut crc = init as u16;
    let mut value = r3;
    for _ in 0..len {
        value = f() as u32;
        for shift in (0..16).step_by(4) {
            let crc_xor = CRC_TABLE[crc as usize & 0xF];
            crc = crc >> 4 ^ crc_xor ^ CRC_TABLE[(value >> shift & 0xF) as usize];
        }
    }
    (crc as u32, value)
}

pub fn is_debugger<E: Engine, const ADDR: usize>(emu: &Emu<E>) -> (u32, u32, u32) {
    emu.main_mem().write_le::<u16>(
        ADDR & emu.main_mem_mask().get() as usize,
        emu.is_debugger() as u16,
    );
    (
        emu.is_debugger() as u32,
        (emu.is_debugger() as u32) << 2,
        0x027F_FFE0,
    )
}

/// LZ77 (LZSS) decompression, `LZ77UnCompReadNormalWrite8bit`: `src` holds the header word
/// (type 1, size in bits 8..32) followed by flag bytes and tokens.
pub fn lz77_uncomp(
    src: u32,
    dst: u32,
    mut read_8: impl FnMut(u32) -> u8,
    mut write_8: impl FnMut(u32, u8),
) {
    let header = u32::from_le_bytes([
        read_8(src),
        read_8(src + 1),
        read_8(src + 2),
        read_8(src + 3),
    ]);
    let (mut src, mut remaining, mut out) = (src.wrapping_add(4), (header >> 8) as usize, dst);
    while remaining > 0 {
        let flags = read_8(src);
        src = src.wrapping_add(1);
        for bit in (0..8).rev() {
            if remaining == 0 {
                break;
            }
            if flags >> bit & 1 == 0 {
                write_8(out, read_8(src));
                src = src.wrapping_add(1);
                out = out.wrapping_add(1);
                remaining -= 1;
            } else {
                let (b0, b1) = (read_8(src), read_8(src.wrapping_add(1)));
                src = src.wrapping_add(2);
                let len = ((b0 >> 4) as usize + 3).min(remaining);
                let disp = (((b0 & 0xF) as u32) << 8 | b1 as u32) + 1;
                for _ in 0..len {
                    let byte = read_8(out.wrapping_sub(disp));
                    write_8(out, byte);
                    out = out.wrapping_add(1);
                }
                remaining -= len;
            }
        }
    }
}

/// Run-length decompression, `RLUnCompReadNormalWrite8bit` (header type 3).
pub fn rl_uncomp(
    src: u32,
    dst: u32,
    mut read_8: impl FnMut(u32) -> u8,
    mut write_8: impl FnMut(u32, u8),
) {
    let header = u32::from_le_bytes([
        read_8(src),
        read_8(src + 1),
        read_8(src + 2),
        read_8(src + 3),
    ]);
    let (mut src, mut remaining, mut out) = (src.wrapping_add(4), (header >> 8) as usize, dst);
    while remaining > 0 {
        let flag = read_8(src);
        src = src.wrapping_add(1);
        let len = (flag & 0x7F) as usize + if flag & 0x80 != 0 { 3 } else { 1 };
        let len = len.min(remaining);
        if flag & 0x80 != 0 {
            let value = read_8(src);
            src = src.wrapping_add(1);
            for _ in 0..len {
                write_8(out, value);
                out = out.wrapping_add(1);
            }
        } else {
            for _ in 0..len {
                write_8(out, read_8(src));
                src = src.wrapping_add(1);
                out = out.wrapping_add(1);
            }
        }
        remaining -= len;
    }
}

/// 8-bit difference unfilter writing bytes, `Diff8bitUnFilterWrite8bit` (header type 8).
pub fn diff_8_unfilter(
    src: u32,
    dst: u32,
    mut read_8: impl FnMut(u32) -> u8,
    mut write_8: impl FnMut(u32, u8),
) {
    let header = u32::from_le_bytes([
        read_8(src),
        read_8(src + 1),
        read_8(src + 2),
        read_8(src + 3),
    ]);
    let mut value = 0_u8;
    for i in 0..(header >> 8) {
        value = value.wrapping_add(read_8(src.wrapping_add(4 + i)));
        write_8(dst.wrapping_add(i), value);
    }
}
