//! Bounded binary-format identification for asset ingestion.
//!
//! This module classifies headers. It does not decode, mount, execute or convert payloads.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryFamily {
    Executable,
    Bytecode,
    Android,
    Rom,
    Archive,
    VirtualFileSystem,
    Firmware,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryFormat {
    Pe,
    Elf,
    WebAssembly,
    Dex,
    Oat,
    Art,
    AndroidApk,
    AndroidAppBundle,
    AndroidApks,
    AndroidApex,
    NintendoDsRom,
    Zip,
    Gzip,
    SevenZip,
    Tar,
    Xz,
    Bzip2,
    CpioNewc,
    SquashFs,
    Iso9660,
    ExtFileSystem,
    Qcow2,
    Vhdx,
    UefiFirmwareVolume,
    FlattenedDeviceTree,
    UBootImage,
    IntelHex,
    Unknown,
}

impl BinaryFormat {
    pub const fn family(self) -> BinaryFamily {
        match self {
            Self::Pe | Self::Elf => BinaryFamily::Executable,
            Self::WebAssembly | Self::Dex | Self::Oat | Self::Art => BinaryFamily::Bytecode,
            Self::AndroidApk | Self::AndroidAppBundle | Self::AndroidApks | Self::AndroidApex => {
                BinaryFamily::Android
            }
            Self::NintendoDsRom => BinaryFamily::Rom,
            Self::Zip
            | Self::Gzip
            | Self::SevenZip
            | Self::Tar
            | Self::Xz
            | Self::Bzip2
            | Self::CpioNewc => BinaryFamily::Archive,
            Self::SquashFs | Self::Iso9660 | Self::ExtFileSystem | Self::Qcow2 | Self::Vhdx => {
                BinaryFamily::VirtualFileSystem
            }
            Self::UefiFirmwareVolume
            | Self::FlattenedDeviceTree
            | Self::UBootImage
            | Self::IntelHex => BinaryFamily::Firmware,
            Self::Unknown => BinaryFamily::Unknown,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Endianness {
    Little,
    Big,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Architecture {
    X86,
    X86_64,
    Arm,
    Aarch64,
    Mips,
    PowerPc,
    PowerPc64,
    RiscV32,
    RiscV64,
    S390x,
    Sparc,
    Itanium,
    WebAssembly32,
    Unknown(u16),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ArchitectureSet(u16);

impl ArchitectureSet {
    const fn bit(architecture: Architecture) -> u16 {
        match architecture {
            Architecture::X86 => 1 << 0,
            Architecture::X86_64 => 1 << 1,
            Architecture::Arm => 1 << 2,
            Architecture::Aarch64 => 1 << 3,
            Architecture::RiscV64 => 1 << 4,
            _ => 0,
        }
    }

    pub const fn contains(self, architecture: Architecture) -> bool {
        self.0 & Self::bit(architecture) != 0
    }

    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }

    pub const fn len(self) -> u32 {
        self.0.count_ones()
    }

    fn insert(&mut self, architecture: Architecture) {
        self.0 |= Self::bit(architecture);
    }

    const fn single(self) -> Option<Architecture> {
        match self.0 {
            1 => Some(Architecture::X86),
            2 => Some(Architecture::X86_64),
            4 => Some(Architecture::Arm),
            8 => Some(Architecture::Aarch64),
            16 => Some(Architecture::RiscV64),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BinaryInspection {
    pub format: BinaryFormat,
    pub family: BinaryFamily,
    pub architecture: Option<Architecture>,
    pub android_abis: ArchitectureSet,
    pub endianness: Option<Endianness>,
    pub bits: Option<u8>,
}

impl BinaryInspection {
    const fn new(
        format: BinaryFormat,
        architecture: Option<Architecture>,
        endianness: Option<Endianness>,
        bits: Option<u8>,
    ) -> Self {
        Self {
            format,
            family: format.family(),
            architecture,
            android_abis: ArchitectureSet(0),
            endianness,
            bits,
        }
    }

    const UNKNOWN: Self = Self::new(BinaryFormat::Unknown, None, None, None);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    Pe,
    Elf,
    WebAssembly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeRequirement {
    WindowsCompatibility,
    UnixCompatibility,
    WebAssemblyRuntime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnsupportedReason {
    BinaryTranslation,
    NonExecutableInput,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputStrategy {
    PassThrough,
    NeedsRuntime(RuntimeRequirement),
    Unsupported(UnsupportedReason),
}

/// Selects an honest packaging/execution strategy; it never implies binary conversion.
pub const fn output_strategy(source: BinaryFormat, target: OutputFormat) -> OutputStrategy {
    match (source, target) {
        (BinaryFormat::Pe, OutputFormat::Pe)
        | (BinaryFormat::Elf, OutputFormat::Elf)
        | (BinaryFormat::WebAssembly, OutputFormat::WebAssembly) => OutputStrategy::PassThrough,
        (BinaryFormat::Pe, OutputFormat::Elf) => {
            OutputStrategy::NeedsRuntime(RuntimeRequirement::WindowsCompatibility)
        }
        (BinaryFormat::Elf, OutputFormat::Pe) => {
            OutputStrategy::NeedsRuntime(RuntimeRequirement::UnixCompatibility)
        }
        (BinaryFormat::WebAssembly, OutputFormat::Pe | OutputFormat::Elf) => {
            OutputStrategy::NeedsRuntime(RuntimeRequirement::WebAssemblyRuntime)
        }
        (BinaryFormat::Pe | BinaryFormat::Elf, OutputFormat::WebAssembly) => {
            OutputStrategy::Unsupported(UnsupportedReason::BinaryTranslation)
        }
        _ => OutputStrategy::Unsupported(UnsupportedReason::NonExecutableInput),
    }
}

/// Inspects only bounded, format-defined header bytes. Unknown and truncated inputs are safe.
pub fn inspect_binary(bytes: &[u8]) -> BinaryInspection {
    inspect_pe(bytes)
        .or_else(|| inspect_elf(bytes))
        .or_else(|| inspect_wasm(bytes))
        .or_else(|| inspect_android_bytecode(bytes))
        .or_else(|| inspect_nds(bytes))
        .or_else(|| inspect_archive(bytes))
        .or_else(|| inspect_vfs(bytes))
        .or_else(|| inspect_firmware(bytes))
        .unwrap_or(BinaryInspection::UNKNOWN)
}

fn inspect_android_bytecode(bytes: &[u8]) -> Option<BinaryInspection> {
    let format = if matches!(bytes.get(..4), Some(b"dex\n" | b"cdex"))
        && bytes.get(4..7)?.iter().all(u8::is_ascii_digit)
        && bytes.get(7) == Some(&0)
    {
        BinaryFormat::Dex
    } else if bytes.get(..4) == Some(b"oat\n")
        && bytes.get(4..7)?.iter().all(u8::is_ascii_digit)
        && bytes.get(7) == Some(&0)
    {
        BinaryFormat::Oat
    } else if bytes.get(..4) == Some(b"art\n")
        && bytes.get(4..7)?.iter().all(u8::is_ascii_digit)
        && bytes.get(7) == Some(&0)
    {
        BinaryFormat::Art
    } else {
        return None;
    };
    Some(BinaryInspection::new(
        format,
        None,
        Some(Endianness::Little),
        None,
    ))
}

fn inspect_pe(bytes: &[u8]) -> Option<BinaryInspection> {
    if bytes.get(..2)? != b"MZ" || bytes.len() < 0x40 {
        return None;
    }
    let pe_offset = read_u32(bytes, 0x3c, Endianness::Little)? as usize;
    if bytes.get(pe_offset..pe_offset.checked_add(6)?)?.get(..4)? != b"PE\0\0" {
        return None;
    }
    let machine = read_u16(bytes, pe_offset + 4, Endianness::Little)?;
    let (architecture, bits) = pe_architecture(machine);
    Some(BinaryInspection::new(
        BinaryFormat::Pe,
        Some(architecture),
        Some(Endianness::Little),
        bits,
    ))
}

fn pe_architecture(machine: u16) -> (Architecture, Option<u8>) {
    match machine {
        0x014c => (Architecture::X86, Some(32)),
        0x8664 => (Architecture::X86_64, Some(64)),
        0x01c0 | 0x01c2 | 0x01c4 => (Architecture::Arm, Some(32)),
        0xaa64 => (Architecture::Aarch64, Some(64)),
        0x0200 => (Architecture::Itanium, Some(64)),
        0x5032 => (Architecture::RiscV32, Some(32)),
        0x5064 => (Architecture::RiscV64, Some(64)),
        other => (Architecture::Unknown(other), None),
    }
}

fn inspect_elf(bytes: &[u8]) -> Option<BinaryInspection> {
    if bytes.get(..4)? != b"\x7fELF" {
        return None;
    }
    let bits = match *bytes.get(4)? {
        1 => 32,
        2 => 64,
        _ => return None,
    };
    let endianness = match *bytes.get(5)? {
        1 => Endianness::Little,
        2 => Endianness::Big,
        _ => return None,
    };
    let machine = read_u16(bytes, 18, endianness)?;
    let architecture = match machine {
        3 => Architecture::X86,
        8 => Architecture::Mips,
        20 => Architecture::PowerPc,
        21 => Architecture::PowerPc64,
        40 => Architecture::Arm,
        43 => Architecture::Sparc,
        50 => Architecture::Itanium,
        62 => Architecture::X86_64,
        183 => Architecture::Aarch64,
        243 if bits == 32 => Architecture::RiscV32,
        243 => Architecture::RiscV64,
        22 => Architecture::S390x,
        other => Architecture::Unknown(other),
    };
    Some(BinaryInspection::new(
        BinaryFormat::Elf,
        Some(architecture),
        Some(endianness),
        Some(bits),
    ))
}

fn inspect_wasm(bytes: &[u8]) -> Option<BinaryInspection> {
    (bytes.get(..8)? == b"\0asm\x01\0\0\0").then_some(BinaryInspection::new(
        BinaryFormat::WebAssembly,
        Some(Architecture::WebAssembly32),
        Some(Endianness::Little),
        Some(32),
    ))
}

fn inspect_nds(bytes: &[u8]) -> Option<BinaryInspection> {
    const LOGO_PREFIX: &[u8] = b"\x24\xff\xae\x51\x69\x9a\xa2\x21\x3d\x84\x82\x0a";
    if bytes.get(0xc0..0xc0 + LOGO_PREFIX.len())? != LOGO_PREFIX {
        return None;
    }
    let game_code = bytes.get(12..16)?;
    let arm9_offset = read_u32(bytes, 0x20, Endianness::Little)?;
    let arm7_offset = read_u32(bytes, 0x30, Endianness::Little)?;
    if !game_code.iter().all(u8::is_ascii_alphanumeric)
        || arm9_offset < 0x200
        || arm7_offset < 0x200
    {
        return None;
    }
    Some(BinaryInspection::new(
        BinaryFormat::NintendoDsRom,
        Some(Architecture::Arm),
        Some(Endianness::Little),
        Some(32),
    ))
}

fn inspect_archive(bytes: &[u8]) -> Option<BinaryInspection> {
    let format = if matches!(
        bytes.get(..4),
        Some(b"PK\x03\x04" | b"PK\x05\x06" | b"PK\x07\x08")
    ) {
        let (format, architectures) = inspect_android_zip(bytes);
        let mut result = BinaryInspection::new(format, architectures.single(), None, None);
        result.android_abis = architectures;
        return Some(result);
    } else if bytes.starts_with(b"\x1f\x8b\x08") {
        BinaryFormat::Gzip
    } else if bytes.starts_with(b"7z\xbc\xaf\x27\x1c") {
        BinaryFormat::SevenZip
    } else if bytes.get(257..262) == Some(b"ustar") {
        BinaryFormat::Tar
    } else if bytes.starts_with(b"\xfd7zXZ\0") {
        BinaryFormat::Xz
    } else if bytes.starts_with(b"BZh") {
        BinaryFormat::Bzip2
    } else if matches!(bytes.get(..6), Some(b"070701" | b"070702")) {
        BinaryFormat::CpioNewc
    } else {
        return None;
    };
    Some(BinaryInspection::new(format, None, None, None))
}

const MAX_ZIP_SCAN_BYTES: usize = 8 * 1024 * 1024;
const MAX_ZIP_ENTRIES: usize = 4096;
const MAX_ZIP_NAME_BYTES: usize = 4096;

fn inspect_android_zip(bytes: &[u8]) -> (BinaryFormat, ArchitectureSet) {
    let scan = &bytes[..bytes.len().min(MAX_ZIP_SCAN_BYTES)];
    let mut cursor = 0;
    let mut entries = 0;
    let mut manifest = false;
    let mut dex = false;
    let mut bundle_config = false;
    let mut bundle_manifest = false;
    let mut toc = false;
    let mut nested_apk = false;
    let mut apex_manifest = false;
    let mut apex_payload = false;
    let mut architectures = ArchitectureSet::default();

    while entries < MAX_ZIP_ENTRIES && cursor + 4 <= scan.len() {
        let Some(relative) = scan[cursor..]
            .windows(4)
            .position(|window| window == b"PK\x03\x04" || window == b"PK\x01\x02")
        else {
            break;
        };
        cursor += relative;
        let central = scan.get(cursor..cursor + 4) == Some(b"PK\x01\x02");
        let fixed = if central { 46 } else { 30 };
        let name_offset = if central { 28 } else { 26 };
        let Some(name_len) = read_u16(scan, cursor + name_offset, Endianness::Little) else {
            break;
        };
        let name_len = usize::from(name_len);
        if name_len > MAX_ZIP_NAME_BYTES {
            cursor += 4;
            continue;
        }
        let Some(name_start) = cursor.checked_add(fixed) else {
            break;
        };
        let Some(name_end) = name_start.checked_add(name_len) else {
            break;
        };
        let Some(name) = scan.get(name_start..name_end) else {
            break;
        };
        classify_android_entry(
            name,
            &mut manifest,
            &mut dex,
            &mut bundle_config,
            &mut bundle_manifest,
            &mut toc,
            &mut nested_apk,
            &mut apex_manifest,
            &mut apex_payload,
            &mut architectures,
        );
        entries += 1;
        cursor = name_end;
    }

    let format = if apex_manifest && apex_payload {
        BinaryFormat::AndroidApex
    } else if toc && nested_apk {
        BinaryFormat::AndroidApks
    } else if bundle_config && bundle_manifest {
        BinaryFormat::AndroidAppBundle
    } else if manifest && dex {
        BinaryFormat::AndroidApk
    } else {
        BinaryFormat::Zip
    };
    (format, architectures)
}

#[allow(clippy::too_many_arguments)]
fn classify_android_entry(
    name: &[u8],
    manifest: &mut bool,
    dex: &mut bool,
    bundle_config: &mut bool,
    bundle_manifest: &mut bool,
    toc: &mut bool,
    nested_apk: &mut bool,
    apex_manifest: &mut bool,
    apex_payload: &mut bool,
    architectures: &mut ArchitectureSet,
) {
    *manifest |= name == b"AndroidManifest.xml";
    *dex |= is_classes_dex(name);
    *bundle_config |= name == b"BundleConfig.pb";
    *bundle_manifest |= name == b"base/manifest/AndroidManifest.xml";
    *toc |= name == b"toc.pb";
    *nested_apk |= name.ends_with(b".apk");
    *apex_manifest |= name == b"apex_manifest.pb" || name == b"apex_manifest.json";
    *apex_payload |= name == b"apex_payload.img";

    let mut segments = name.split(|byte| *byte == b'/');
    let mut previous = segments.next();
    let mut abi = None;
    for segment in segments {
        if previous == Some(b"lib") {
            abi = Some(segment);
            break;
        }
        previous = Some(segment);
    }
    let Some(abi) = abi else {
        return;
    };
    let architecture = match abi {
        b"x86" => Some(Architecture::X86),
        b"x86_64" => Some(Architecture::X86_64),
        b"armeabi" | b"armeabi-v7a" => Some(Architecture::Arm),
        b"arm64-v8a" => Some(Architecture::Aarch64),
        b"riscv64" => Some(Architecture::RiscV64),
        _ => None,
    };
    if let Some(architecture) = architecture {
        architectures.insert(architecture);
    }
}

fn is_classes_dex(name: &[u8]) -> bool {
    let file = name.rsplit(|byte| *byte == b'/').next().unwrap_or(name);
    file == b"classes.dex"
        || file
            .strip_prefix(b"classes")
            .and_then(|value| value.strip_suffix(b".dex"))
            .is_some_and(|number| !number.is_empty() && number.iter().all(u8::is_ascii_digit))
}

fn inspect_vfs(bytes: &[u8]) -> Option<BinaryInspection> {
    let (format, endianness) = if bytes.starts_with(b"hsqs") {
        (BinaryFormat::SquashFs, Some(Endianness::Little))
    } else if bytes.starts_with(b"sqsh") {
        (BinaryFormat::SquashFs, Some(Endianness::Big))
    } else if [0x8001, 0x8801, 0x9001]
        .into_iter()
        .any(|offset| bytes.get(offset..offset + 5) == Some(b"CD001"))
    {
        (BinaryFormat::Iso9660, None)
    } else if bytes.get(1080..1082) == Some(&[0x53, 0xef]) {
        (BinaryFormat::ExtFileSystem, Some(Endianness::Little))
    } else if bytes.starts_with(b"QFI\xfb") {
        (BinaryFormat::Qcow2, Some(Endianness::Big))
    } else if bytes.starts_with(b"vhdxfile") {
        (BinaryFormat::Vhdx, Some(Endianness::Little))
    } else {
        return None;
    };
    Some(BinaryInspection::new(format, None, endianness, None))
}

fn inspect_firmware(bytes: &[u8]) -> Option<BinaryInspection> {
    let (format, endianness) = if bytes.get(0x28..0x2c) == Some(b"_FVH") {
        (BinaryFormat::UefiFirmwareVolume, Some(Endianness::Little))
    } else if bytes.starts_with(b"\xd0\x0d\xfe\xed") {
        (BinaryFormat::FlattenedDeviceTree, Some(Endianness::Big))
    } else if bytes.starts_with(b"\x27\x05\x19\x56") {
        (BinaryFormat::UBootImage, Some(Endianness::Big))
    } else if is_intel_hex(bytes) {
        (BinaryFormat::IntelHex, None)
    } else {
        return None;
    };
    Some(BinaryInspection::new(format, None, endianness, None))
}

fn is_intel_hex(bytes: &[u8]) -> bool {
    let Some(line) = bytes.split(|byte| *byte == b'\n' || *byte == b'\r').next() else {
        return false;
    };
    line.len() >= 11 && line[0] == b':' && line[1..].iter().all(u8::is_ascii_hexdigit)
}

fn read_u16(bytes: &[u8], offset: usize, endianness: Endianness) -> Option<u16> {
    let value: [u8; 2] = bytes.get(offset..offset.checked_add(2)?)?.try_into().ok()?;
    Some(match endianness {
        Endianness::Little => u16::from_le_bytes(value),
        Endianness::Big => u16::from_be_bytes(value),
    })
}

fn read_u32(bytes: &[u8], offset: usize, endianness: Endianness) -> Option<u32> {
    let value: [u8; 4] = bytes.get(offset..offset.checked_add(4)?)?.try_into().ok()?;
    Some(match endianness {
        Endianness::Little => u32::from_le_bytes(value),
        Endianness::Big => u32::from_be_bytes(value),
    })
}
