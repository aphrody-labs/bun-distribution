// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Adobe Photoshop EngineData dictionary serializer for fully editable text layers.

use crate::typeset::{TextJustification, WritingMode};

#[derive(Debug, Clone)]
pub struct TextEngineSpec {
    pub text: String,
    pub font_index: usize,
    pub font_set: Vec<String>,
    pub font_size: f64,
    pub color: [u8; 4],
    pub faux_bold: bool,
    pub faux_italic: bool,
    pub writing_mode: WritingMode,
    pub justification: TextJustification,
    pub box_width: f64,
    pub box_height: f64,
}

#[derive(Debug, Clone)]
enum EngineValue {
    Int(i32),
    Float(f64),
    Bool(bool),
    String(String),
    Array(Vec<EngineValue>),
    Dict(Vec<(String, EngineValue)>),
}

#[must_use]
pub fn encode_engine_data(spec: &TextEngineSpec) -> Vec<u8> {
    let text = normalize_text(&spec.text);
    let total_length = utf16_len(&text) as i32;
    let font_index = spec.font_index as i32;

    let writing_direction = match spec.writing_mode {
        WritingMode::Horizontal => 0,
        WritingMode::VerticalRl => 2,
    };

    let paragraph_properties = paragraph_properties(spec.justification);
    let base_style_sheet = base_style_sheet(font_index);
    let style_run_sheet = style_run_sheet(spec, font_index);
    let font_set = spec
        .font_set
        .iter()
        .map(|name| font_descriptor(name))
        .collect::<Vec<_>>();

    let root = EngineValue::Dict(vec![
        (
            "EngineDict".to_string(),
            EngineValue::Dict(vec![
                (
                    "Editor".to_string(),
                    EngineValue::Dict(vec![("Text".to_string(), EngineValue::String(text))]),
                ),
                (
                    "ParagraphRun".to_string(),
                    EngineValue::Dict(vec![
                        (
                            "DefaultRunData".to_string(),
                            EngineValue::Dict(vec![
                                (
                                    "ParagraphSheet".to_string(),
                                    EngineValue::Dict(vec![
                                        ("DefaultStyleSheet".to_string(), EngineValue::Int(0)),
                                        ("Properties".to_string(), EngineValue::Dict(Vec::new())),
                                    ]),
                                ),
                                (
                                    "Adjustments".to_string(),
                                    EngineValue::Dict(vec![
                                        ("Axis".to_string(), EngineValue::Array(vec![EngineValue::Float(1.0), EngineValue::Float(0.0), EngineValue::Float(1.0)])),
                                        ("XY".to_string(), EngineValue::Array(vec![EngineValue::Float(0.0), EngineValue::Float(0.0)])),
                                    ]),
                                ),
                            ]),
                        ),
                        ("RunArray".to_string(), EngineValue::Array(vec![
                            EngineValue::Dict(vec![
                                (
                                    "ParagraphSheet".to_string(),
                                    EngineValue::Dict(vec![
                                        ("DefaultStyleSheet".to_string(), EngineValue::Int(0)),
                                        ("Properties".to_string(), EngineValue::Dict(paragraph_properties)),
                                    ]),
                                ),
                                (
                                    "Adjustments".to_string(),
                                    EngineValue::Dict(vec![
                                        ("Axis".to_string(), EngineValue::Array(vec![EngineValue::Float(1.0), EngineValue::Float(0.0), EngineValue::Float(1.0)])),
                                        ("XY".to_string(), EngineValue::Array(vec![EngineValue::Float(0.0), EngineValue::Float(0.0)])),
                                    ]),
                                ),
                            ])
                        ])),
                        ("RunLengthArray".to_string(), EngineValue::Array(vec![EngineValue::Int(total_length)])),
                    ]),
                ),
                (
                    "StyleRun".to_string(),
                    EngineValue::Dict(vec![
                        (
                            "DefaultRunData".to_string(),
                            EngineValue::Dict(vec![
                                (
                                    "StyleSheet".to_string(),
                                    EngineValue::Dict(vec![
                                        ("StyleSheetData".to_string(), EngineValue::Dict(base_style_sheet)),
                                    ]),
                                ),
                            ]),
                        ),
                        ("RunArray".to_string(), EngineValue::Array(vec![
                            EngineValue::Dict(vec![
                                (
                                    "StyleSheet".to_string(),
                                    EngineValue::Dict(vec![
                                        ("StyleSheetData".to_string(), EngineValue::Dict(style_run_sheet)),
                                    ]),
                                ),
                            ])
                        ])),
                        ("RunLengthArray".to_string(), EngineValue::Array(vec![EngineValue::Int(total_length)])),
                    ]),
                ),
                (
                    "Rendered".to_string(),
                    EngineValue::Dict(vec![
                        ("Version".to_string(), EngineValue::Int(1)),
                        (
                            "Shapes".to_string(),
                            EngineValue::Dict(vec![
                                ("WritingDirection".to_string(), EngineValue::Int(writing_direction)),
                                (
                                    "Children".to_string(),
                                    EngineValue::Array(vec![
                                        EngineValue::Dict(vec![
                                            ("ShapeType".to_string(), EngineValue::Int(0)),
                                            ("Procession".to_string(), EngineValue::Int(if spec.writing_mode == WritingMode::VerticalRl { 1 } else { 0 })),
                                            ("Lines".to_string(), EngineValue::Dict(vec![
                                                ("WritingDirection".to_string(), EngineValue::Int(writing_direction)),
                                                ("Children".to_string(), EngineValue::Array(Vec::new())),
                                            ])),
                                            (
                                                "BoxBounds".to_string(),
                                                EngineValue::Array(vec![
                                                    EngineValue::Float(0.0),
                                                    EngineValue::Float(0.0),
                                                    EngineValue::Float(spec.box_width),
                                                    EngineValue::Float(spec.box_height),
                                                ]),
                                            ),
                                        ])
                                    ]),
                                ),
                            ]),
                        ),
                    ]),
                ),
            ]),
        ),
        (
            "ResourceDict".to_string(),
            EngineValue::Dict(vec![
                ("FontSet".to_string(), EngineValue::Array(font_set)),
                (
                    "StyleSheetSet".to_string(),
                    EngineValue::Array(vec![
                        EngineValue::Dict(vec![
                            ("Name".to_string(), EngineValue::String("Normal".to_string())),
                            (
                                "StyleSheetData".to_string(),
                                EngineValue::Dict(default_style_sheet(font_index)),
                            ),
                        ])
                    ]),
                ),
            ]),
        ),
    ]);

    let mut out = Vec::new();
    write_value(&mut out, &root, 0, false, None);
    out
}

fn normalize_text(text: &str) -> String {
    text.replace("\r\n", "\r").replace('\n', "\r")
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn paragraph_properties(justification: TextJustification) -> Vec<(String, EngineValue)> {
    let justify_id = match justification {
        TextJustification::Left => 0,
        TextJustification::Right => 1,
        TextJustification::Center => 2,
    };
    vec![
        ("Justification".to_string(), EngineValue::Int(justify_id)),
        ("FirstLineIndent".to_string(), EngineValue::Float(0.0)),
        ("StartIndent".to_string(), EngineValue::Float(0.0)),
        ("EndIndent".to_string(), EngineValue::Float(0.0)),
        ("SpaceBefore".to_string(), EngineValue::Float(0.0)),
        ("SpaceAfter".to_string(), EngineValue::Float(0.0)),
        ("AutoLeading".to_string(), EngineValue::Float(1.2)),
    ]
}

fn base_style_sheet(font_index: i32) -> Vec<(String, EngineValue)> {
    vec![
        ("Font".to_string(), EngineValue::Int(font_index)),
        ("FontSize".to_string(), EngineValue::Float(12.0)),
        ("FauxBold".to_string(), EngineValue::Bool(false)),
        ("FauxItalic".to_string(), EngineValue::Bool(false)),
        ("AutoLeading".to_string(), EngineValue::Bool(true)),
        ("Leading".to_string(), EngineValue::Float(0.0)),
        ("HorizontalScale".to_string(), EngineValue::Float(1.0)),
        ("VerticalScale".to_string(), EngineValue::Float(1.0)),
        ("Tracking".to_string(), EngineValue::Int(0)),
        ("BaselineShift".to_string(), EngineValue::Float(0.0)),
    ]
}

fn style_run_sheet(spec: &TextEngineSpec, font_index: i32) -> Vec<(String, EngineValue)> {
    let mut sheet = base_style_sheet(font_index);
    sheet.push(("FontSize".to_string(), EngineValue::Float(spec.font_size)));
    sheet.push(("FauxBold".to_string(), EngineValue::Bool(spec.faux_bold)));
    sheet.push(("FauxItalic".to_string(), EngineValue::Bool(spec.faux_italic)));
    sheet.push((
        "FillColor".to_string(),
        EngineValue::Dict(color_type_values(spec.color)),
    ));
    sheet
}

fn default_style_sheet(font_index: i32) -> Vec<(String, EngineValue)> {
    base_style_sheet(font_index)
}

fn font_descriptor(name: &str) -> EngineValue {
    EngineValue::Dict(vec![
        ("Name".to_string(), EngineValue::String(name.to_string())),
        ("Script".to_string(), EngineValue::Int(0)),
        ("FontType".to_string(), EngineValue::Int(0)),
        ("Synthetic".to_string(), EngineValue::Int(0)),
    ])
}

fn color_type_values(color: [u8; 4]) -> Vec<(String, EngineValue)> {
    vec![
        ("Type".to_string(), EngineValue::Int(1)),
        (
            "Values".to_string(),
            EngineValue::Array(vec![
                EngineValue::Float(color[3] as f64 / 255.0),
                EngineValue::Float(color[0] as f64 / 255.0),
                EngineValue::Float(color[1] as f64 / 255.0),
                EngineValue::Float(color[2] as f64 / 255.0),
            ]),
        ),
    ]
}

fn write_value(
    out: &mut Vec<u8>,
    value: &EngineValue,
    indent: usize,
    in_property: bool,
    key: Option<&str>,
) {
    match value {
        EngineValue::Int(number) => {
            write_prefix(out, indent, in_property);
            out.extend_from_slice(number.to_string().as_bytes());
        }
        EngineValue::Float(number) => {
            write_prefix(out, indent, in_property);
            out.extend_from_slice(format!("{number:.4}").as_bytes());
        }
        EngineValue::Bool(flag) => {
            write_prefix(out, indent, in_property);
            out.extend_from_slice(if *flag { b"true" } else { b"false" });
        }
        EngineValue::String(text) => {
            write_prefix(out, indent, in_property);
            out.push(b'(');
            out.push(0xFE);
            out.push(0xFF);
            for unit in text.encode_utf16() {
                write_escaped_byte(out, (unit >> 8) as u8);
                write_escaped_byte(out, unit as u8);
            }
            out.push(b')');
        }
        EngineValue::Array(items) => {
            write_prefix(out, indent, in_property);
            out.extend_from_slice(b"[ ");
            for item in items {
                write_inline_value(out, item, key);
                out.push(b' ');
            }
            out.extend_from_slice(b"]");
        }
        EngineValue::Dict(entries) => {
            if in_property {
                out.push(b'\n');
            } else {
                write_indent(out, indent);
            }
            out.extend_from_slice(b"<<\n");
            for (entry_key, entry_value) in entries {
                write_indent(out, indent + 1);
                out.push(b'/');
                out.extend_from_slice(entry_key.as_bytes());
                write_value(out, entry_value, indent + 1, true, Some(entry_key));
                out.push(b'\n');
            }
            write_indent(out, indent);
            out.extend_from_slice(b">>");
        }
    }
}

fn write_inline_value(out: &mut Vec<u8>, value: &EngineValue, key: Option<&str>) {
    match value {
        EngineValue::Int(number) => out.extend_from_slice(number.to_string().as_bytes()),
        EngineValue::Float(number) => out.extend_from_slice(format!("{number:.4}").as_bytes()),
        EngineValue::Bool(flag) => out.extend_from_slice(if *flag { b"true" } else { b"false" }),
        _ => write_value(out, value, 0, false, key),
    }
}

fn write_prefix(out: &mut Vec<u8>, indent: usize, in_property: bool) {
    if in_property {
        out.push(b' ');
    } else {
        write_indent(out, indent);
    }
}

fn write_indent(out: &mut Vec<u8>, indent: usize) {
    for _ in 0..indent {
        out.push(b'\t');
    }
}

fn write_escaped_byte(out: &mut Vec<u8>, byte: u8) {
    if matches!(byte, b'(' | b')' | b'\\') {
        out.push(b'\\');
    }
    out.push(byte);
}
