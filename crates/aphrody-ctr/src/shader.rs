//! Allocation-free little-endian SHBIN views and libctru output-map generation.
//! Layout: <https://www.3dbrew.org/wiki/SHBIN>. Algorithm adapted from retained
//! libctru `source/gpu/shbin.c`; see LICENSE.libctru. No shader execution is implied.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Error {
    Truncated,
    Overflow,
    Magic,
    ShaderType,
    OutputRegister,
}

fn bytes(data: &[u8], offset: usize, length: usize) -> Result<&[u8], Error> {
    data.get(offset..offset.checked_add(length).ok_or(Error::Overflow)?)
        .ok_or(Error::Truncated)
}
fn word(data: &[u8], offset: usize) -> Result<u32, Error> {
    Ok(u32::from_le_bytes(
        bytes(data, offset, 4)?.try_into().unwrap(),
    ))
}
fn table(data: &[u8], base: usize, field: usize, stride: usize) -> Result<&[u8], Error> {
    let offset = base
        .checked_add(word(data, base + field)? as usize)
        .ok_or(Error::Overflow)?;
    let length = (word(data, base + field + 4)? as usize)
        .checked_mul(stride)
        .ok_or(Error::Overflow)?;
    bytes(data, offset, length)
}

#[derive(Clone, Copy, Debug)]
pub struct Binary<'a> {
    data: &'a [u8],
    count: usize,
    program: usize,
}
impl<'a> Binary<'a> {
    /// Validates the shared program and every executable's bounded tables.
    pub fn parse(data: &'a [u8]) -> Result<Self, Error> {
        if bytes(data, 0, 4)? != b"DVLB" {
            return Err(Error::Magic);
        }
        let count = word(data, 4)? as usize;
        let program = count
            .checked_mul(4)
            .and_then(|n| n.checked_add(8))
            .ok_or(Error::Overflow)?;
        bytes(data, 8, program - 8)?;
        if bytes(data, program, 4)? != b"DVLP" {
            return Err(Error::Magic);
        }
        bytes(data, program, 40)?;
        table(data, program, 8, 4)?;
        table(data, program, 16, 8)?;
        let result = Self {
            data,
            count,
            program,
        };
        for index in 0..count {
            result.executable(index)?;
        }
        Ok(result)
    }
    pub fn executable_count(self) -> usize {
        self.count
    }
    pub fn code(self) -> &'a [u8] {
        table(self.data, self.program, 8, 4).unwrap()
    }
    /// Full 64-bit entries; the SDK uploads only the low word to PICA.
    pub fn operand_descriptors(self) -> &'a [u8] {
        table(self.data, self.program, 16, 8).unwrap()
    }
    pub fn executable(self, index: usize) -> Result<Executable<'a>, Error> {
        if index >= self.count {
            return Err(Error::Truncated);
        }
        let base = word(self.data, 8 + index * 4)? as usize;
        let header = bytes(self.data, base, 64)?;
        if &header[..4] != b"DVLE" {
            return Err(Error::Magic);
        }
        if header[6] > 1 {
            return Err(Error::ShaderType);
        }
        let constants = table(self.data, base, 24, 20)?;
        let outputs = table(self.data, base, 40, 8)?;
        let uniforms = table(self.data, base, 48, 8)?;
        let symbols = table(self.data, base, 56, 1)?;
        Ok(Executable {
            header,
            constants,
            outputs,
            uniforms,
            symbols,
        })
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Executable<'a> {
    pub header: &'a [u8],
    pub constants: &'a [u8],
    pub outputs: &'a [u8],
    pub uniforms: &'a [u8],
    pub symbols: &'a [u8],
}
impl Executable<'_> {
    pub fn output_map(self) -> Result<OutputMap, Error> {
        let mut map = OutputMap::default();
        for entry in self.outputs.as_chunks::<8>().0 {
            map.add(
                u16::from_le_bytes([entry[0], entry[1]]),
                u16::from_le_bytes([entry[2], entry[3]]),
                entry[4],
            )?;
        }
        Ok(map)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OutputMap {
    pub mask: u8,
    pub data: [u32; 8],
    pub mode: u32,
    pub clock: u32,
}
impl Default for OutputMap {
    fn default() -> Self {
        Self {
            mask: 0,
            data: [
                0, 0x1f1f1f1f, 0x1f1f1f1f, 0x1f1f1f1f, 0x1f1f1f1f, 0x1f1f1f1f, 0x1f1f1f1f,
                0x1f1f1f1f,
            ],
            mode: 0,
            clock: 0,
        }
    }
}
impl OutputMap {
    /// Matches SDK handling of duplicate registers, unknown types and sparse masks.
    /// Rejects register IDs which would index outside the SDK's seven output slots.
    pub fn add(&mut self, kind: u16, register: u16, mask: u8) -> Result<(), Error> {
        if register >= 7 {
            return Err(Error::OutputRegister);
        }
        let bit = 1 << register;
        if self.mask & bit == 0 {
            self.mask |= bit;
            self.data[0] += 1;
        }
        let (mut semantic, count, clock, texture) = match kind {
            0 => (0, 4, 0, false),
            1 => (4, 4, 1 << 24, false),
            2 => (8, 4, 1 << 1, false),
            3 => (12, 2, 1 << 8, true),
            4 => (16, 1, 1 << 16, true),
            5 => (14, 2, 1 << 9, true),
            6 => (22, 2, 1 << 10, true),
            8 => (18, 3, 1 << 24, false),
            _ => return Ok(()),
        };
        self.clock |= clock;
        if texture {
            self.mode = 1;
        }
        let mut written = 0;
        for component in 0..4 {
            if written == count {
                break;
            }
            if mask & (1 << component) != 0 {
                let output = &mut self.data[register as usize + 1];
                *output = (*output & !(255 << (component * 8))) | (semantic << (component * 8));
                semantic += 1;
                written += 1;
                if kind == 0 && written == 3 {
                    self.clock |= 1;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_every_short_header_and_hostile_counts() {
        for length in 0..8 {
            assert!(Binary::parse(&[0; 8][..length]).is_err());
        }
        let mut data = [0; 12];
        data[..4].copy_from_slice(b"DVLB");
        data[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(Binary::parse(&data).is_err());
    }
    #[test]
    fn minimal_program_is_unaligned_safe_and_bounded() {
        let mut storage = [0; 117];
        let data = &mut storage[1..];
        data[..4].copy_from_slice(b"DVLB");
        data[4] = 1;
        data[8] = 52;
        data[12..16].copy_from_slice(b"DVLP");
        data[52..56].copy_from_slice(b"DVLE");
        let binary = Binary::parse(data).unwrap();
        assert_eq!(binary.executable_count(), 1);
        assert!(binary.code().is_empty());
        assert_eq!(
            binary.executable(0).unwrap().output_map().unwrap(),
            OutputMap::default()
        );
        for length in 0..116 {
            assert!(Binary::parse(&data[..length]).is_err());
        }
        assert!(binary.executable(1).is_err());
    }
    #[test]
    fn program_and_executable_tables_use_distinct_relative_bases() {
        let mut data = [0; 172];
        data[..4].copy_from_slice(b"DVLB");
        data[4] = 1;
        data[8] = 64;
        data[12..16].copy_from_slice(b"DVLP");
        data[20] = 40; // Code at absolute 52.
        data[24] = 1;
        data[28] = 44; // Descriptor at absolute 56.
        data[32] = 1;
        data[52..56].copy_from_slice(&0xabcdef01_u32.to_le_bytes());
        data[56..64].copy_from_slice(&0x123456789abcdef0_u64.to_le_bytes());
        data[64..68].copy_from_slice(b"DVLE");
        data[70] = 1; // Geometry shader.
        data[88] = 64;
        data[92] = 1; // Constant.
        data[104] = 84;
        data[108] = 1; // Output.
        data[112] = 92;
        data[116] = 1; // Uniform.
        data[120] = 100;
        data[124] = 8; // Symbols.
        data[148] = 2;
        data[150] = 3;
        data[152] = 15;
        data[164..172].copy_from_slice(b"uniform\0");
        let parsed = Binary::parse(&data).unwrap();
        assert_eq!(parsed.code(), &data[52..56]);
        assert_eq!(parsed.operand_descriptors(), &data[56..64]);
        let executable = parsed.executable(0).unwrap();
        assert_eq!(executable.constants.len(), 20);
        assert_eq!(executable.uniforms.len(), 8);
        assert_eq!(executable.symbols, b"uniform\0");
        assert_eq!(executable.output_map().unwrap().data[4], 0x0b0a0908);
        data[108..112].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(Binary::parse(&data).is_err());
    }
    #[test]
    fn sparse_position_and_duplicate_texture() {
        let mut map = OutputMap::default();
        map.add(0, 0, 0b1101).unwrap();
        assert_eq!(map.data[1], 0x02011f00);
        assert_eq!(map.clock, 1);
        map.add(3, 0, 3).unwrap();
        assert_eq!(map.data[0], 1);
        assert_eq!(map.mode, 1);
        let before = map;
        assert_eq!(map.add(0, 7, 15), Err(Error::OutputRegister));
        assert_eq!(map, before);
    }
}
