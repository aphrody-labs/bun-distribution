// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
// Turning a model's answer into regions, with their boxes when it emitted any.
//
// `aphrody-ocr-core`'s DocTags parser deliberately *strips* `<loc_*>` before
// handing back text: a transcription wants prose, not coordinates. Dense-region
// description wants the opposite — the box is half the answer. So this module
// parses the same syntax for the other half rather than changing the OCR
// parser, which several published transcriptions already depend on.
//
// Pure string work: no filesystem, no process.

/// A normalised bounding box, origin top-left, both axes in `0.0..=1.0`.
///
/// Normalised rather than pixels because the caller may not have the image
/// dimensions here, and because `DocTags` coordinates are themselves relative to
/// a fixed 0..500 grid, not to the source resolution.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct BBox {
    /// Left edge.
    pub x0: f32,
    /// Top edge.
    pub y0: f32,
    /// Right edge.
    pub x1: f32,
    /// Bottom edge.
    pub y1: f32,
}

impl BBox {
    /// Fraction of the image area this box covers.
    #[must_use]
    pub fn area(&self) -> f32 {
        ((self.x1 - self.x0) * (self.y1 - self.y0)).abs()
    }
}

/// One described region of an image.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Region {
    /// The structural label the model gave it (`text`, `picture`,
    /// `section_header_level_1`), or `text` when it gave none.
    pub label: String,
    /// What the model said about it.
    pub text: String,
    /// Where it is, when the model said where.
    ///
    /// `None` is honest and common: a chat VLM listing regions in prose has no
    /// coordinates to give, and inventing a full-image box for it would make
    /// a consumer's overlay silently wrong.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bbox: Option<BBox>,
}

/// The `DocTags` coordinate grid: `<loc_0>`..`<loc_500>`.
const LOC_SCALE: f32 = 500.0;
/// The Qwen-VL coordinate grid: 0..=1000.
const QWEN_SCALE: f32 = 1000.0;

/// Parse a model answer into regions.
///
/// Supports:
/// 1. Tagged `DocTags` output (`<text><loc_a><loc_b><loc_c><loc_d>…</text>`)
/// 2. Qwen-VL box markers (`<|box_start|>(ymin, xmin),(ymax, xmax)<|box_end|>` or `[ymin, xmin, ymax, xmax]`)
/// 3. Tagless plain prose answers falling back to one region per line.
#[must_use]
pub fn parse_regions(raw: &str) -> Vec<Region> {
    let qwen_boxes = parse_qwen_boxes(raw);
    if !qwen_boxes.is_empty() {
        return qwen_boxes;
    }

    let cleaned = aphrody_ocr_core::doctags::strip_control_tokens(raw);
    let tagged = parse_tagged(&cleaned);
    if !tagged.is_empty() {
        return tagged;
    }
    // Flattened first: a bare `<doctag></doctag>` is a model that located
    // nothing, and passing the markup through as prose would turn that honest
    // emptiness into a region whose text is a pair of tags.
    parse_lines(&aphrody_ocr_core::doctags::html_to_text(&cleaned))
}

/// Parse Qwen-VL bounding box notations:
/// `<|box_start|>(ymin, xmin),(ymax, xmax)<|box_end|>` (with optional label or ref)
/// or lines like `label: [ymin, xmin, ymax, xmax]` / `[ymin, xmin, ymax, xmax] label`.
fn parse_qwen_boxes(raw: &str) -> Vec<Region> {
    let mut regions = Vec::new();

    // 1. Check for <|box_start|> ... <|box_end|>
    if raw.contains("<|box_start|>") {
        let mut rest = raw;
        while let Some(start_idx) = rest.find("<|box_start|>") {
            let before = &rest[..start_idx];
            let after_start = &rest[start_idx + "<|box_start|>".len()..];
            let Some(end_idx) = after_start.find("<|box_end|>") else {
                break;
            };
            let box_str = &after_start[..end_idx];

            let label = extract_box_label(before, &after_start[end_idx + "<|box_end|>".len()..]);

            if let Some(bbox) = parse_1000_coords(box_str) {
                regions.push(Region {
                    label: label.clone().unwrap_or_else(|| "object".to_string()),
                    text: label.unwrap_or_default(),
                    bbox: Some(bbox),
                });
            }
            rest = &after_start[end_idx + "<|box_end|>".len()..];
        }
        if !regions.is_empty() {
            return regions;
        }
    }

    // 2. Line by line parsing for `[ymin, xmin, ymax, xmax]` brackets
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some(bbox) = extract_bracket_coords(trimmed) {
            let label = trimmed
                .replace(
                    &format!("[{}]", extract_bracket_inner(trimmed).unwrap_or("")),
                    "",
                )
                .trim_matches(|c: char| {
                    c.is_whitespace() || c == ':' || c == '-' || c == '*' || c == '.'
                })
                .trim()
                .to_string();
            let name = if label.is_empty() {
                "object".to_string()
            } else {
                label.clone()
            };
            regions.push(Region {
                label: name,
                text: label,
                bbox: Some(bbox),
            });
        }
    }

    regions
}

fn extract_bracket_inner(s: &str) -> Option<&str> {
    let open = s.find('[')?;
    let close = s[open + 1..].find(']')?;
    Some(&s[open + 1..open + 1 + close])
}

fn extract_bracket_coords(s: &str) -> Option<BBox> {
    let inner = extract_bracket_inner(s)?;
    parse_1000_coords(inner)
}

fn extract_box_label(before: &str, after: &str) -> Option<String> {
    // Check for <|ref|>label<|/ref|> in before or after
    for part in [before, after] {
        if let Some(ref_start) = part.rfind("<|ref|>") {
            let ref_body = &part[ref_start + "<|ref|>".len()..];
            if let Some(ref_end) = ref_body.find("<|/ref|>") {
                let lbl = ref_body[..ref_end].trim();
                if !lbl.is_empty() {
                    return Some(lbl.to_string());
                }
            }
        }
    }
    // Fall back to trailing word in before or leading word in after
    let before_trimmed = before.trim().lines().last().unwrap_or("").trim();
    if !before_trimmed.is_empty() && before_trimmed.len() < 50 {
        return Some(before_trimmed.to_string());
    }
    None
}

/// Parse 4 numbers scaled 0..=1000 into a normalised `BBox`.
/// Handles formats:
/// `(y0, x0),(y1, x1)`
/// `(y0,x0),(y1,x1)`
/// `y0, x0, y1, x1`
/// `[y0, x0, y1, x1]`
/// Qwen-VL standard coordinate order is (ymin, xmin, ymax, xmax).
fn parse_1000_coords(s: &str) -> Option<BBox> {
    let cleaned: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_digit() || c == '.' {
                c
            } else {
                ' '
            }
        })
        .collect();

    let nums: Vec<f32> = cleaned
        .split_whitespace()
        .filter_map(|w| w.parse::<f32>().ok())
        .collect();

    if nums.len() != 4 {
        return None;
    }

    // In Qwen-VL, format is ymin, xmin, ymax, xmax
    let y0 = (nums[0] / QWEN_SCALE).clamp(0.0, 1.0);
    let x0 = (nums[1] / QWEN_SCALE).clamp(0.0, 1.0);
    let y1 = (nums[2] / QWEN_SCALE).clamp(0.0, 1.0);
    let x1 = (nums[3] / QWEN_SCALE).clamp(0.0, 1.0);

    Some(BBox {
        x0: x0.min(x1),
        y0: y0.min(y1),
        x1: x0.max(x1),
        y1: y0.max(y1),
    })
}

/// Parse `<tag><loc_..>…</tag>` blocks.
fn parse_tagged(raw: &str) -> Vec<Region> {
    let mut regions = Vec::new();
    let bytes = raw;
    let mut rest = bytes;

    while let Some(open) = rest.find('<') {
        let after = &rest[open + 1..];
        let Some(close) = after.find('>') else { break };
        let tag = &after[..close];
        let body_start = &after[close + 1..];

        // Skip the wrapper, closing tags and the coordinate tokens themselves;
        // they are consumed as part of the block they belong to.
        if tag.starts_with('/')
            || tag.starts_with("loc_")
            || tag == "doctag"
            || tag.is_empty()
            || !tag.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            rest = body_start;
            continue;
        }

        let closing = format!("</{tag}>");
        let (body, consumed) = match body_start.find(&closing) {
            Some(end) => (&body_start[..end], end + closing.len()),
            // An unterminated final block is kept: a generation cut short by
            // the token limit still located a real region.
            None => (body_start, body_start.len()),
        };

        let (bbox, text) = split_locations(body);
        let text = text.trim().to_owned();
        if !text.is_empty() || bbox.is_some() {
            regions.push(Region {
                label: tag.to_owned(),
                text,
                bbox,
            });
        }
        rest = &body_start[consumed..];
    }

    regions
}

/// Split a block body into its leading `<loc_*>` run and the text after it.
fn split_locations(body: &str) -> (Option<BBox>, &str) {
    let mut coords: Vec<f32> = Vec::new();
    let mut cursor = body;

    loop {
        let trimmed = cursor.trim_start();
        let Some(rest) = trimmed.strip_prefix("<loc_") else {
            break;
        };
        let Some(end) = rest.find('>') else { break };
        let Ok(value) = rest[..end].parse::<f32>() else {
            break;
        };
        coords.push(value / LOC_SCALE);
        cursor = &rest[end + 1..];
        if coords.len() == 4 {
            break;
        }
    }

    // Fewer than four coordinates is not a box. Padding the missing edges
    // would put a plausible rectangle on an answer that never claimed one.
    let bbox = (coords.len() == 4).then(|| BBox {
        x0: coords[0],
        y0: coords[1],
        x1: coords[2],
        y1: coords[3],
    });
    (bbox, cursor)
}

/// One region per non-empty line of a tagless answer.
fn parse_lines(raw: &str) -> Vec<Region> {
    raw.lines()
        .map(|line| {
            line.trim()
                .trim_start_matches(['-', '*', '\u{2022}'])
                .trim()
        })
        // A numbered list ("1. the toolbar") keeps its text, loses its bullet.
        .map(strip_ordinal)
        .filter(|line| !line.is_empty() && line.chars().any(char::is_alphanumeric))
        .map(|line| Region {
            label: "text".to_owned(),
            text: line.to_owned(),
            bbox: None,
        })
        .collect()
}

/// Drop a leading `12.` / `12)` list ordinal.
fn strip_ordinal(line: &str) -> &str {
    let digits: String = line.chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() || digits.len() > 3 {
        return line;
    }
    let rest = &line[digits.len()..];
    rest.strip_prefix('.')
        .or_else(|| rest.strip_prefix(')'))
        .map_or(line, str::trim_start)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOCLING: &str = "<doctag><section_header_level_1><loc_17><loc_68><loc_308><loc_126>APHRODY LOCAL \
         INFERENCE</section_header_level_1>\n<text><loc_18><loc_185><loc_209><loc_252>Invoice \
         2026-08-21</text>\n</doctag>";

    #[test]
    fn doctags_blocks_yield_labelled_regions_with_boxes() {
        let regions = parse_regions(DOCLING);
        assert_eq!(regions.len(), 2);
        assert_eq!(regions[0].label, "section_header_level_1");
        assert_eq!(regions[0].text, "APHRODY LOCAL INFERENCE");
        let bbox = regions[0].bbox.unwrap();
        assert!((bbox.x0 - 17.0 / 500.0).abs() < 1e-6, "{bbox:?}");
        assert!((bbox.y1 - 126.0 / 500.0).abs() < 1e-6, "{bbox:?}");
        assert_eq!(regions[1].label, "text");
    }

    #[test]
    fn coordinates_are_normalised_into_the_unit_square() {
        for region in parse_regions(DOCLING) {
            let bbox = region.bbox.unwrap();
            for edge in [bbox.x0, bbox.y0, bbox.x1, bbox.y1] {
                assert!((0.0..=1.0).contains(&edge), "{edge}");
            }
            assert!(bbox.area() > 0.0);
        }
    }

    #[test]
    fn the_doctag_wrapper_is_not_itself_a_region() {
        assert!(parse_regions(DOCLING).iter().all(|r| r.label != "doctag"));
    }

    #[test]
    fn a_block_with_fewer_than_four_locs_gets_no_box() {
        // Three coordinates is a truncated emission, not a thin rectangle.
        let regions = parse_regions("<text><loc_1><loc_2><loc_3>hello</text>");
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].bbox, None);
        assert_eq!(regions[0].text, "hello");
    }

    #[test]
    fn an_unterminated_final_block_is_kept() {
        let regions = parse_regions("<text><loc_0><loc_0><loc_500><loc_500>cut short");
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].text, "cut short");
        assert!(regions[0].bbox.is_some());
    }

    #[test]
    fn a_picture_block_is_a_region_even_with_no_text() {
        // For dense-region description an illustration IS an answer, unlike
        // in OCR where it is exactly what must not become a transcription.
        let regions = parse_regions("<picture><loc_10><loc_10><loc_400><loc_400></picture>");
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].label, "picture");
        assert!(regions[0].text.is_empty());
        assert!(regions[0].bbox.is_some());
    }

    #[test]
    fn a_tagless_answer_falls_back_to_one_region_per_line() {
        let regions = parse_regions("The toolbar at the top.\nA code editor.\n\n");
        assert_eq!(regions.len(), 2);
        assert_eq!(regions[0].text, "The toolbar at the top.");
        assert!(regions.iter().all(|r| r.bbox.is_none()));
        assert!(regions.iter().all(|r| r.label == "text"));
    }

    #[test]
    fn list_markers_are_dropped_from_prose_regions() {
        let regions = parse_regions("- the sidebar\n* the canvas\n1. the status bar\n2) the tabs");
        let texts: Vec<&str> = regions.iter().map(|r| r.text.as_str()).collect();
        assert_eq!(
            texts,
            vec!["the sidebar", "the canvas", "the status bar", "the tabs"]
        );
    }

    #[test]
    fn a_year_is_not_mistaken_for_a_list_ordinal() {
        let regions = parse_regions("2026 was printed on the header");
        assert_eq!(regions[0].text, "2026 was printed on the header");
    }

    #[test]
    fn control_tokens_never_reach_a_region() {
        let regions = parse_regions("the login screen<|im_end|>");
        assert_eq!(regions.len(), 1);
        assert!(!regions[0].text.contains("im_end"), "{:?}", regions[0].text);
    }

    #[test]
    fn a_blank_answer_yields_no_regions() {
        for raw in ["", "   \n\n", "<doctag></doctag>", "---"] {
            assert!(parse_regions(raw).is_empty(), "{raw:?}");
        }
    }

    #[test]
    fn regions_serialise_without_a_null_box() {
        // A consumer drawing overlays branches on the key being absent; a
        // `"bbox": null` would have to be special-cased in every reader.
        let region = Region {
            label: "text".into(),
            text: "hi".into(),
            bbox: None,
        };
        assert_eq!(
            serde_json::to_string(&region).unwrap(),
            r#"{"label":"text","text":"hi"}"#
        );
    }

    #[test]
    fn qwen_vl_box_markers_parsed() {
        let raw = "<|ref|>cat<|/ref|><|box_start|>(100, 200), (800, 900)<|box_end|>";
        let regions = parse_regions(raw);
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].label, "cat");
        let bbox = regions[0].bbox.unwrap();
        // y0 = 100/1000 = 0.1, x0 = 200/1000 = 0.2, y1 = 800/1000 = 0.8, x1 = 900/1000 = 0.9
        assert!((bbox.x0 - 0.2).abs() < 1e-4);
        assert!((bbox.y0 - 0.1).abs() < 1e-4);
        assert!((bbox.x1 - 0.9).abs() < 1e-4);
        assert!((bbox.y1 - 0.8).abs() < 1e-4);
    }

    #[test]
    fn qwen_vl_bracket_coords_parsed() {
        let raw = "header: [50, 100, 150, 900]\nfooter: [950, 100, 990, 900]";
        let regions = parse_regions(raw);
        assert_eq!(regions.len(), 2);
        assert_eq!(regions[0].label, "header");
        let b0 = regions[0].bbox.unwrap();
        assert!((b0.y0 - 0.05).abs() < 1e-4);
        assert!((b0.x0 - 0.1).abs() < 1e-4);
        assert!((b0.y1 - 0.15).abs() < 1e-4);
        assert!((b0.x1 - 0.9).abs() < 1e-4);

        assert_eq!(regions[1].label, "footer");
        let b1 = regions[1].bbox.unwrap();
        assert!((b1.y0 - 0.95).abs() < 1e-4);
        assert!((b1.x0 - 0.1).abs() < 1e-4);
    }
}
