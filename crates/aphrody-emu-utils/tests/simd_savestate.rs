#![feature(portable_simd)]

use aphrody_emu_utils::{
    PersistentReadSavestate, PersistentWriteSavestate, ReadSavestate, WriteSavestate,
};
use core::simd::Simd;

fn roundtrip<const LANES: usize>() {
    let lanes: [u32; LANES] = core::array::from_fn(|i| 0x12345678 ^ (i as u32 * 0x01010101));
    let mut vector = Simd::from_array(lanes);
    let mut bytes = Vec::new();
    PersistentWriteSavestate::new(&mut bytes).store(&mut vector).unwrap();
    let expected: Vec<_> = lanes.iter().flat_map(|lane| lane.to_le_bytes()).collect();
    assert_eq!(bytes, expected, "persistent SIMD lanes preserve scalar save format");
    let loaded: Simd<u32, LANES> = PersistentReadSavestate::new(&bytes).unwrap().load().unwrap();
    assert_eq!(loaded.to_array(), lanes);
    let mut in_place = Simd::<u32, LANES>::splat(0);
    PersistentReadSavestate::new(&bytes).unwrap().load_into(&mut in_place).unwrap();
    assert_eq!(in_place.to_array(), lanes);
    assert!(
        PersistentReadSavestate::new(&bytes[..bytes.len() - 1])
            .unwrap()
            .load::<Simd<u32, LANES>>()
            .is_err()
    );
}

#[test]
fn portable_simd_preserves_savestate_layout_and_bounds() {
    roundtrip::<1>();
    roundtrip::<2>();
    roundtrip::<4>();
    roundtrip::<8>();
    roundtrip::<16>();
    roundtrip::<32>();
    roundtrip::<64>();
}
