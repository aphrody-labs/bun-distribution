use aphrody_wii::dol::DolError;
use aphrody_wii_runtime::Wii;

fn fixture() -> Vec<u8> {
    let mut bytes = vec![0; 0x108];
    for (offset, word) in [
        (0, 0x100_u32),
        (0x48, 0x8000_4000),
        (0x90, 8),
        (0xe0, 0x8000_4000),
        (0x100, 0x3863_0001), // addi r3, r3, 1
        (0x104, 0x4bff_fffc), // b -4
    ] {
        bytes[offset..offset + 4].copy_from_slice(&word.to_be_bytes());
    }
    bytes
}

#[test]
fn original_dol_executes_through_broadway_and_scheduler() {
    let mut wii = Wii::with_dol(&fixture()).expect("original fixture is valid");
    wii.gekko.gprs[3] = 0;
    for _ in 0..20 {
        wii.step();
    }
    assert_eq!(wii.gekko.gprs[3], 10);
    assert_eq!(wii.gekko.pc, 0x8000_4000);
    assert!(wii.scheduler.cycles > 0);
}

#[test]
fn malformed_header_is_rejected_before_console_creation() {
    assert!(matches!(Wii::with_dol(&[0; 16]), Err(DolError::TruncatedHeader)));
}

#[test]
fn unmapped_section_and_entry_are_rejected() {
    let mut bytes = fixture();
    bytes[0x48..0x4c].copy_from_slice(&0x8180_0000_u32.to_be_bytes());
    assert!(matches!(Wii::with_dol(&bytes), Err(DolError::OutsideMemory)));
    let mut bytes = fixture();
    bytes[0xe0..0xe4].copy_from_slice(&0x8000_5000_u32.to_be_bytes());
    assert!(matches!(Wii::with_dol(&bytes), Err(DolError::OutsideMemory)));
}
