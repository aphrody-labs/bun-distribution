// SPDX-License-Identifier: Apache-2.0
use std::{fs, process::Command};

#[test]
fn inventory_cli_prints_json_and_writes_requested_report() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("game");
    fs::create_dir_all(root.join("bin")).unwrap();
    fs::write(root.join("bin/DBXV2.EXE"), b"synthetic executable").unwrap();
    fs::write(root.join("data.cpk"), b"synthetic archive data").unwrap();

    let stdout = Command::new(env!("CARGO_BIN_EXE_bunre-dbxv2"))
        .arg("inventory")
        .arg(&root)
        .output()
        .unwrap();
    assert!(stdout.status.success());
    let printed: serde_json::Value = serde_json::from_slice(&stdout.stdout).unwrap();
    assert_eq!(printed["scan"]["fileCount"], 2);
    assert_eq!(
        printed["files"][0]["sha256"],
        "eb4ffe43c9edcf310dc3513998df4fa1700fc6570c6c46e32dd3af9e028fe720"
    );

    let report_path = temp.path().join("map.json");
    let written = Command::new(env!("CARGO_BIN_EXE_bunre-dbxv2"))
        .arg("inventory")
        .arg(&root)
        .arg("--output")
        .arg(&report_path)
        .output()
        .unwrap();
    assert!(written.status.success());
    let report: serde_json::Value =
        serde_json::from_slice(&fs::read(report_path).unwrap()).unwrap();
    assert_eq!(report, printed);
}

#[test]
fn text_cli_extracts_msg_strings_without_overwriting_existing_files() {
    let temp = tempfile::tempdir().unwrap();
    let input = temp.path().join("quest.msg");
    let mut bytes = vec![0, 0];
    bytes.extend("Hello".encode_utf16().flat_map(u16::to_le_bytes));
    bytes.extend([0, 0]);
    bytes.extend("日文".encode_utf16().flat_map(u16::to_le_bytes));
    fs::write(&input, bytes).unwrap();

    let printed =
        Command::new(env!("CARGO_BIN_EXE_bunre-dbxv2")).arg("text").arg(&input).output().unwrap();
    assert!(printed.status.success());
    let report: serde_json::Value = serde_json::from_slice(&printed.stdout).unwrap();
    assert_eq!(report["file"], "quest.msg");
    assert_eq!(report["count"], 1);
    assert_eq!(report["strings"], serde_json::json!(["Hello"]));

    let output = temp.path().join("quest.msg.json");
    let written = Command::new(env!("CARGO_BIN_EXE_bunre-dbxv2"))
        .arg("text")
        .arg(&input)
        .arg("--output")
        .arg(&output)
        .output()
        .unwrap();
    assert!(written.status.success());
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&fs::read(&output).unwrap()).unwrap(),
        report
    );

    let refused = Command::new(env!("CARGO_BIN_EXE_bunre-dbxv2"))
        .arg("text")
        .arg(&input)
        .arg("--output")
        .arg(&output)
        .output()
        .unwrap();
    assert!(!refused.status.success());
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&fs::read(output).unwrap()).unwrap(),
        report
    );
}

#[test]
fn text_cli_converts_a_tree_to_a_new_destination_and_rejects_existing_destination() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("input");
    fs::create_dir_all(root.join("en/sub")).unwrap();
    fs::create_dir_all(root.join("ja")).unwrap();
    for path in [root.join("en/sub/quest.msg"), root.join("ja/quest.MSG")] {
        let mut bytes = vec![0, 0];
        bytes.extend("Hello World".encode_utf16().flat_map(u16::to_le_bytes));
        fs::write(path, bytes).unwrap();
    }
    fs::write(root.join("ignored.bin"), b"not an MSG").unwrap();

    let output = temp.path().join("converted");
    let result = Command::new(env!("CARGO_BIN_EXE_bunre-dbxv2"))
        .arg("text")
        .arg(&root)
        .arg("--output-dir")
        .arg(&output)
        .output()
        .unwrap();
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
    let manifest: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(manifest["msgFiles"], 2);
    assert_eq!(manifest["converted"], 2);
    let report: serde_json::Value =
        serde_json::from_slice(&fs::read(output.join("en/sub/quest.msg.json")).unwrap()).unwrap();
    assert_eq!(report["strings"], serde_json::json!(["Hello World"]));
    assert!(output.join("ja/quest.msg.json").is_file());

    let refused = Command::new(env!("CARGO_BIN_EXE_bunre-dbxv2"))
        .arg("text")
        .arg(&root)
        .arg("--output-dir")
        .arg(&output)
        .output()
        .unwrap();
    assert!(!refused.status.success());
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(
            &fs::read(output.join("text_manifest.json")).unwrap()
        )
        .unwrap(),
        manifest
    );
}

#[test]
fn emb_cli_extracts_entries_to_a_new_directory_without_overwriting() {
    let temp = tempfile::tempdir().unwrap();
    let input = temp.path().join("sample.emb");
    let mut bytes = vec![0; 44];
    bytes[..4].copy_from_slice(b"#EMB");
    bytes[12..16].copy_from_slice(&1i32.to_le_bytes());
    bytes[24..28].copy_from_slice(&32i32.to_le_bytes());
    bytes[28..32].copy_from_slice(&40i32.to_le_bytes());
    bytes[32..36].copy_from_slice(&12i32.to_le_bytes());
    bytes[36..40].copy_from_slice(&4i32.to_le_bytes());
    bytes[40..44].copy_from_slice(&48i32.to_le_bytes());
    bytes.extend_from_slice(b"DDS!texture.dds\0");
    fs::write(&input, bytes).unwrap();

    let output = temp.path().join("unpacked");
    let extracted = Command::new(env!("CARGO_BIN_EXE_bunre-dbxv2"))
        .arg("emb")
        .arg(&input)
        .arg("--output-dir")
        .arg(&output)
        .output()
        .unwrap();
    assert!(extracted.status.success(), "{}", String::from_utf8_lossy(&extracted.stderr));
    let report: serde_json::Value = serde_json::from_slice(&extracted.stdout).unwrap();
    assert_eq!(report["entryCount"], 1);
    assert_eq!(report["totalBytes"], 4);
    assert_eq!(fs::read(output.join("texture.dds")).unwrap(), b"DDS!");

    let refused = Command::new(env!("CARGO_BIN_EXE_bunre-dbxv2"))
        .arg("emb")
        .arg(&input)
        .arg("--output-dir")
        .arg(&output)
        .output()
        .unwrap();
    assert!(!refused.status.success());
    assert_eq!(fs::read(output.join("texture.dds")).unwrap(), b"DDS!");
}

#[test]
fn cpk_cli_extracts_to_a_new_directory_and_rejects_traversal() {
    use bun_re::game::fs::cpk::CpkArchive;

    let temp = tempfile::tempdir().unwrap();
    let input = temp.path().join("sample.cpk");
    fs::write(&input, CpkArchive::create_mock(&[("texture.dds", b"DDS!")])).unwrap();
    let output = temp.path().join("unpacked");
    let extracted = Command::new(env!("CARGO_BIN_EXE_bunre-dbxv2"))
        .arg("cpk")
        .arg(&input)
        .arg("--output-dir")
        .arg(&output)
        .output()
        .unwrap();
    assert!(extracted.status.success(), "{}", String::from_utf8_lossy(&extracted.stderr));
    let report: serde_json::Value = serde_json::from_slice(&extracted.stdout).unwrap();
    assert_eq!(report["entryCount"], 1);
    assert_eq!(report["totalBytes"], 4);
    assert_eq!(fs::read(output.join("texture.dds")).unwrap(), b"DDS!");
    assert!(output.join("cpk_manifest.json").is_file());
    let overwrite = Command::new(env!("CARGO_BIN_EXE_bunre-dbxv2"))
        .arg("cpk")
        .arg(&input)
        .arg("--output-dir")
        .arg(&output)
        .output()
        .unwrap();
    assert!(!overwrite.status.success());
    assert_eq!(fs::read(output.join("texture.dds")).unwrap(), b"DDS!");

    let traversal = temp.path().join("traversal.cpk");
    fs::write(&traversal, CpkArchive::create_mock(&[("../escape.bin", b"unsafe")])).unwrap();
    let refused = Command::new(env!("CARGO_BIN_EXE_bunre-dbxv2"))
        .arg("cpk")
        .arg(&traversal)
        .arg("--output-dir")
        .arg(temp.path().join("traversal-output"))
        .output()
        .unwrap();
    assert!(!refused.status.success());
    assert!(!temp.path().join("escape.bin").exists());
}
