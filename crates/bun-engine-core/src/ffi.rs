use crate::binary::{Architecture, BinaryFamily, BinaryFormat, Endianness, inspect_binary};

pub const ABI_VERSION: u32 = 1;

#[repr(C)]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BunEngineBinaryInfo {
    pub abi_version: u32,
    pub format: u32,
    pub family: u32,
    pub architecture: u32,
    pub bits: u8,
    pub endianness: u8,
}

#[unsafe(no_mangle)]
pub extern "C" fn bun_engine_abi_version() -> u32 {
    ABI_VERSION
}

/// Inspects a caller-owned byte slice and writes one plain C result.
///
/// # Safety
///
/// `data` must reference `length` readable bytes for the duration of the call,
/// and `output` must reference one writable `BunEngineBinaryInfo`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_engine_inspect(
    data: *const u8,
    length: usize,
    output: *mut BunEngineBinaryInfo,
) -> i32 {
    if data.is_null() || output.is_null() {
        return -1;
    }
    let bytes = unsafe { std::slice::from_raw_parts(data, length) };
    let inspection = inspect_binary(bytes);
    let result = BunEngineBinaryInfo {
        abi_version: ABI_VERSION,
        format: format_id(inspection.format),
        family: family_id(inspection.family),
        architecture: inspection.architecture.map_or(0, architecture_id),
        bits: inspection.bits.unwrap_or_default(),
        endianness: inspection.endianness.map_or(0, |value| match value {
            Endianness::Little => 1,
            Endianness::Big => 2,
        }),
    };
    unsafe { output.write(result) };
    0
}

fn format_id(value: BinaryFormat) -> u32 {
    value as u32 + 1
}

fn family_id(value: BinaryFamily) -> u32 {
    value as u32 + 1
}

fn architecture_id(value: Architecture) -> u32 {
    match value {
        Architecture::X86 => 1,
        Architecture::X86_64 => 2,
        Architecture::Arm => 3,
        Architecture::Aarch64 => 4,
        Architecture::Mips => 5,
        Architecture::PowerPc => 6,
        Architecture::PowerPc64 => 7,
        Architecture::RiscV32 => 8,
        Architecture::RiscV64 => 9,
        Architecture::S390x => 10,
        Architecture::Sparc => 11,
        Architecture::Itanium => 12,
        Architecture::WebAssembly32 => 13,
        Architecture::Unknown(machine) => 0x1_0000 + u32::from(machine),
    }
}
