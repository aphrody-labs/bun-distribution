// SPDX-License-Identifier: Apache-2.0
//! Privileged Rust WinClean catalog owned by the Aphrody kernel.
//!
//! The local agent receives the same typed 166-tool Windows surface as the
//! canonical WinClean runtime. The M3 WebView remains limited to explicit
//! desktop commands and does not receive a generic tool tunnel.

use aphrody_subsystem::{SubsystemError, SystemSubsystem, ToolDefinition};
use async_trait::async_trait;
use serde_json::Value;

/// The kernel-owned Windows control plane.
#[derive(Debug, Default)]
pub struct AdminSubsystem;

#[async_trait]
impl SystemSubsystem for AdminSubsystem {
    fn name(&self) -> &'static str {
        "admin"
    }

    fn description(&self) -> &'static str {
        "Kernel-owned WinClean control plane: Windows administration, services, registry, \
         filesystem, UIA and OCR."
    }

    fn tools(&self) -> Vec<ToolDefinition> {
        aphrody_winclean::registry::registrations()
            .iter()
            .map(|entry| {
                ToolDefinition::new(
                    &entry.tool.name,
                    entry.tool.description.as_deref().unwrap_or("WinClean Windows operation."),
                    entry.tool.input_schema.clone(),
                )
            })
            .collect()
    }

    async fn call(&self, tool: &str, arguments: Value) -> Result<Value, SubsystemError> {
        let Some(registration) = aphrody_winclean::registry::lookup(tool) else {
            return Err(SubsystemError::UnknownTool(tool.to_owned()));
        };
        // The kernel is the production owner of the WinClean surface.  A
        // legacy/dual entry must never silently reintroduce the NativeAOT
        // loader: it is an explicit migration error instead.
        if registration.dispatch != aphrody_winclean::registry::DispatchMode::Rust {
            return Err(SubsystemError::Unavailable(format!(
                "WinClean tool `{tool}` has non-Rust dispatch mode {:?}; NativeAOT fallback is \
                 disabled",
                registration.dispatch
            )));
        }
        let tool = tool.to_owned();
        tokio::task::spawn_blocking(move || call_rust(&tool, arguments))
            .await
            .map_err(|error| SubsystemError::Failed(format!("WinClean worker: {error}")))?
    }
}

fn call_rust(tool: &str, arguments: Value) -> Result<Value, SubsystemError> {
    aphrody_winclean::dispatch::call_rust(tool, arguments).map_err(|error| match error {
        aphrody_winclean::SubsystemError::UnknownTool(message) => {
            SubsystemError::UnknownTool(message)
        },
        aphrody_winclean::SubsystemError::InvalidArguments(message) => {
            SubsystemError::InvalidArguments(message)
        },
        aphrody_winclean::SubsystemError::Failed(message) => SubsystemError::Failed(message),
        aphrody_winclean::SubsystemError::Unavailable(message) => {
            SubsystemError::Unavailable(message)
        },
    })
}

#[cfg(test)]
mod tests {
    use aphrody_subsystem::{SubsystemError, SystemSubsystem};
    use serde_json::json;

    use super::{AdminSubsystem, call_rust};

    fn pe_fixture() -> tempfile::NamedTempFile {
        // One valid AMD64 PE section, independent of the test runner's executable format.
        let mut bytes = vec![0_u8; 0x400];
        bytes[..2].copy_from_slice(b"MZ");
        bytes[0x3c..0x40].copy_from_slice(&0x80_u32.to_le_bytes());
        bytes[0x80..0x84].copy_from_slice(b"PE\0\0");
        bytes[0x84..0x86].copy_from_slice(&0x8664_u16.to_le_bytes());
        bytes[0x86..0x88].copy_from_slice(&1_u16.to_le_bytes());
        bytes[0x94..0x96].copy_from_slice(&0xf0_u16.to_le_bytes());
        bytes[0x96..0x98].copy_from_slice(&0x22_u16.to_le_bytes());
        bytes[0x98..0x9a].copy_from_slice(&0x20b_u16.to_le_bytes());
        bytes[0xa8..0xac].copy_from_slice(&0x1000_u32.to_le_bytes());
        bytes[0xb0..0xb8].copy_from_slice(&0x1_4000_0000_u64.to_le_bytes());
        bytes[0xb8..0xbc].copy_from_slice(&0x1000_u32.to_le_bytes());
        bytes[0xbc..0xc0].copy_from_slice(&0x200_u32.to_le_bytes());
        bytes[0xd0..0xd4].copy_from_slice(&0x2000_u32.to_le_bytes());
        bytes[0xd4..0xd8].copy_from_slice(&0x200_u32.to_le_bytes());
        bytes[0xdc..0xde].copy_from_slice(&3_u16.to_le_bytes());
        bytes[0x104..0x108].copy_from_slice(&16_u32.to_le_bytes());
        bytes[0x188..0x18d].copy_from_slice(b".text");
        bytes[0x190..0x194].copy_from_slice(&16_u32.to_le_bytes());
        bytes[0x194..0x198].copy_from_slice(&0x1000_u32.to_le_bytes());
        bytes[0x198..0x19c].copy_from_slice(&0x200_u32.to_le_bytes());
        bytes[0x19c..0x1a0].copy_from_slice(&0x200_u32.to_le_bytes());
        bytes[0x1ac..0x1b0].copy_from_slice(&0x6000_0020_u32.to_le_bytes());
        bytes[0x200..0x210].copy_from_slice(b"aphrody fixture\0");
        let file = tempfile::NamedTempFile::new().expect("PE fixture");
        std::fs::write(file.path(), bytes).expect("write PE fixture");
        file
    }

    #[test]
    fn every_canonical_winclean_tool_is_agent_available() {
        let tools = AdminSubsystem.tools();
        assert_eq!(tools.len(), aphrody_winclean::catalog().len());
        assert_eq!(tools.len(), aphrody_winclean::TOOL_NAMES.len());
        let names: std::collections::BTreeSet<_> =
            tools.iter().map(|tool| tool.name.as_str()).collect();
        assert_eq!(names.len(), tools.len(), "kernel catalog contains duplicate tool names");
        assert!(
            aphrody_winclean::registry::registrations()
                .iter()
                .all(|entry| { entry.dispatch == aphrody_winclean::registry::DispatchMode::Rust }),
            "kernel must not expose a NativeAOT fallback dispatch"
        );
        assert!(tools.iter().all(|tool| !tool.read_only));
        assert!(tools.iter().any(|tool| tool.name == "computer_click"));
        assert!(tools.iter().any(|tool| tool.name == "start_service"));
        assert!(tools.iter().any(|tool| tool.name == "set_registry_value"));
    }

    #[test]
    fn every_registered_tool_reaches_the_rust_dispatch_match() {
        // Empty arguments deliberately exercise validation before any
        // mutating operation. A missing argument is acceptable; UnknownTool
        // is not, because it would prove a registry/dispatcher drift.
        for name in aphrody_winclean::TOOL_NAMES {
            let result = call_rust(name, json!({}));
            assert!(
                !matches!(result, Err(SubsystemError::UnknownTool(_))),
                "catalog tool `{name}` has no Rust dispatch arm"
            );
        }
    }

    #[test]
    fn entropy_map_is_served_by_the_rust_owner() {
        let path = std::env::temp_dir().join(format!(
            "aphrody-entropy-{}-{}.bin",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock after Unix epoch")
                .as_nanos()
        ));
        std::fs::write(&path, [0_u8; 512]).expect("write entropy fixture");
        let result = call_rust(
            "binary_entropy_map",
            json!({ "path": path.to_string_lossy(), "blockSize": 1 }),
        )
        .expect("Rust entropy handler succeeds");
        std::fs::remove_file(&path).expect("remove entropy fixture");

        assert_eq!(result["blockSize"], 256);
        assert_eq!(result["samples"], 2);
        assert_eq!(result["min"], 0.0);
        assert_eq!(result["max"], 0.0);
    }

    #[test]
    fn multi_hash_is_served_by_the_rust_owner() {
        let path = std::env::temp_dir().join(format!("aphrody-hash-{}.bin", std::process::id()));
        std::fs::write(&path, b"abc").expect("write hash fixture");
        let result = call_rust("binary_hash_multi", json!({ "path": path.to_string_lossy() }))
            .expect("Rust hash handler succeeds");
        std::fs::remove_file(&path).expect("remove hash fixture");
        assert_eq!(result["size"], 3);
        assert_eq!(result["md5"], "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(result["sha1"], "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(
            result["sha256"],
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn strings_are_served_by_the_rust_owner() {
        let path = std::env::temp_dir().join(format!("aphrody-strings-{}.bin", std::process::id()));
        std::fs::write(
            &path,
            [b'a', b'b', b'c', b'd', 0, 0, b'R', 0, b'u', 0, b's', 0, b't', 0, 0, 0],
        )
        .expect("write strings fixture");
        let result = call_rust(
            "binary_extract_strings",
            json!({ "path": path.to_string_lossy(), "minLength": 4 }),
        )
        .expect("Rust strings handler succeeds");
        std::fs::remove_file(&path).expect("remove strings fixture");
        assert_eq!(result["count"], 2);
        assert_eq!(result["strings"][0]["encoding"], "ascii");
        assert_eq!(result["strings"][1]["encoding"], "utf16");
    }

    #[test]
    fn xor_is_served_by_the_rust_owner() {
        let input = std::env::temp_dir().join(format!("aphrody-xor-in-{}.bin", std::process::id()));
        let output =
            std::env::temp_dir().join(format!("aphrody-xor-out-{}.bin", std::process::id()));
        std::fs::write(&input, [0x10_u8, 0x20, 0x30]).expect("write xor fixture");
        let result = call_rust(
            "binary_xor_decrypt",
            json!({ "inputPath": input.to_string_lossy(), "outputPath": output.to_string_lossy(), "keyHex": "A5 5A" }),
        )
        .expect("Rust xor handler succeeds");
        assert_eq!(std::fs::read(&output).expect("read xor output"), [0xB5, 0x7A, 0x95]);
        assert_eq!(result["keyLen"], 2);
        std::fs::remove_file(&input).expect("remove xor input");
        std::fs::remove_file(&output).expect("remove xor output");
    }

    #[test]
    fn aes_ctr_is_served_by_the_rust_owner() {
        let input = std::env::temp_dir().join(format!("aphrody-aes-in-{}.bin", std::process::id()));
        let output =
            std::env::temp_dir().join(format!("aphrody-aes-out-{}.bin", std::process::id()));
        std::fs::write(&input, [0_u8; 32]).expect("write AES fixture");
        let result = call_rust(
            "binary_aes_ctr_decrypt",
            json!({
                "inputPath": input.to_string_lossy(),
                "outputPath": output.to_string_lossy(),
                "keyHex": "00000000000000000000000000000000",
                "ivHex": "00000000000000000000000000000000"
            }),
        )
        .expect("Rust AES handler succeeds");
        assert_eq!(result["keyBits"], 128);
        assert_eq!(result["bytes"], 32);
        assert_eq!(std::fs::metadata(&output).expect("AES output").len(), 32);
        std::fs::remove_file(&input).expect("remove AES input");
        std::fs::remove_file(&output).expect("remove AES output");
    }

    #[test]
    fn section_dump_is_served_by_the_rust_owner() {
        let fixture = pe_fixture();
        let input = fixture.path();
        let output =
            std::env::temp_dir().join(format!("aphrody-section-{}.bin", std::process::id()));
        let result = call_rust(
            "binary_section_dump",
            json!({ "path": input.to_string_lossy(), "sectionName": ".text", "outputPath": output.to_string_lossy() }),
        )
        .expect("Rust section handler succeeds");
        assert_eq!(result["success"], true);
        assert!(result["size"].as_u64().unwrap_or(0) > 0);
        assert!(std::fs::metadata(&output).expect("section output").len() > 0);
        std::fs::remove_file(&output).expect("remove section output");
    }

    #[test]
    fn pe_header_is_served_by_the_rust_owner() {
        let fixture = pe_fixture();
        let input = fixture.path();
        let result =
            call_rust("binary_parse_pe_header", json!({ "path": input.to_string_lossy() }))
                .expect("Rust PE header handler succeeds");
        assert_eq!(result["success"], true);
        assert!(!result["sections"].as_array().expect("sections array").is_empty());
    }

    #[test]
    fn analyze_pe_is_served_by_the_rust_owner() {
        let fixture = pe_fixture();
        let input = fixture.path();
        let result = call_rust("analyze_pe", json!({ "path": input.to_string_lossy() }))
            .expect("Rust PE analysis handler succeeds");
        assert_eq!(result["success"], true);
        assert!(result["sections"].as_array().is_some_and(|rows| !rows.is_empty()));
        assert!(result["extracted_strings"].is_array());
    }

    #[test]
    fn cpk_summary_is_served_by_the_rust_owner() {
        let input = std::env::temp_dir().join(format!("aphrody-cpk-{}.bin", std::process::id()));
        std::fs::write(&input, b"CPK \0\0\0\0TOC ITOC ETOC").expect("write CPK fixture");
        let result = call_rust(
            "binary_list_cpk",
            json!({ "path": input.to_string_lossy(), "maxEntries": 50 }),
        )
        .expect("Rust CPK handler succeeds");
        std::fs::remove_file(&input).expect("remove CPK fixture");
        assert_eq!(result["success"], true);
        assert_eq!(result["hasCpkMagic"], true);
        assert_eq!(result["tocMarkers"], 2);
        assert_eq!(result["itocMarkers"], 1);
        assert_eq!(result["etocMarkers"], 1);
    }

    #[test]
    fn filesystem_tools_are_served_by_the_rust_owner() {
        let root = std::env::temp_dir().join(format!("aphrody-fs-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("create filesystem fixture");
        let file = root.join("sample.txt");
        let path = file.to_string_lossy().to_string();
        let written =
            call_rust("write_file", json!({ "path": path, "content": "one\ntwo\nthree" }))
                .expect("Rust write handler succeeds");
        assert!(written.as_str().is_some_and(|value| value.contains("Wrote 13 chars")));
        let read = call_rust(
            "read_file",
            json!({ "path": file.to_string_lossy(), "offset": 1, "limit": 1 }),
        )
        .expect("Rust read handler succeeds");
        let read_text = read.as_str().expect("read result is text");
        assert!(read_text.ends_with(&format!("{}\nContent:\ntwo", file.display())));
        let info = call_rust("get_file_info", json!({ "path": file.to_string_lossy() }))
            .expect("Rust info handler succeeds");
        assert_eq!(info["isDirectory"], false);
        assert_eq!(info["sizeBytes"], 13);
        let listing = call_rust(
            "list_directory",
            json!({ "path": root.to_string_lossy(), "pattern": "*.txt" }),
        )
        .expect("Rust listing handler succeeds");
        assert_eq!(listing["count"], 1);
        let searched = call_rust(
            "search_files",
            json!({ "path": root.to_string_lossy(), "pattern": "*.txt", "recursive": true }),
        )
        .expect("Rust search handler succeeds");
        assert_eq!(searched["count"], 1);
        let copy = root.join("copy.txt");
        let copied = call_rust(
            "copy_path",
            json!({ "path": file.to_string_lossy(), "destination": copy.to_string_lossy() }),
        )
        .expect("Rust copy handler succeeds");
        assert!(copied.as_str().is_some_and(|value| value.contains("Copied file")));
        let moved = root.join("moved.txt");
        let moved_result = call_rust(
            "move_path",
            json!({ "path": copy.to_string_lossy(), "destination": moved.to_string_lossy() }),
        )
        .expect("Rust move handler succeeds");
        assert!(moved_result.as_str().is_some_and(|value| value.contains("Moved file")));
        let deleted = call_rust("delete_path", json!({ "path": moved.to_string_lossy() }))
            .expect("Rust delete handler succeeds");
        assert!(deleted.as_str().is_some_and(|value| value.contains("Deleted file")));
        std::fs::remove_dir_all(&root).expect("remove filesystem fixture");
    }

    #[test]
    fn system_inventory_tools_are_served_by_the_rust_owner() {
        let cpu = call_rust("get_cpu_info", json!({})).expect("CPU inventory succeeds");
        assert!(cpu["LogicalProcessors"].as_u64().unwrap_or(0) > 0);
        let usage =
            call_rust("get_cpu_usage", json!({ "intervalMs": 50 })).expect("CPU usage succeeds");
        assert_eq!(usage["SampleIntervalMs"], 50);
        assert!((0.0..=100.0).contains(&usage["UsagePercent"].as_f64().unwrap_or(-1.0)));
        let memory = call_rust("get_memory_info", json!({})).expect("memory inventory succeeds");
        assert!(memory["TotalPhysicalBytes"].as_u64().is_some());
        let perf = call_rust("perf_memory_status", json!({})).expect("perf memory status succeeds");
        assert_eq!(perf["TotalPhysicalBytes"], memory["TotalPhysicalBytes"]);
        let disks = call_rust("get_disk_info", json!({})).expect("disk inventory succeeds");
        assert_eq!(
            disks["Count"].as_u64(),
            disks["Disks"].as_array().map(|rows| rows.len() as u64)
        );
        let os = call_rust("get_os_info", json!({})).expect("OS inventory succeeds");
        assert!(os["OsArchitecture"].as_str().is_some_and(|value| !value.is_empty()));
        let profile =
            call_rust("get_system_profile", json!({})).expect("profile inventory succeeds");
        assert!(profile["status"].as_str().is_some_and(|value| value.contains("Rust")));
        let networks =
            call_rust("get_network_adapters", json!({})).expect("network inventory succeeds");
        assert_eq!(
            networks["Count"].as_u64(),
            networks["Adapters"].as_array().map(|rows| rows.len() as u64)
        );
        let tcp = call_rust("list_tcp_connections", json!({})).expect("TCP inventory succeeds");
        assert_eq!(
            tcp["Count"].as_u64(),
            tcp["Connections"].as_array().map(|rows| rows.len() as u64)
        );
        let listening =
            call_rust("list_listening_ports", json!({})).expect("listening inventory succeeds");
        assert!(
            listening["Connections"]
                .as_array()
                .is_some_and(|rows| rows.iter().all(|row| row["State"] == "Listen"))
        );
        let processes = call_rust("list_processes", json!({ "sortBy": "name", "limit": 5 }))
            .expect("process inventory succeeds");
        assert!(processes["Count"].as_u64().unwrap_or(0) <= 5);
        assert_eq!(
            processes["Count"].as_u64(),
            processes["Processes"].as_array().map(|rows| rows.len() as u64)
        );
        let missing = call_rust("kill_process", json!({ "pid": 4_294_967_000_u64 }))
            .expect("kill validation succeeds");
        assert!(missing.as_str().is_some_and(|value| value.contains("No process")));
        let waited = call_rust("wait", json!({ "seconds": 1 })).expect("wait succeeds");
        assert_eq!(waited.as_str(), Some("Waited 1 second(s)."));
    }

    #[cfg(not(windows))]
    #[test]
    fn windows_inventory_tools_report_platform_unavailability() {
        for tool in ["list_power_plans", "list_services", "list_scheduled_tasks"] {
            assert!(matches!(call_rust(tool, json!({})), Err(SubsystemError::Failed(_))));
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_inventory_tools_are_served_by_the_rust_owner() {
        let plans = call_rust("list_power_plans", json!({})).expect("power plan list succeeds");
        assert_eq!(
            plans["Count"].as_u64(),
            plans["Plans"].as_array().map(|rows| rows.len() as u64)
        );
        if plans["Count"].as_u64().unwrap_or(0) > 0 {
            let active =
                call_rust("get_active_power_plan", json!({})).expect("active power plan succeeds");
            assert_eq!(active["IsActive"], true);
        }
        assert!(call_rust("set_active_power_plan", json!({ "guid": "not-a-guid" })).is_err());
        let services = call_rust("list_services", json!({})).expect("service inventory succeeds");
        assert_eq!(
            services["Count"].as_u64(),
            services["Services"].as_array().map(|rows| rows.len() as u64)
        );
        assert!(call_rust("start_service", json!({ "name": "bad;service" })).is_err());
        let tasks = call_rust("list_scheduled_tasks", json!({ "folder": "\\" }))
            .expect("task inventory succeeds");
        assert_eq!(
            tasks["Count"].as_u64(),
            tasks["Tasks"].as_array().map(|rows| rows.len() as u64)
        );
        assert!(call_rust("list_scheduled_tasks", json!({ "folder": "bad\"folder" })).is_err());
        assert!(call_rust("run_scheduled_task", json!({ "path": "bad\"task" })).is_err());
        assert!(call_rust("query_event_log", json!({ "channel": "bad\"channel" })).is_err());
        assert!(call_rust("list_registry_key", json!({ "path": "bad\\path" })).is_err());
        assert!(
            call_rust(
                "get_registry_value",
                json!({ "path": "HKCU:\\Software", "name": "bad\"name" })
            )
            .is_err()
        );
        assert!(
            call_rust(
                "set_registry_value",
                json!({ "path": "bad\\path", "name": "x", "value": "1" })
            )
            .is_err()
        );
        assert!(call_rust("delete_registry_entry", json!({ "path": "bad\\path" })).is_err());
        assert!(
            call_rust("wsl_list_processes", json!({ "distribution": "bad\"distribution" }))
                .is_err()
        );
        assert!(
            call_rust(
                "wsl_read_only_probe",
                json!({ "distribution": "Ubuntu", "probe": "arbitrary-shell" })
            )
            .is_err()
        );
        assert!(
            call_rust(
                "wsl_send_signal",
                json!({ "distribution": "Ubuntu", "processId": 1, "signal": "USR1" })
            )
            .is_err()
        );
    }

    #[test]
    fn launch_app_is_served_by_the_rust_owner() {
        let executable = std::env::current_exe().expect("current executable");
        let launched = call_rust(
            "launch_app",
            json!({ "target": executable.to_string_lossy(), "args": "--exact aphrody-launch-no-such-test --quiet" }),
        )
        .expect("launch handler succeeds");
        assert!(launched.as_str().is_some_and(|value| value.contains("Launched")));
        let uri = call_rust("launch_app", json!({ "target": "ms-settings:" }));
        assert!(uri.is_err());
    }

    #[test]
    fn aob_scan_is_served_by_the_rust_owner() {
        let input = std::env::temp_dir().join(format!("aphrody-aob-{}.bin", std::process::id()));
        std::fs::write(&input, [0x4D_u8, 0x5A, 0x90, 0x4D, 0x5A, 0x11]).expect("write AOB fixture");
        let result = call_rust(
            "aob_scan",
            json!({ "path": input.to_string_lossy(), "pattern": "4D 5A ?", "maxMatches": 10 }),
        )
        .expect("Rust AOB handler succeeds");
        assert_eq!(result["matches"], json!([0, 3]));
        std::fs::remove_file(&input).expect("remove AOB fixture");
    }

    #[test]
    fn golang_scan_is_served_by_the_rust_owner() {
        let input = std::env::temp_dir().join(format!("aphrody-go-{}.bin", std::process::id()));
        std::fs::write(&input, b"not a Go binary").expect("write Go fixture");
        let result =
            call_rust("golang_scan", json!({ "path": input.to_string_lossy(), "maxSymbols": 20 }))
                .expect("Rust Go handler succeeds");
        std::fs::remove_file(&input).expect("remove Go fixture");
        assert_eq!(result["success"], true);
        assert_eq!(result["isGolang"], false);
        assert_eq!(result["symbolCount"], 0);
        assert_eq!(result["magicOffset"], -1);
    }
}
