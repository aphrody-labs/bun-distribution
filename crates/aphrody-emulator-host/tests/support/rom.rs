//! Original, source-generated homebrew; no Nintendo logo, BIOS or proprietary code.
//! Each ARM CPU executes MOV r0,#0; ADD r0,r0,#1; B ADD forever.
pub fn counter_rom() -> Vec<u8> {
    let mut rom = vec![0; 0x1000];
    rom[..12].copy_from_slice(b"IECODE TEST ");
    rom[12..16].copy_from_slice(b"IECT");
    for (offset, value) in [
        (0x20, 0x200_u32),
        (0x24, 0x0200_0000),
        (0x28, 0x0200_0000),
        (0x2c, 12),
        (0x30, 0x300),
        (0x34, 0x0380_0000),
        (0x38, 0x0380_0000),
        (0x3c, 12),
        (0x80, 0x1000),
        (0x84, 0x200),
    ] {
        rom[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }
    for offset in [0x200, 0x300] {
        for (index, word) in [0xe3a0_0000_u32, 0xe280_0001, 0xeaff_fffd].into_iter().enumerate() {
            rom[offset + index * 4..offset + index * 4 + 4].copy_from_slice(&word.to_le_bytes());
        }
    }
    rom
}

/// Guest MMIO writes establish red engine A and blue engine B backdrops.
/// POWCNT1/DISPCNT/palette addresses follow GBATEK DS video/power control.
pub fn backdrop_rom() -> Vec<u8> {
    let mut rom = counter_rom();
    let mut program = Vec::new();
    let mut literals = Vec::new();
    let load = |register, value, program: &mut Vec<u32>, literals: &mut Vec<(usize, u32, u32)>| {
        literals.push((program.len(), register, value));
        program.push(0);
    };
    for (address, value, halfword) in [
        (0x0400_0304, 0x8203, true),
        (0x0400_0000, 0x1_0000, false),
        (0x0400_1000, 0x1_0000, false),
        (0x0500_0000, 0x001f, true),
        (0x0500_0400, 0x7c00, true),
    ] {
        load(1, address, &mut program, &mut literals);
        load(2, value, &mut program, &mut literals);
        program.push(if halfword { 0xe1c1_20b0 } else { 0xe581_2000 });
    }
    program.extend([0xe3a0_0000, 0xe280_0001, 0xeaff_fffd]);
    for (instruction, register, value) in literals {
        let displacement = (program.len() * 4 - (instruction * 4 + 8)) as u32;
        program[instruction] = 0xe59f_0000 | (register << 12) | displacement;
        program.push(value);
    }
    assert!(0x200 + program.len() * 4 < 0x300);
    rom[0x2c..0x30].copy_from_slice(&(program.len() as u32 * 4).to_le_bytes());
    for (index, word) in program.into_iter().enumerate() {
        rom[0x200 + index * 4..0x204 + index * 4].copy_from_slice(&word.to_le_bytes());
    }
    rom
}
