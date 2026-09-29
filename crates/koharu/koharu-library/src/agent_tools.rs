use anyhow::{Context as _, Result, bail};
use koharu_agent::{Tool, ToolCall};
use koharu_pipeline::{Operation, Scope, Stage};
use koharu_scene::EntityId;
use schemars::{JsonSchema, schema_for};
use serde::Deserialize;
use serde_json::Value;

pub fn definition<T: JsonSchema>(name: &str, description: &str) -> Tool {
    Tool::new(
        name,
        description,
        serde_json::to_value(schema_for!(T)).expect("tool argument schema must serialize"),
    )
}

/// Project tools shared by the Tauri and headless agent hosts.
pub fn definitions() -> Vec<Tool> {
    vec![
        definition::<InspectProject>("inspect_project", "Read the latest semantic project state without page images."),
        definition::<ViewPage>("view_page", "Render and inspect one page image."),
        definition::<RenamePage>("rename_page", "Rename a project page."),
        definition::<MovePage>("move_page", "Move a page to a zero-based project index."),
        definition::<DeletePages>("delete_pages", "Delete pages and their contents."),
        definition::<AddTextBox>("add_text_box", "Add a paragraph text box to a page."),
        definition::<SetText>("set_source_text", "Replace an element's source text."),
        definition::<SetTranslation>("set_translation", "Set an element's translation, or pass null to remove it."),
        definition::<SetTypography>("set_typography", "Replace an element's typography settings."),
        definition::<SetGeometry>("set_geometry", "Replace an element's page-space polygon geometry."),
        definition::<SetVisibility>("set_visibility", "Change visibility and/or opacity for elements."),
        definition::<DeleteElements>("delete_elements", "Delete elements and descendants."),
        definition::<MoveElement>("move_element", "Move an element under a page or element at a zero-based index."),
        definition::<RunPipeline>("run_pipeline", "Run the configured pipeline for the project, selected pages, or selected text elements."),
    ]
}

pub fn arguments<T: for<'de> Deserialize<'de>>(call: &ToolCall) -> Result<T> {
    serde_json::from_str(&call.arguments)
        .with_context(|| format!("invalid arguments for {}", call.name))
}

pub fn entity(value: &str) -> Result<EntityId> {
    serde_json::from_value(Value::String(value.to_owned()))
        .with_context(|| format!("invalid entity ID {value}"))
}

pub fn entities(values: &[String]) -> Result<Vec<EntityId>> {
    values.iter().map(|value| entity(value)).collect()
}

#[derive(Deserialize, JsonSchema)]
pub struct InspectProject {}

#[derive(Deserialize, JsonSchema)]
pub struct ViewPage {
    pub page: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct RenamePage {
    pub page: String,
    pub label: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct MovePage {
    pub page: String,
    pub index: usize,
}

#[derive(Deserialize, JsonSchema)]
pub struct DeletePages {
    pub pages: Vec<String>,
}

#[derive(Deserialize, JsonSchema)]
pub struct AddTextBox {
    pub page: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    #[serde(default)]
    pub angle_degrees: f32,
}

#[derive(Deserialize, JsonSchema)]
pub struct SetText {
    pub element: String,
    pub text: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct SetTranslation {
    pub element: String,
    pub text: Option<String>,
}

#[derive(Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentTextAlignment {
    Start,
    Center,
    End,
    Justify,
}

impl From<AgentTextAlignment> for koharu_scene::TextAlignment {
    fn from(value: AgentTextAlignment) -> Self {
        match value {
            AgentTextAlignment::Start => Self::Start,
            AgentTextAlignment::Center => Self::Center,
            AgentTextAlignment::End => Self::End,
            AgentTextAlignment::Justify => Self::Justify,
        }
    }
}

#[derive(Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentWritingMode {
    Horizontal,
    Vertical,
}

#[derive(Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentFontStyle {
    Normal,
    Italic,
    Oblique,
}

impl From<AgentFontStyle> for koharu_scene::FontStyle {
    fn from(value: AgentFontStyle) -> Self {
        match value {
            AgentFontStyle::Normal => Self::Normal,
            AgentFontStyle::Italic => Self::Italic,
            AgentFontStyle::Oblique => Self::Oblique,
        }
    }
}

impl From<AgentWritingMode> for koharu_scene::WritingMode {
    fn from(value: AgentWritingMode) -> Self {
        match value {
            AgentWritingMode::Horizontal => Self::Horizontal,
            AgentWritingMode::Vertical => Self::Vertical,
        }
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct SetTypography {
    pub element: String,
    pub preferred_font: Option<String>,
    pub font_weight: Option<u16>,
    pub font_style: Option<AgentFontStyle>,
    pub size: Option<f32>,
    pub auto_fit: bool,
    pub color: Option<[u8; 4]>,
    pub stroke_color: Option<[u8; 4]>,
    pub stroke_width: Option<f32>,
    pub alignment: Option<AgentTextAlignment>,
    pub writing_mode: Option<AgentWritingMode>,
}

#[derive(Deserialize, JsonSchema)]
pub struct SetGeometry {
    pub element: String,
    pub points: Vec<AgentPoint>,
}

#[derive(Deserialize, JsonSchema)]
pub struct AgentPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Deserialize, JsonSchema)]
pub struct SetVisibility {
    pub elements: Vec<String>,
    pub visible: Option<bool>,
    pub opacity: Option<f32>,
}

#[derive(Deserialize, JsonSchema)]
pub struct DeleteElements {
    pub elements: Vec<String>,
}

#[derive(Deserialize, JsonSchema)]
pub struct MoveElement {
    pub element: String,
    pub parent: String,
    pub index: usize,
}

#[derive(Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentPipelineOperation {
    Full,
    Detection,
    Ocr,
    Translation,
    Inpainting,
}

impl From<AgentPipelineOperation> for Operation {
    fn from(value: AgentPipelineOperation) -> Self {
        match value {
            AgentPipelineOperation::Full => Self::Full,
            AgentPipelineOperation::Detection => Self::Only {
                stage: Stage::Detection,
            },
            AgentPipelineOperation::Ocr => Self::Only { stage: Stage::Ocr },
            AgentPipelineOperation::Translation => Self::Only {
                stage: Stage::Translation,
            },
            AgentPipelineOperation::Inpainting => Self::Only {
                stage: Stage::Inpainting,
            },
        }
    }
}

#[derive(Deserialize, JsonSchema)]
pub struct RunPipeline {
    pub operation: AgentPipelineOperation,
    #[serde(default)]
    pub pages: Vec<String>,
    #[serde(default)]
    pub elements: Vec<String>,
}

impl RunPipeline {
    pub fn scope(&self) -> Result<Scope> {
        match (self.pages.is_empty(), self.elements.is_empty()) {
            (true, true) => Ok(Scope::Project),
            (false, true) => Ok(Scope::Pages(entities(&self.pages)?)),
            (true, false) => Ok(Scope::Entities(entities(&self.elements)?)),
            (false, false) => bail!("pipeline scope cannot contain both pages and elements"),
        }
    }
}
