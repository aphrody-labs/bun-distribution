// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
// End-to-end proof: a real llama.cpp process, real GGUF weights, a real image.
//
// This is the only test in the crate that can tell whether the prompts, the
// flags and the parsers actually agree with the model. Every unit test above it
// asserts about strings the model *might* produce; this one asserts about
// strings it did.
//
// It skips — loudly, not silently — when the runtime or the weights are absent,
// because a developer machine without a 351 MiB checkpoint is a normal machine,
// and a red test there teaches people to ignore red tests.

use std::path::Path;

use aphrody_vision::{Describer, Description, PageText, VisionMode, VisionOptions};

const MODEL: &str = "granite-docling-258m";

/// Build a describer, or explain why the test is being skipped.
fn describer(mode: VisionMode) -> Option<Describer> {
    let mut options = VisionOptions::new(MODEL, mode);
    options.keep_raw = true;
    match Describer::new(options) {
        Ok(describer) => Some(describer),
        Err(error) => {
            eprintln!("SKIP: {error}");
            None
        }
    }
}

/// A 900x300 page with three lines of text, drawn without a font renderer.
///
/// Glyphs are painted as filled rectangles from a tiny 5x7 bitmap set. A real
/// TrueType rasteriser would be a dependency this crate does not otherwise
/// need, and the model only has to be shown *something legible* for the run to
/// prove the plumbing.
fn write_test_page(path: &Path) {
    let mut page = image::RgbImage::from_pixel(900, 300, image::Rgb([255, 255, 255]));
    for (row, text) in ["APHRODY", "VISION", "2026"].iter().enumerate() {
        draw_text(&mut page, text, 60, 50 + row as u32 * 70, 5);
    }
    page.save(path).expect("write test page");
}

/// Paint a string with the 5x7 bitmap font below.
fn draw_text(image: &mut image::RgbImage, text: &str, x: u32, y: u32, scale: u32) {
    let mut pen = x;
    for ch in text.chars() {
        if let Some(glyph) = glyph(ch) {
            for (row, bits) in glyph.iter().enumerate() {
                for col in 0..5_u32 {
                    if bits & (1 << (4 - col)) != 0 {
                        fill(image, pen + col * scale, y + row as u32 * scale, scale);
                    }
                }
            }
        }
        pen += 6 * scale;
    }
}

/// Fill one `scale`-sized black square.
fn fill(image: &mut image::RgbImage, x: u32, y: u32, scale: u32) {
    for dy in 0..scale {
        for dx in 0..scale {
            if x + dx < image.width() && y + dy < image.height() {
                image.put_pixel(x + dx, y + dy, image::Rgb([0, 0, 0]));
            }
        }
    }
}

/// A 5x7 bitmap for the characters this test draws.
fn glyph(ch: char) -> Option<[u8; 7]> {
    Some(match ch {
        'A' => [
            0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001,
        ],
        'P' => [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000,
        ],
        'H' => [
            0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001,
        ],
        'R' => [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001,
        ],
        'O' => [
            0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110,
        ],
        'D' => [
            0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110,
        ],
        'Y' => [
            0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100,
        ],
        'V' => [
            0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100,
        ],
        'I' => [
            0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111,
        ],
        'S' => [
            0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110,
        ],
        'N' => [
            0b10001, 0b11001, 0b10101, 0b10101, 0b10011, 0b10001, 0b10001,
        ],
        '2' => [
            0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111,
        ],
        '0' => [
            0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110,
        ],
        '6' => [
            0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110,
        ],
        _ => return None,
    })
}

#[test]
fn full_page_ocr_reads_a_generated_page_and_locates_it() {
    let Some(describer) = describer(VisionMode::FullPageOcr) else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let page = dir.path().join("page.png");
    write_test_page(&page);

    let report = describer.describe(&page).expect("describe");
    eprintln!("binary : {}", describer.binary().display());
    eprintln!("raw    : {}", report.raw.as_deref().unwrap_or("<none>"));

    let Description::Page { text } = &report.description else {
        panic!(
            "full-page OCR must report a page verdict, got {:?}",
            report.description
        );
    };
    // Either verdict is legitimate on a synthetic page; what must NOT happen is
    // a description of the image being filed as its transcription.
    match text {
        PageText::Text { markdown } => {
            assert!(!markdown.is_empty());
            assert!(markdown.contains("APHRODY"), "{markdown}");
            eprintln!("page   : {markdown}");
        }
        PageText::None => eprintln!("page   : <no text>"),
    }
    assert!(report.elapsed_ms > 0);
}

#[test]
fn dense_region_returns_boxes_from_a_real_model() {
    let Some(describer) = describer(VisionMode::DenseRegion) else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let page = dir.path().join("page.png");
    write_test_page(&page);

    let report = describer.describe(&page).expect("describe");
    let Description::Regions { regions } = &report.description else {
        panic!(
            "dense-region must report regions, got {:?}",
            report.description
        );
    };
    eprintln!("raw    : {}", report.raw.as_deref().unwrap_or("<none>"));
    for region in regions {
        eprintln!(
            "region : {:<24} {:?} {}",
            region.label, region.bbox, region.text
        );
    }

    // Measured on granite-docling-258m b10549: the three drawn lines come back
    // as three `<text>` blocks. Asserting on the first one keeps the test
    // honest without pinning the model's exact block count, which a future
    // build may legitimately change.
    assert!(
        !regions.is_empty(),
        "the model located nothing on a page of text"
    );
    assert!(
        regions.iter().any(|region| region.text.contains("APHRODY")),
        "expected the drawn text back, got {regions:?}"
    );

    // Every box the model emitted must be inside the image, or the coordinate
    // scale is wrong and every overlay drawn from it would be wrong too.
    for bbox in regions.iter().filter_map(|region| region.bbox) {
        for edge in [bbox.x0, bbox.y0, bbox.x1, bbox.y1] {
            assert!((0.0..=1.0).contains(&edge), "{bbox:?}");
        }
    }
}

#[test]
fn a_document_model_refuses_a_caption_without_any_runtime() {
    // No skip: this must hold on a machine with neither llama.cpp nor weights,
    // which is the whole point of gating before resolution.
    let error = Describer::new(VisionOptions::new(MODEL, VisionMode::Caption))
        .err()
        .expect("a document model must refuse to caption");
    assert!(error.to_string().contains("smolvlm-500m-q8"), "{error}");
}
