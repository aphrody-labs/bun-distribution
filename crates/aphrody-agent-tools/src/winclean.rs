// SPDX-License-Identifier: Apache-2.0
//! Native Windows computer use and OS control through the in-process
//! `aphrody-winclean` crate.
//!
//! Every tool of the WinClean catalog (see [`aphrody_winclean::TOOL_NAMES`]) becomes a
//! [`ToolExecutor`] backed by an in-process call into the DLL — no MCP server,
//! no subprocess. Two exposure tiers keep the model context small:
//!
//! - the computer-use core (`computer_observe`, `computer_click`, …) is `Direct`;
//! - every other tool is `Deferred` (dispatch-only) and reachable through the `winclean` gateway
//!   tool, which lists the catalog and invokes any tool by name.
//!
//! Image blocks (window / screen captures) are written to
//! `%TEMP%/aphrody-winclean/` and referenced by path in the text output, since
//! [`ToolOutput`] carries text only.

use std::{collections::BTreeMap, sync::Arc};

use aphrody_toolcall::{
    AdditionalProperties, JsonSchema, ToolDefinition, ToolError, ToolExecutor, ToolExposure,
    ToolImage, ToolOutput, ToolSafety,
};
use aphrody_winclean::{ToolInfo, ToolResult};
use base64::Engine as _;
use serde_json::Value;

/// Name of the gateway tool.
pub const WINCLEAN_GATEWAY: &str = "winclean";

/// Tools advertised directly to the model (observe → act → verify loop).
pub const WINCLEAN_DIRECT_TOOLS: &[&str] = &[
    "computer_observe",
    "computer_capture_screen",
    "computer_ocr",
    "computer_click",
    "computer_click_element",
    "computer_type",
    "computer_key",
    "computer_scroll",
    "computer_drag",
    "list_windows",
];

/// Gaming profile: low-latency capture, frame pacing, high-rate input, Steam launch and the
/// read-only optimisation checks, advertised directly by [`winclean_gaming_tools`].
pub const WINCLEAN_GAMING_TOOLS: &[&str] = &[
    "gaming_environment",
    "gaming_capture_window",
    "gaming_capture_benchmark",
    "gaming_frame_pacing",
    "gaming_mouse_delta",
    "gaming_mouse_button",
    "gaming_key",
    "gaming_input_sequence",
    "gaming_steam_launch",
    "gaming_profile_status",
    "list_windows",
    "switch_to_window",
];

/// Tools that change machine state; escalated when `APHRODY_GUARD` is enabled.
const MUTATING_TOOLS: &[&str] = &[
    "delete_path",
    "move_path",
    "copy_path",
    "write_file",
    "multi_edit",
    "power_shell",
    "kill_process",
    "set_process_priority",
    "set_process_affinity",
    "set_registry_value",
    "delete_registry_entry",
    "start_service",
    "stop_service",
    "restart_service",
    "enable_scheduled_task",
    "disable_scheduled_task",
    "run_scheduled_task",
    "set_active_power_plan",
    "set_hags_mode",
    "set_gpu_preference",
    "gaming_profile_apply",
    "wsl_execute",
    "wsl_send_signal",
    "steam_kill_game",
    "window_close",
    "window_minimise_all",
    "perf_purge_standby_list",
    "perf_empty_working_sets",
    "mem_write_bytes",
    "mem_write_int32",
    "mem_write_int64",
    "mem_write_float",
    "mem_write_double",
    "mem_allocate",
    "mem_free",
    "mem_protect",
    "mem_suspend_process",
    "mem_resume_process",
    "coord_assign_task",
];

const MAX_OUTPUT_BYTES: usize = 256 * 1024;

/// At most this many images of one result are handed to the model inline.
const MAX_INLINE_IMAGES: usize = 4;
/// An image larger than this stays on disk only: inlined as base64 it would
/// dominate the conversation (and most vision endpoints reject it anyway).
const MAX_INLINE_IMAGE_BYTES: usize = 4 * 1024 * 1024;

fn classify(tool: &str, guard_enabled: bool) -> ToolSafety {
    if guard_enabled && MUTATING_TOOLS.contains(&tool) {
        ToolSafety::Escalate
    } else {
        ToolSafety::Safe
    }
}

/// One WinClean tool exposed as a [`ToolExecutor`].
pub struct WincleanTool {
    definition: ToolDefinition,
}

impl WincleanTool {
    /// Builds the executor for a catalog entry with the given exposure.
    #[must_use]
    pub fn new(info: &ToolInfo, exposure: ToolExposure) -> Self {
        let input_schema = serde_json::from_value::<JsonSchema>(info.input_schema.clone())
            .unwrap_or_else(|_| JsonSchema::object(BTreeMap::new(), None, None));
        let definition = ToolDefinition::new(
            info.name.clone(),
            info.description.clone().unwrap_or_default(),
            input_schema,
        )
        .with_exposure(exposure);
        Self { definition }
    }
}

#[async_trait::async_trait]
impl ToolExecutor for WincleanTool {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, arguments: Value) -> Result<ToolOutput, ToolError> {
        invoke(&self.definition.name, arguments).await
    }

    fn safety(&self, _arguments: &Value) -> ToolSafety {
        classify(&self.definition.name, aphrody_guard::guardrails_enabled())
    }
}

/// Gateway tool: lists the WinClean catalog or invokes any tool by name.
pub struct WincleanGatewayTool {
    definition: ToolDefinition,
}

impl WincleanGatewayTool {
    #[must_use]
    pub fn new() -> Self {
        let mut properties = BTreeMap::new();
        properties.insert(
            "tool".into(),
            JsonSchema::string(Some(
                "WinClean tool to run (e.g. get_system_profile, list_processes, window_capture). \
                 Omit to list the catalog."
                    .into(),
            )),
        );
        properties.insert(
            "arguments".into(),
            JsonSchema {
                schema_type: Some(aphrody_toolcall::JsonSchemaType::Single(
                    aphrody_toolcall::JsonSchemaPrimitiveType::Object,
                )),
                description: Some(
                    "Arguments object for `tool` (see its schema via `filter`).".into(),
                ),
                ..Default::default()
            },
        );
        properties.insert(
            "filter".into(),
            JsonSchema::string(Some(
                "When listing: substring filter on tool names; an exact name also returns its \
                 input schema."
                    .into(),
            )),
        );
        let definition = ToolDefinition::new(
            WINCLEAN_GATEWAY,
            "Native Windows OS control via aphrody-winclean (166 tools: processes, memory, windows, \
             input, services, registry, files, power, network, WSL, Steam, WinML, reverse \
             engineering). Call without `tool` to list the catalog, then with `tool` + \
             `arguments` to run one.",
            JsonSchema::object(properties, None, Some(AdditionalProperties::Boolean(false))),
        );
        Self { definition }
    }
}

impl Default for WincleanGatewayTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl ToolExecutor for WincleanGatewayTool {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, arguments: Value) -> Result<ToolOutput, ToolError> {
        let tool = arguments.get("tool").and_then(Value::as_str).filter(|t| !t.is_empty());
        let Some(tool) = tool else {
            let filter = arguments.get("filter").and_then(Value::as_str).unwrap_or_default();
            return Ok(ToolOutput::ok(render_catalog(filter)));
        };
        if !aphrody_winclean::TOOL_NAMES.contains(&tool) {
            return Ok(ToolOutput::error(format!(
                "winclean: unknown tool `{tool}`; call without `tool` to list the catalog"
            )));
        }
        let args = arguments
            .get("arguments")
            .cloned()
            .unwrap_or_else(|| Value::Object(Default::default()));
        invoke(tool, args).await
    }

    fn safety(&self, arguments: &Value) -> ToolSafety {
        arguments
            .get("tool")
            .and_then(Value::as_str)
            .map_or(ToolSafety::Safe, |t| classify(t, aphrody_guard::guardrails_enabled()))
    }
}

/// Every WinClean executor: the gateway, the direct computer-use core, and the
/// rest of the catalog as deferred (dispatch-only) tools.
#[must_use]
pub fn winclean_tools() -> Vec<Arc<dyn ToolExecutor>> {
    profile_tools(WINCLEAN_DIRECT_TOOLS)
}

/// The gaming profile: the gateway, the computer-use core plus [`WINCLEAN_GAMING_TOOLS`] as direct
/// tools, and the rest of the catalog deferred.
#[must_use]
pub fn winclean_gaming_tools() -> Vec<Arc<dyn ToolExecutor>> {
    let direct: Vec<&str> =
        WINCLEAN_DIRECT_TOOLS.iter().chain(WINCLEAN_GAMING_TOOLS).copied().collect();
    profile_tools(&direct)
}

fn profile_tools(direct: &[&str]) -> Vec<Arc<dyn ToolExecutor>> {
    let mut tools: Vec<Arc<dyn ToolExecutor>> = vec![Arc::new(WincleanGatewayTool::new())];
    for info in aphrody_winclean::catalog() {
        let exposure = if direct.contains(&info.name.as_str()) {
            ToolExposure::Direct
        } else {
            ToolExposure::Deferred
        };
        tools.push(Arc::new(WincleanTool::new(info, exposure)));
    }
    tools
}

fn render_catalog(filter: &str) -> String {
    let catalog = aphrody_winclean::catalog();
    if let Some(exact) = catalog.iter().find(|t| t.name == filter) {
        return serde_json::to_string_pretty(exact).unwrap_or_default();
    }
    let mut out = String::new();
    for info in catalog.iter().filter(|t| t.name.contains(filter)) {
        let summary =
            info.description.as_deref().unwrap_or_default().split(". ").next().unwrap_or_default();
        out.push_str(&info.name);
        out.push_str(" — ");
        out.push_str(summary);
        out.push('\n');
    }
    if out.is_empty() { format!("winclean: no tool matches `{filter}`") } else { out }
}

async fn invoke(tool: &str, arguments: Value) -> Result<ToolOutput, ToolError> {
    let wc = match aphrody_winclean::shared() {
        Ok(wc) => wc,
        Err(error) => {
            return Ok(ToolOutput::error(format!(
                "{tool}: aphrody-winclean backend unavailable ({error}); \
                 update ../aphrody-os and rebuild aphrody"
            )));
        },
    };
    let args = if arguments.is_null() { Value::Object(Default::default()) } else { arguments };
    let result = wc.call_async(tool, &args).await.map_err(|error| ToolError::Execution {
        tool: tool.to_owned(),
        message: error.to_string(),
    })?;
    Ok(render_result(tool, &result))
}

/// Render a winclean result for the engine.
///
/// Every image is written under the temp dir and referenced by path in the
/// text (what a text-only model, a log reader or a follow-up tool call can
/// use); images within the inline budget are also attached to the output so a
/// vision model sees the screenshot itself.
fn render_result(tool: &str, result: &ToolResult) -> ToolOutput {
    let mut text = result.text();
    let mut inline = Vec::new();
    for (index, image) in result.images().iter().enumerate() {
        if inline.len() < MAX_INLINE_IMAGES && image.bytes.len() <= MAX_INLINE_IMAGE_BYTES {
            inline.push(ToolImage::new(
                image.mime_type.clone(),
                base64::engine::general_purpose::STANDARD.encode(&image.bytes),
            ));
        }
        let ext = image.mime_type.rsplit('/').next().unwrap_or("bin");
        let dir = std::env::temp_dir().join("aphrody-winclean");
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis());
        let path = dir.join(format!("{tool}-{stamp}-{index}.{ext}"));
        let saved =
            std::fs::create_dir_all(&dir).and_then(|()| std::fs::write(&path, &image.bytes));
        text.push_str(&match saved {
            Ok(()) => format!(
                "\n[{} {} bytes saved to {}]",
                image.mime_type,
                image.bytes.len(),
                path.display()
            ),
            Err(error) => {
                format!("\n[{} {} bytes not saved: {error}]", image.mime_type, image.bytes.len())
            },
        });
    }
    if text.len() > MAX_OUTPUT_BYTES {
        let mut cut = MAX_OUTPUT_BYTES;
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(cut);
        text.push_str("\n[output truncated]");
    }
    let output = if result.is_error { ToolOutput::error(text) } else { ToolOutput::ok(text) };
    output.with_images(inline)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A capture reaches the engine as an inline image (what a vision model
    /// looks at) and as a saved path in the text (what everything else uses).
    #[test]
    fn captured_image_is_attached_inline_and_referenced_by_path() {
        let png = b"\x89PNG\r\n\x1a\nfake";
        let encoded = base64::engine::general_purpose::STANDARD.encode(png);
        let result = ToolResult {
            content: vec![
                aphrody_winclean::Content::Text { text: "captured".to_owned() },
                aphrody_winclean::Content::Image {
                    data: encoded.clone(),
                    mime_type: "image/png".to_owned(),
                },
            ],
            structured_content: None,
            is_error: false,
        };

        let output = render_result("computer_capture_screen", &result);
        assert!(!output.is_error);
        assert_eq!(output.images, vec![ToolImage::new("image/png", encoded)]);
        assert!(output.content.starts_with("captured\n[image/png 12 bytes saved to "));
    }

    #[test]
    fn oversized_image_stays_on_disk_only() {
        let bytes = vec![0u8; MAX_INLINE_IMAGE_BYTES + 1];
        let result = ToolResult {
            content: vec![aphrody_winclean::Content::Image {
                data: base64::engine::general_purpose::STANDARD.encode(&bytes),
                mime_type: "image/png".to_owned(),
            }],
            structured_content: None,
            is_error: false,
        };
        let output = render_result("screenshot", &result);
        assert!(output.images.is_empty());
        assert!(output.content.contains("bytes saved to "));
    }

    #[test]
    fn every_catalog_tool_gets_an_executor() {
        let tools = winclean_tools();
        assert_eq!(tools.len(), aphrody_winclean::TOOL_NAMES.len() + 1);
        let direct: Vec<_> = tools
            .iter()
            .filter(|t| t.definition().exposure.is_model_visible())
            .map(|t| t.definition().name.clone())
            .collect();
        assert_eq!(direct.len(), WINCLEAN_DIRECT_TOOLS.len() + 1);
        for name in WINCLEAN_DIRECT_TOOLS {
            assert!(aphrody_winclean::TOOL_NAMES.contains(name), "unknown direct tool {name}");
        }
        for name in MUTATING_TOOLS {
            assert!(aphrody_winclean::TOOL_NAMES.contains(name), "unknown mutating tool {name}");
        }
    }

    #[test]
    fn schemas_round_trip_into_toolcall() {
        for tool in winclean_tools() {
            let schema = tool.definition().input_schema.to_value();
            assert_eq!(schema["type"], "object", "{}", tool.definition().name);
        }
        let click = WincleanTool::new(
            aphrody_winclean::catalog().iter().find(|t| t.name == "computer_click").unwrap(),
            ToolExposure::Direct,
        );
        let required = click.definition().input_schema.required.clone().unwrap_or_default();
        assert!(required.contains(&"x".to_owned()));
    }

    #[test]
    fn safety_is_permissive_unless_guarded() {
        assert_eq!(classify("delete_path", false), ToolSafety::Safe);
        assert_eq!(classify("delete_path", true), ToolSafety::Escalate);
        assert_eq!(classify("get_os_info", true), ToolSafety::Safe);
    }

    #[tokio::test]
    async fn gateway_lists_and_describes() {
        let gateway = WincleanGatewayTool::new();
        let list = gateway.handle(serde_json::json!({ "filter": "computer_" })).await.unwrap();
        assert!(list.content.contains("computer_observe"));
        let exact =
            gateway.handle(serde_json::json!({ "filter": "computer_click" })).await.unwrap();
        assert!(exact.content.contains("inputSchema"));
        let unknown = gateway.handle(serde_json::json!({ "tool": "nope" })).await.unwrap();
        assert!(unknown.is_error);
    }

    // Native DLL execution is an installation-level concern. Keep it out of the
    // portable workspace test suite: the system crate intentionally owns its
    // loader and does not expose a stable candidate-path API.
}
