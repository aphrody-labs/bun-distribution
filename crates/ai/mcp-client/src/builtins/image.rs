// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Built-in `view_image` tool for multimodal agents.

use std::path::Path;

#[cfg(not(target_arch = "wasm32"))]
use aphrody_toolcall::ToolImage;
use aphrody_toolcall::{ToolDefinition, ToolError, ToolExecutor, ToolExposure, ToolOutput};
use async_trait::async_trait;
#[cfg(not(target_arch = "wasm32"))]
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde_json::Value as JsonValue;

/// Built-in tool allowing an agent to view and inspect local image files.
pub struct ViewImageTool {
    definition: ToolDefinition,
}

impl Default for ViewImageTool {
    fn default() -> Self {
        Self::new()
    }
}

impl ViewImageTool {
    /// Create a new `view_image` tool instance.
    #[must_use]
    pub fn new() -> Self {
        let schema = aphrody_toolcall::JsonSchema::object(
            [(
                "path".to_string(),
                aphrody_toolcall::JsonSchema::string(Some(
                    "Filesystem path to the local image (.png, .jpg, .jpeg, .webp, .gif)."
                        .to_string(),
                )),
            )]
            .into_iter()
            .collect(),
            Some(vec!["path".to_string()]),
            None,
        );

        let definition = ToolDefinition::new(
            "view_image",
            "Load a local image file and inspect it visually (for vision-capable models).",
            schema,
        )
        .with_exposure(ToolExposure::Direct);

        Self { definition }
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
impl ToolExecutor for ViewImageTool {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, arguments: JsonValue) -> Result<ToolOutput, ToolError> {
        let path_str = arguments.get("path").and_then(JsonValue::as_str).ok_or_else(|| {
            ToolError::InvalidArguments {
                tool: "view_image".to_string(),
                message: "missing required argument `path` (string)".to_string(),
            }
        })?;

        let path = Path::new(path_str);

        #[cfg(not(target_arch = "wasm32"))]
        {
            if !path.exists() {
                return Ok(ToolOutput::error(format!("File not found: `{}`", path.display())));
            }

            let bytes = tokio::fs::read(path).await.map_err(|e| ToolError::Execution {
                tool: "view_image".to_string(),
                message: format!("failed to read `{}`: {e}", path.display()),
            })?;

            let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();

            let mime = match ext.as_str() {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "webp" => "image/webp",
                "gif" => "image/gif",
                "bmp" => "image/bmp",
                _ => "image/png",
            };

            let b64 = BASE64.encode(&bytes);
            let image = ToolImage::new(mime, b64);

            let msg = format!(
                "Successfully loaded image `{}` ({} bytes, MIME: {})",
                path.display(),
                bytes.len(),
                mime
            );

            Ok(ToolOutput::ok(msg).with_images(vec![image]))
        }

        #[cfg(target_arch = "wasm32")]
        {
            let _ = path;
            Err(ToolError::Execution {
                tool: "view_image".to_string(),
                message: "filesystem image viewing is not supported on wasm32".to_string(),
            })
        }
    }
}
