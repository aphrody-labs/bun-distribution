// SPDX-License-Identifier: Apache-2.0
//! Shared Bun/Rust VDF fixtures (`tests/fixtures`). The Bun parser of `packages/bun-steam` reads
//! the same files and must produce the same `*.expected.json`. `BUN_STEAM_WRITE_FIXTURES=1`
//! regenerates the binary fixtures from the typed documents below.

use std::path::PathBuf;

use bun_steam::vdf::{BinValue, parse_binary_vdf, parse_vdf, write_binary_vdf};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

fn expected(name: &str) -> serde_json::Value {
    serde_json::from_str(&std::fs::read_to_string(fixture(name)).unwrap()).unwrap()
}

fn s(v: &str) -> BinValue {
    BinValue::String(v.into())
}

fn shortcuts() -> BinValue {
    BinValue::Object(vec![(
        "shortcuts".into(),
        BinValue::Object(vec![(
            "0".into(),
            BinValue::Object(vec![
                ("appid".into(), BinValue::Int32(-1_234_567_890)),
                ("AppName".into(), s("Notepad")),
                ("Exe".into(), s("\"C:\\Windows\\notepad.exe\"")),
                ("StartDir".into(), s("\"C:\\Windows\\\"")),
                ("icon".into(), s("")),
                ("LaunchOptions".into(), s("")),
                ("IsHidden".into(), BinValue::Int32(0)),
                ("AllowOverlay".into(), BinValue::Int32(1)),
                ("LastPlayTime".into(), BinValue::Int32(0)),
                (
                    "tags".into(),
                    BinValue::Object(vec![("0".into(), s("favorite"))]),
                ),
            ]),
        )]),
    )])
}

fn types() -> BinValue {
    BinValue::Object(vec![(
        "types".into(),
        BinValue::Object(vec![
            ("string".into(), s("héllo")),
            ("int32".into(), BinValue::Int32(-5)),
            ("float32".into(), BinValue::Float32(1.5)),
            ("pointer".into(), BinValue::Pointer(7)),
            ("wstring".into(), BinValue::WString("wide é".into())),
            ("color".into(), BinValue::Color(0x00ff_00ff)),
            ("uint64".into(), BinValue::UInt64(u64::MAX)),
            ("int64".into(), BinValue::Int64(-9_000_000_000)),
        ]),
    )])
}

#[test]
fn text_fixture_matches_expected() {
    let text = std::fs::read_to_string(fixture("text.vdf")).unwrap();
    let doc = parse_vdf(&text).unwrap();
    assert_eq!(doc.to_json(), expected("text.expected.json"));
    assert_eq!(parse_vdf(&doc.to_vdf_string()).unwrap(), doc);
}

#[test]
fn binary_fixtures_match_writer_and_expected() {
    for (name, doc, json) in [
        ("shortcuts.vdf", shortcuts(), "shortcuts.expected.json"),
        ("types.bin.vdf", types(), "types.expected.json"),
    ] {
        let bytes = write_binary_vdf(&doc);
        if std::env::var_os("BUN_STEAM_WRITE_FIXTURES").is_some() {
            std::fs::write(fixture(name), &bytes).unwrap();
        }
        let on_disk = std::fs::read(fixture(name)).unwrap();
        assert_eq!(on_disk, bytes, "{name} differs from the writer output");
        let parsed = parse_binary_vdf(&on_disk).unwrap();
        assert_eq!(parsed, doc);
        assert_eq!(parsed.to_vdf().to_json(), expected(json), "{name}");
    }
}
