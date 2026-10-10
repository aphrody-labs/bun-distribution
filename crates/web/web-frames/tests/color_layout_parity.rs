// SPDX-License-Identifier: Apache-2.0
use aphrody_web_frames::descriptor::extract_color_layout;

#[test]
fn vector_matches_trace_moe_id_020_reference_fixture() {
    let rgb = include_bytes!("fixtures/color-layout-8x8.rgb");
    let vector = extract_color_layout(8, 8, rgb).unwrap();
    assert_eq!(
        vector,
        [
            25, 6, 3, 15, 14, 14, 15, 17, 17, 14, 15, 15, 14, 14, 15, 16, 17, 17, 16, 16, 15, 33,
            15, 13, 17, 18, 17, 37, 2, 30, 12, 9, 11,
        ]
    );
}
