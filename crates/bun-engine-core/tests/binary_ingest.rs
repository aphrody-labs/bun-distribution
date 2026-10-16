use bun_engine::binary::{
    Architecture, BinaryFamily, BinaryFormat, Endianness, OutputFormat, OutputStrategy,
    RuntimeRequirement, UnsupportedReason, inspect_binary, output_strategy,
};

fn zip(entries: &[&[u8]]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for name in entries {
        bytes.extend_from_slice(b"PK\x03\x04");
        bytes.extend_from_slice(&[0; 22]);
        bytes.extend_from_slice(&(name.len() as u16).to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(name);
    }
    bytes
}

fn central_zip(entries: &[&[u8]]) -> Vec<u8> {
    let mut bytes = b"PK\x05\x06padding".to_vec();
    for name in entries {
        bytes.extend_from_slice(b"PK\x01\x02");
        bytes.extend_from_slice(&[0; 24]);
        bytes.extend_from_slice(&(name.len() as u16).to_le_bytes());
        bytes.extend_from_slice(&[0; 16]);
        bytes.extend_from_slice(name);
    }
    bytes
}

fn pe(machine: u16) -> Vec<u8> {
    let mut bytes = vec![0; 0x88];
    bytes[..2].copy_from_slice(b"MZ");
    bytes[0x3c..0x40].copy_from_slice(&0x80u32.to_le_bytes());
    bytes[0x80..0x84].copy_from_slice(b"PE\0\0");
    bytes[0x84..0x86].copy_from_slice(&machine.to_le_bytes());
    bytes
}

fn elf(class: u8, data: u8, machine: u16) -> Vec<u8> {
    let mut bytes = vec![0; 64];
    bytes[..4].copy_from_slice(b"\x7fELF");
    bytes[4] = class;
    bytes[5] = data;
    let encoded = if data == 1 {
        machine.to_le_bytes()
    } else {
        machine.to_be_bytes()
    };
    bytes[18..20].copy_from_slice(&encoded);
    bytes
}

#[test]
fn identifies_executables_and_machine_metadata() {
    let pe = inspect_binary(&pe(0xaa64));
    assert_eq!(pe.format, BinaryFormat::Pe);
    assert_eq!(pe.family, BinaryFamily::Executable);
    assert_eq!(pe.architecture, Some(Architecture::Aarch64));
    assert_eq!(pe.endianness, Some(Endianness::Little));
    assert_eq!(pe.bits, Some(64));

    let elf = inspect_binary(&elf(2, 2, 21));
    assert_eq!(elf.format, BinaryFormat::Elf);
    assert_eq!(elf.architecture, Some(Architecture::PowerPc64));
    assert_eq!(elf.endianness, Some(Endianness::Big));
    assert_eq!(elf.bits, Some(64));

    let wasm = inspect_binary(b"\0asm\x01\0\0\0");
    assert_eq!(wasm.format, BinaryFormat::WebAssembly);
    assert_eq!(wasm.architecture, Some(Architecture::WebAssembly32));
}

#[test]
fn identifies_nds_rom_from_header_invariants() {
    let mut rom = vec![0; 0x200];
    rom[12..16].copy_from_slice(b"ABCD");
    rom[0x20..0x24].copy_from_slice(&0x4000u32.to_le_bytes());
    rom[0x30..0x34].copy_from_slice(&0x8000u32.to_le_bytes());
    rom[0xc0..0xcc].copy_from_slice(b"\x24\xff\xae\x51\x69\x9a\xa2\x21\x3d\x84\x82\x0a");

    let result = inspect_binary(&rom);
    assert_eq!(result.format, BinaryFormat::NintendoDsRom);
    assert_eq!(result.family, BinaryFamily::Rom);
    assert_eq!(result.architecture, Some(Architecture::Arm));
}

#[test]
fn identifies_archives_without_decoding_them() {
    let cases: &[(&[u8], BinaryFormat)] = &[
        (b"PK\x03\x04payload", BinaryFormat::Zip),
        (b"\x1f\x8b\x08payload", BinaryFormat::Gzip),
        (b"7z\xbc\xaf\x27\x1cpayload", BinaryFormat::SevenZip),
        (b"\xfd7zXZ\0payload", BinaryFormat::Xz),
        (b"BZh9payload", BinaryFormat::Bzip2),
        (b"07070100000000", BinaryFormat::CpioNewc),
    ];
    for (bytes, expected) in cases {
        let result = inspect_binary(bytes);
        assert_eq!(result.format, *expected);
        assert_eq!(result.family, BinaryFamily::Archive);
    }

    let mut tar = vec![0; 512];
    tar[257..262].copy_from_slice(b"ustar");
    assert_eq!(inspect_binary(&tar).format, BinaryFormat::Tar);
}

#[test]
fn identifies_android_packages_and_abis_from_bounded_zip_entries() {
    let apk = inspect_binary(&zip(&[
        b"AndroidManifest.xml",
        b"classes2.dex",
        b"lib/arm64-v8a/libengine.so",
        b"lib/x86_64/libengine.so",
    ]));
    assert_eq!(apk.format, BinaryFormat::AndroidApk);
    assert_eq!(apk.family, BinaryFamily::Android);
    assert_eq!(apk.architecture, None);
    assert_eq!(apk.android_abis.len(), 2);
    assert!(apk.android_abis.contains(Architecture::Aarch64));
    assert!(apk.android_abis.contains(Architecture::X86_64));

    assert_eq!(
        inspect_binary(&zip(&[
            b"BundleConfig.pb",
            b"base/manifest/AndroidManifest.xml",
            b"base/dex/classes.dex",
            b"base/lib/riscv64/libengine.so",
        ]))
        .format,
        BinaryFormat::AndroidAppBundle
    );
    assert_eq!(
        inspect_binary(&zip(&[b"toc.pb", b"splits/base-master.apk"])).format,
        BinaryFormat::AndroidApks
    );
    assert_eq!(
        inspect_binary(&zip(&[b"apex_manifest.pb", b"apex_payload.img"])).format,
        BinaryFormat::AndroidApex
    );

    let central = inspect_binary(&central_zip(&[
        b"AndroidManifest.xml",
        b"classes.dex",
        b"lib/x86/libengine.so",
    ]));
    assert_eq!(central.format, BinaryFormat::AndroidApk);
    assert_eq!(central.architecture, Some(Architecture::X86));
}

#[test]
fn identifies_android_runtime_formats_without_guessing_an_isa() {
    for (bytes, expected) in [
        (&b"dex\n035\0rest"[..], BinaryFormat::Dex),
        (&b"cdex001\0rest"[..], BinaryFormat::Dex),
        (&b"oat\n220\0rest"[..], BinaryFormat::Oat),
        (&b"art\n030\0rest"[..], BinaryFormat::Art),
    ] {
        let result = inspect_binary(bytes);
        assert_eq!(result.format, expected);
        assert_eq!(result.family, BinaryFamily::Bytecode);
        assert_eq!(result.architecture, None);
    }
}

#[test]
fn output_matrix_never_claims_magic_binary_conversion() {
    assert_eq!(
        output_strategy(BinaryFormat::Pe, OutputFormat::Pe),
        OutputStrategy::PassThrough
    );
    assert_eq!(
        output_strategy(BinaryFormat::Pe, OutputFormat::Elf),
        OutputStrategy::NeedsRuntime(RuntimeRequirement::WindowsCompatibility)
    );
    assert_eq!(
        output_strategy(BinaryFormat::Elf, OutputFormat::Pe),
        OutputStrategy::NeedsRuntime(RuntimeRequirement::UnixCompatibility)
    );
    assert_eq!(
        output_strategy(BinaryFormat::WebAssembly, OutputFormat::Elf),
        OutputStrategy::NeedsRuntime(RuntimeRequirement::WebAssemblyRuntime)
    );
    assert_eq!(
        output_strategy(BinaryFormat::Elf, OutputFormat::WebAssembly),
        OutputStrategy::Unsupported(UnsupportedReason::BinaryTranslation)
    );
    assert_eq!(
        output_strategy(BinaryFormat::AndroidApk, OutputFormat::Pe),
        OutputStrategy::Unsupported(UnsupportedReason::NonExecutableInput)
    );
}

#[test]
fn identifies_virtual_filesystems_and_disk_images() {
    let mut iso = vec![0; 0x8006];
    iso[0x8001..0x8006].copy_from_slice(b"CD001");
    assert_eq!(inspect_binary(&iso).format, BinaryFormat::Iso9660);

    let mut ext = vec![0; 1082];
    ext[1080..1082].copy_from_slice(&[0x53, 0xef]);
    assert_eq!(inspect_binary(&ext).format, BinaryFormat::ExtFileSystem);

    for (bytes, expected) in [
        (&b"hsqsrest"[..], BinaryFormat::SquashFs),
        (&b"QFI\xfbrest"[..], BinaryFormat::Qcow2),
        (&b"vhdxfilerest"[..], BinaryFormat::Vhdx),
    ] {
        let result = inspect_binary(bytes);
        assert_eq!(result.format, expected);
        assert_eq!(result.family, BinaryFamily::VirtualFileSystem);
    }
}

#[test]
fn identifies_only_firmware_with_defined_signatures() {
    let mut uefi = vec![0; 0x2c];
    uefi[0x28..0x2c].copy_from_slice(b"_FVH");
    assert_eq!(
        inspect_binary(&uefi).format,
        BinaryFormat::UefiFirmwareVolume
    );

    for (bytes, expected) in [
        (
            &b"\xd0\x0d\xfe\xedrest"[..],
            BinaryFormat::FlattenedDeviceTree,
        ),
        (&b"\x27\x05\x19\x56rest"[..], BinaryFormat::UBootImage),
        (
            &b":10010000214601360121470136007EFE09D2190140\n"[..],
            BinaryFormat::IntelHex,
        ),
    ] {
        let result = inspect_binary(bytes);
        assert_eq!(result.format, expected);
        assert_eq!(result.family, BinaryFamily::Firmware);
    }
}

#[test]
fn truncated_or_ambiguous_inputs_remain_unknown() {
    let pe = pe(0x8664);
    for end in 0..0x86 {
        assert_eq!(inspect_binary(&pe[..end]).format, BinaryFormat::Unknown);
    }
    for bytes in [
        b"".as_slice(),
        b"MZ",
        b"\x7fELF\x03\x01",
        b":not-hex",
        b"random firmware",
    ] {
        assert_eq!(inspect_binary(bytes).format, BinaryFormat::Unknown);
    }
}
