// SPDX-License-Identifier: Apache-2.0
//! `aphrody winclean` — native Windows computer use and OS control through
//! the in-process `aphrody-winclean` crate (from ../aphrody-os).
//!
//! ```text
//! aphrody winclean doctor
//! aphrody winclean tools --filter computer_
//! aphrody winclean schema computer_click
//! aphrody winclean call get_memory_info
//! aphrody winclean call computer_click --arg windowHandle=0 --arg x=120 --arg y=48
//! aphrody winclean call list_processes '{"nameFilter":"bun"}' --json
//! aphrody winclean observe --out window.png
//! aphrody winclean screenshot --out screen.png
//! ```

use std::path::{Path, PathBuf};

use aphrody_winclean::{ToolResult, Winclean};
use clap::Subcommand;
use miette::{IntoDiagnostic, miette};
use serde_json::{Map, Value};

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum WincleanAction {
    /// Discover Chrome binaries, PIDs, HWNDs, profiles and native messaging paths.
    BrowserMap {
        #[arg(long)]
        binary: Option<PathBuf>,
        #[arg(long)]
        user_data: Option<PathBuf>,
    },
    /// Prepare an isolated Aphrody Chrome profile and qualify its loopback CDP endpoint.
    BrowserSetup {
        #[arg(long)]
        binary: Option<PathBuf>,
        #[arg(long)]
        user_data: Option<PathBuf>,
    },
    /// Show backend initialisation, the linked version and catalog drift.
    Doctor {
        /// Emit JSON.
        #[arg(long)]
        json: bool,
    },
    /// List the WinClean tool catalog.
    Tools {
        /// Substring filter on tool names.
        #[arg(long, short)]
        filter: Option<String>,
        /// Read the catalog from the loaded DLL instead of the vendored copy.
        #[arg(long)]
        live: bool,
        /// Emit JSON (name, description, inputSchema).
        #[arg(long)]
        json: bool,
    },
    /// Print the JSON input schema of one tool.
    Schema {
        /// Tool name, e.g. `computer_click`.
        tool: String,
    },
    /// Invoke any tool.
    Call {
        /// Tool name, e.g. `get_os_info`.
        tool: String,
        /// Arguments as one JSON object.
        args: Option<String>,
        /// Extra `key=value` argument (value parsed as JSON, else kept as a string). Repeatable.
        #[arg(long = "arg", short = 'a', value_name = "KEY=VALUE")]
        kv: Vec<String>,
        /// Print the raw `CallToolResult` JSON.
        #[arg(long)]
        json: bool,
        /// Directory where image blocks are written (default: current directory).
        #[arg(long, value_name = "DIR")]
        images: Option<PathBuf>,
    },
    /// Observe a window (metadata + UI Automation tree + PNG) — `computer_observe`.
    Observe {
        /// HWND to observe (0 = foreground window).
        #[arg(long, default_value_t = 0)]
        hwnd: i64,
        /// Maximum UI Automation elements.
        #[arg(long, default_value_t = 160)]
        max_elements: i64,
        /// PNG output path.
        #[arg(long, short, default_value = "observe.png")]
        out: PathBuf,
    },
    /// Capture the primary desktop — `computer_capture_screen`.
    Screenshot {
        /// PNG output path.
        #[arg(long, short, default_value = "screenshot.png")]
        out: PathBuf,
    },
}

pub(crate) async fn run(action: WincleanAction) -> miette::Result<()> {
    match action {
        WincleanAction::BrowserMap { binary, user_data } => {
            let map = aphrody_winclean::browser::discover(binary, user_data).into_diagnostic()?;
            println!("{}", serde_json::to_string_pretty(&map).into_diagnostic()?);
            Ok(())
        }
        WincleanAction::BrowserSetup { binary, user_data } => {
            let map = aphrody_winclean::browser::discover(binary, user_data).into_diagnostic()?;
            let result = aphrody_winclean::browser::setup(&map).into_diagnostic()?;
            println!(
                "{}",
                serde_json::to_string_pretty(&result).into_diagnostic()?
            );
            Ok(())
        }
        WincleanAction::Doctor { json } => doctor(json),
        WincleanAction::Tools { filter, live, json } => tools(filter.as_deref(), live, json),
        WincleanAction::Schema { tool } => {
            let info = aphrody_winclean::catalog()
                .iter()
                .find(|t| t.name == tool)
                .ok_or_else(|| miette!("unknown winclean tool `{tool}`"))?;
            println!(
                "{}",
                serde_json::to_string_pretty(&info.input_schema).into_diagnostic()?
            );
            Ok(())
        }
        WincleanAction::Call {
            tool,
            args,
            kv,
            json,
            images,
        } => {
            let mut arguments = build_arguments(args.as_deref(), &kv)?;
            if let Some(info) = aphrody_winclean::catalog().iter().find(|t| t.name == tool) {
                coerce_to_schema(&mut arguments, &info.input_schema, &kv);
            }
            let result = if ["windows_", "desktop_", "privileged_"]
                .iter()
                .any(|prefix| tool.starts_with(prefix))
            {
                let client = aphrody_kernel::client::Client::connect(
                    &aphrody_kernel::transport::default_endpoint(),
                )
                .await
                .into_diagnostic()?;
                client
                    .initialize("aphrody-winclean-cli")
                    .await
                    .into_diagnostic()?;
                let result = client
                    .request(
                        "tools/call",
                        serde_json::json!({"name": tool, "arguments": arguments}),
                        std::time::Duration::from_secs(300),
                    )
                    .await
                    .into_diagnostic()?;
                serde_json::from_value::<ToolResult>(result).into_diagnostic()?
            } else {
                load()?
                    .call_async(&tool, &arguments)
                    .await
                    .into_diagnostic()?
            };
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&result).into_diagnostic()?
                );
            } else {
                print_result(&tool, &result, images.as_deref().unwrap_or(Path::new(".")))?;
            }
            if result.is_error {
                Err(miette!("{tool} reported an error"))
            } else {
                Ok(())
            }
        }
        WincleanAction::Observe {
            hwnd,
            max_elements,
            out,
        } => {
            let args = aphrody_winclean::ComputerObserveArgs::new()
                .window_handle(hwnd)
                .max_elements(max_elements);
            let result = load()?
                .computer_observe_async(&args)
                .await
                .into_diagnostic()?;
            save_first_image(&result, &out)?;
            println!("{}", result.text());
            Ok(())
        }
        WincleanAction::Screenshot { out } => {
            let args = aphrody_winclean::ComputerCaptureScreenArgs::default();
            let result = load()?
                .computer_capture_screen_async(&args)
                .await
                .into_diagnostic()?;
            save_first_image(&result, &out)?;
            println!("{}", result.text());
            Ok(())
        }
    }
}

fn load() -> miette::Result<&'static Winclean> {
    aphrody_winclean::shared().map_err(|error| {
        miette!(
            help = "aphrody-winclean is an in-process Rust runtime provided by aphrody-os",
            "aphrody-winclean unavailable: {error}"
        )
    })
}

fn doctor(json: bool) -> miette::Result<()> {
    let vendored = aphrody_winclean::TOOL_NAMES.len();
    let (loaded, version, live, drift, error) = match aphrody_winclean::shared() {
        Ok(wc) => {
            let live = wc.list_tools().into_diagnostic()?;
            let mut drift: Vec<String> = live
                .iter()
                .map(|t| t.name.as_str())
                .filter(|n| !aphrody_winclean::TOOL_NAMES.contains(n))
                .map(|n| format!("+{n}"))
                .collect();
            drift.extend(
                aphrody_winclean::TOOL_NAMES
                    .iter()
                    .filter(|n| !live.iter().any(|t| t.name == **n))
                    .map(|n| format!("-{n}")),
            );
            (Some(true), wc.version().ok(), Some(live.len()), drift, None)
        }
        Err(error) => (Some(false), None, None, Vec::new(), Some(error)),
    };

    if json {
        let report = serde_json::json!({
            "runtime": "aphrody-os",
            "loaded": loaded,
            "version": version,
            "vendoredTools": vendored,
            "liveTools": live,
            "drift": drift,
            "error": error,
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&report).into_diagnostic()?
        );
    } else {
        println!("runtime    : aphrody-os");
        match (loaded, &error) {
            (Some(true), _) => {
                println!(
                    "loaded     : yes (ABI {})",
                    version.as_deref().unwrap_or("?")
                )
            }
            (Some(false), Some(error)) => println!("loaded     : no — {error}"),
            _ => println!("loaded     : no"),
        }
        println!(
            "tools      : {vendored} vendored / {} live",
            live.map_or("-".into(), |n| n.to_string())
        );
        if drift.is_empty() {
            println!("drift      : none");
        } else {
            println!(
                "drift      : {} (update ../aphrody-os and rebuild aphrody)",
                drift.join(" ")
            );
        }
    }
    if error.is_some() || !drift.is_empty() {
        return Err(miette!("winclean runtime is not healthy"));
    }
    Ok(())
}

fn tools(filter: Option<&str>, live: bool, json: bool) -> miette::Result<()> {
    let catalog = if live {
        load()?.list_tools().into_diagnostic()?
    } else {
        aphrody_winclean::catalog().to_vec()
    };
    let selected: Vec<_> = catalog
        .into_iter()
        .filter(|t| filter.is_none_or(|f| t.name.contains(f)))
        .collect();
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&selected).into_diagnostic()?
        );
        return Ok(());
    }
    for info in &selected {
        let summary = info.description.as_deref().unwrap_or_default();
        let summary = summary.split(". ").next().unwrap_or_default();
        println!("{:<28} {summary}", info.name);
    }
    eprintln!("{} tools", selected.len());
    Ok(())
}

fn build_arguments(json: Option<&str>, kv: &[String]) -> miette::Result<Value> {
    let mut map = match json {
        Some(raw) => match serde_json::from_str::<Value>(raw).into_diagnostic()? {
            Value::Object(map) => map,
            _ => return Err(miette!("arguments must be a JSON object")),
        },
        None => Map::new(),
    };
    for pair in kv {
        let (key, value) = pair
            .split_once('=')
            .ok_or_else(|| miette!("--arg expects KEY=VALUE, got `{pair}`"))?;
        let value = serde_json::from_str::<Value>(value)
            .unwrap_or_else(|_| Value::String(value.to_owned()));
        map.insert(key.to_owned(), value);
    }
    Ok(Value::Object(map))
}

/// What a tool result shows on stdout: its text blocks, else its structured content
/// (many tools return only `structuredContent`, which used to print nothing).
fn render_result(result: &ToolResult) -> miette::Result<String> {
    let text = result.text();
    if text.trim().is_empty() {
        return match &result.structured_content {
            Some(Value::String(plain)) => Ok(plain.clone()),
            Some(value) => serde_json::to_string_pretty(value).into_diagnostic(),
            None => Ok(String::new()),
        };
    }
    // Tools return compact JSON documents; pretty-print them when possible.
    match serde_json::from_str::<Value>(&text) {
        Ok(value) => serde_json::to_string_pretty(&value).into_diagnostic(),
        Err(_) => Ok(text),
    }
}

/// `--arg value=2` parses as a JSON number, but a tool whose schema declares `value` a string
/// (`set_registry_value`) rejects it: send the raw text back for string-typed properties.
fn coerce_to_schema(arguments: &mut Value, schema: &Value, kv: &[String]) {
    let (Some(map), Some(props)) = (arguments.as_object_mut(), schema["properties"].as_object())
    else {
        return;
    };
    for pair in kv {
        let Some((key, raw)) = pair.split_once('=') else {
            continue;
        };
        let wants_string = props.get(key).is_some_and(|p| p["type"] == "string");
        if wants_string && !map.get(key).is_some_and(Value::is_string) {
            map.insert(key.to_owned(), Value::String(raw.to_owned()));
        }
    }
}

fn print_result(tool: &str, result: &ToolResult, image_dir: &Path) -> miette::Result<()> {
    let rendered = render_result(result)?;
    if !rendered.is_empty() || result.images().is_empty() {
        println!("{rendered}");
    }
    for (index, image) in result.images().iter().enumerate() {
        let ext = image.mime_type.rsplit('/').next().unwrap_or("bin");
        let path = image_dir.join(format!("{tool}-{index}.{ext}"));
        std::fs::create_dir_all(image_dir).into_diagnostic()?;
        std::fs::write(&path, &image.bytes).into_diagnostic()?;
        eprintln!(
            "{} ({} bytes) -> {}",
            image.mime_type,
            image.bytes.len(),
            path.display()
        );
    }
    Ok(())
}

fn save_first_image(result: &ToolResult, out: &Path) -> miette::Result<()> {
    if result.is_error {
        return Err(miette!("{}", result.text()));
    }
    let image = result
        .images()
        .into_iter()
        .next()
        .ok_or_else(|| miette!("no image returned"))?;
    if let Some(parent) = out.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).into_diagnostic()?;
    }
    std::fs::write(out, &image.bytes).into_diagnostic()?;
    eprintln!("{} bytes -> {}", image.bytes.len(), out.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_merge_json_and_pairs() {
        let args = build_arguments(
            Some(r#"{"windowHandle":0}"#),
            &[
                "x=120".into(),
                "button=left".into(),
                "activate=false".into(),
            ],
        )
        .unwrap();
        assert_eq!(
            args,
            serde_json::json!({"windowHandle":0,"x":120,"button":"left","activate":false})
        );
        assert!(build_arguments(Some("[1]"), &[]).is_err());
        assert!(build_arguments(None, &["novalue".into()]).is_err());
    }

    fn result(json: serde_json::Value) -> ToolResult {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn structured_only_result_is_rendered() {
        let object = result(serde_json::json!({
            "content": [], "structuredContent": {"BuildNumber": "28000"}, "isError": false
        }));
        assert!(
            render_result(&object)
                .unwrap()
                .contains("\"BuildNumber\": \"28000\"")
        );
        let plain = result(serde_json::json!({
            "content": [], "structuredContent": "Set registry value", "isError": false
        }));
        assert_eq!(render_result(&plain).unwrap(), "Set registry value");
    }

    #[test]
    fn text_result_wins_over_structured_content() {
        let both = result(serde_json::json!({
            "content": [{"type": "text", "text": "{\"a\":1}"}],
            "structuredContent": {"b": 2}, "isError": false
        }));
        let rendered = render_result(&both).unwrap();
        assert!(rendered.contains("\"a\": 1") && !rendered.contains("\"b\""));
    }

    #[test]
    fn empty_result_renders_nothing() {
        assert_eq!(
            render_result(&result(serde_json::json!({"content": []}))).unwrap(),
            ""
        );
    }

    #[test]
    fn numeric_arg_is_sent_as_string_when_the_schema_says_string() {
        let schema = serde_json::json!({"properties": {"value": {"type": "string"}, "x": {"type": "integer"}}});
        let kv = vec!["value=2".to_owned(), "x=5".to_owned()];
        let mut args = build_arguments(None, &kv).unwrap();
        coerce_to_schema(&mut args, &schema, &kv);
        assert_eq!(args, serde_json::json!({"value": "2", "x": 5}));
    }

    #[test]
    fn registry_value_schema_is_string_typed_in_the_catalog() {
        let info = aphrody_winclean::catalog()
            .iter()
            .find(|t| t.name == "set_registry_value")
            .unwrap();
        let kv = vec!["value=2".to_owned()];
        let mut args = build_arguments(None, &kv).unwrap();
        coerce_to_schema(&mut args, &info.input_schema, &kv);
        assert_eq!(args["value"], "2");
    }
}
