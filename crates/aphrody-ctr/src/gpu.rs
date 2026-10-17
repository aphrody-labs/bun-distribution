//! GPU command layout: first parameter, header, remaining parameters, 8-byte padding.
//! See 3dbrew GPU/Internal_Registers and the retained libctru gpu.c/gpu.h.

/// SDK-compatible header construction (libctru masks IDs to ten bits).
pub const fn command_header(register: u16, byte_mask: u8, consecutive: bool) -> u32 {
    ((consecutive as u32) << 31) | (((byte_mask as u32) & 15) << 16) | ((register as u32) & 0x3ff)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandError {
    BufferTooSmall,
    LengthOverflow,
    TruncatedCommand,
    UnalignedCommandOffset,
}

/// Append libctru's GPUCMD_Split finalization writes and return the total size.
/// The existing stream must end on an 8-byte command boundary. The returned
/// stream ends on a 16-byte boundary. Capacity errors leave the buffer unchanged.
pub fn finalize_commands(output: &mut [u32], used: usize) -> Result<usize, CommandError> {
    if used & 1 != 0 {
        return Err(CommandError::UnalignedCommandOffset);
    }
    let end = used
        .checked_add(if used & 3 == 0 { 4 } else { 2 })
        .ok_or(CommandError::LengthOverflow)?;
    if end > output.len() {
        return Err(CommandError::BufferTooSmall);
    }
    for command in output[used..end].as_chunks_mut::<2>().0 {
        command[0] = 0x12345678;
        command[1] = command_header(0x10, 15, false);
    }
    Ok(end)
}

/// Encode writes as libctru GPUCMD_Add does, splitting at 256 parameters.
/// An empty input encodes one zero parameter. Failure leaves `output` untouched.
/// `output` contains host u32 words; serialize with `to_le_bytes` for guest memory.
pub fn encode_writes(
    output: &mut [u32],
    register: u16,
    byte_mask: u8,
    consecutive: bool,
    parameters: &[u32],
) -> Result<usize, CommandError> {
    let count = parameters.len().max(1);
    let full = count / 256;
    let tail = count % 256;
    let words = full
        .checked_mul(258)
        .and_then(|n| n.checked_add(if tail == 0 { 0 } else { (tail + 2) & !1 }))
        .ok_or(CommandError::LengthOverflow)?;
    if output.len() < words {
        return Err(CommandError::BufferTooSmall);
    }
    let mut header = command_header(register, byte_mask, consecutive);
    let mut consumed = 0;
    let mut position = 0;
    while consumed < count {
        let chunk = (count - consumed).min(256);
        output[position] = parameters.get(consumed).copied().unwrap_or(0);
        output[position + 1] = header | (((chunk - 1) as u32) << 20);
        for i in 1..chunk {
            output[position + 1 + i] = parameters[consumed + i];
        }
        position += chunk + 1;
        if position & 1 != 0 {
            output[position] = 0;
            position += 1;
        }
        consumed += chunk;
        if consecutive {
            header = header.wrapping_add(chunk as u32);
        }
    }
    Ok(position)
}

/// A decoded write, before peripheral-specific register side effects.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RegisterWrite {
    pub register: u16,
    pub byte_mask: u8,
    pub value: u32,
}

impl RegisterWrite {
    /// Apply enabled bytes while preserving all disabled bytes.
    pub const fn apply(self, previous: u32) -> u32 {
        let mut mask = 0;
        let mut byte = 0;
        while byte < 4 {
            if self.byte_mask & (1 << byte) != 0 {
                mask |= 0xff << (byte * 8);
            }
            byte += 1;
        }
        (previous & !mask) | (self.value & mask)
    }
}

/// Parse guest command words into ordered register writes without allocation.
/// The complete packet, including padding, is checked before its first write.
/// A malformed packet produces one error then terminates the iterator.
pub struct RegisterWrites<'a> {
    words: &'a [u32],
    header: u32,
    parameter: usize,
    count: usize,
}

impl<'a> RegisterWrites<'a> {
    pub const fn new(words: &'a [u32]) -> Self {
        Self {
            words,
            header: 0,
            parameter: 0,
            count: 0,
        }
    }
}

impl Iterator for RegisterWrites<'_> {
    type Item = Result<RegisterWrite, CommandError>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.count == 0 {
            if self.words.is_empty() {
                return None;
            }
            if self.words.len() < 2 {
                self.words = &[];
                return Some(Err(CommandError::TruncatedCommand));
            }
            self.header = self.words[1];
            self.count = ((self.header >> 20) & 255) as usize + 1;
            let packet_words = (self.count + 2) & !1;
            if self.words.len() < packet_words {
                self.words = &[];
                self.count = 0;
                return Some(Err(CommandError::TruncatedCommand));
            }
            self.parameter = 0;
        }
        let i = self.parameter;
        let value = self.words[if i == 0 { 0 } else { i + 1 }];
        let register = (self.header as u16).wrapping_add(if self.header & (1 << 31) != 0 {
            i as u16
        } else {
            0
        });
        self.parameter += 1;
        let result = RegisterWrite {
            register,
            byte_mask: ((self.header >> 16) & 15) as u8,
            value,
        };
        if self.parameter == self.count {
            self.words = &self.words[(self.count + 2) & !1..];
            self.count = 0;
        }
        Some(Ok(result))
    }
}

impl core::iter::FusedIterator for RegisterWrites<'_> {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn documented_3dbrew_sequence() {
        let input = [0xaaaaaaaa, 0x802f011c, 0xbbbbbbbb, 0xcccccccc];
        for (i, write) in RegisterWrites::new(&input).enumerate() {
            let write = write.unwrap();
            assert_eq!(write.register, 0x11c + i as u16);
            assert_eq!(write.byte_mask, 15);
            assert_eq!(write.value, input[if i == 0 { 0 } else { i + 1 }]);
        }
    }

    #[test]
    fn sdk_chunk_boundary_and_padding() {
        let params = core::array::from_fn::<_, 257, _>(|i| i as u32);
        let mut output = [0xffffffff; 260];
        assert_eq!(
            encode_writes(&mut output, 0x100, 15, true, &params),
            Ok(260)
        );
        assert_eq!(output[1], 0x8fff0100);
        assert_eq!(output[257], 0);
        assert_eq!(output[258], 256);
        assert_eq!(output[259], 0x800f0200);
        for (i, write) in RegisterWrites::new(&output).enumerate() {
            let write = write.unwrap();
            assert_eq!(write.register as usize, 0x100 + i);
            assert_eq!(write.value as usize, i);
        }
    }

    #[test]
    fn fixed_register_empty_and_atomic_capacity() {
        let mut output = [99; 4];
        assert_eq!(
            encode_writes(&mut output[..3], 1, 15, false, &[4, 5]),
            Err(CommandError::BufferTooSmall)
        );
        assert_eq!(output, [99; 4]);
        assert_eq!(encode_writes(&mut output, 1, 15, false, &[4, 5]), Ok(4));
        assert_eq!(output, [4, 0x001f0001, 5, 0]);
        assert!(RegisterWrites::new(&output).all(|w| w.unwrap().register == 1));
        assert_eq!(encode_writes(&mut output, 7, 3, false, &[]), Ok(2));
        assert_eq!(&output[..2], &[0, 0x00030007]);
    }

    #[test]
    fn all_byte_masks_preserve_disabled_bytes() {
        for mask in 0..16 {
            let write = RegisterWrite {
                register: 0,
                byte_mask: mask,
                value: 0x44332211,
            };
            let result = write.apply(0xaabbccdd).to_le_bytes();
            for (i, byte) in result.iter().enumerate() {
                assert_eq!(
                    *byte,
                    if mask & (1 << i) != 0 {
                        write.value.to_le_bytes()[i]
                    } else {
                        0xaabbccddu32.to_le_bytes()[i]
                    }
                );
            }
        }
    }

    #[test]
    fn truncation_never_emits_partial_packet() {
        let full = [1, 0x001f0000, 2, 0];
        for length in 1..4 {
            let mut writes = RegisterWrites::new(&full[..length]);
            assert_eq!(writes.next(), Some(Err(CommandError::TruncatedCommand)));
            assert_eq!(writes.next(), None);
        }
        assert_eq!(RegisterWrites::new(&[]).next(), None);
    }
}
