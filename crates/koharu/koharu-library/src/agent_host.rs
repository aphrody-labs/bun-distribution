//! A non-Tauri Koharu project host for the existing agent runtime.

use std::sync::Arc;

use anyhow::{Result, bail};
use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use image::{ExtendedColorType, ImageEncoder as _, codecs::png::PngEncoder};
use koharu_agent::{Control, Host, Invocation, Tool, ToolCall};
use koharu_pipeline::{Request, RunStatus, StopToken};
use koharu_rasterizer::{RasterOptions, Rasterizer};
use koharu_renderer::Renderer;
use serde_json::{Value, json};
use tokio::sync::{Mutex, OnceCell};

use crate::{
    Library, PipelineConfig, ProvidersConfig, Scope,
    agent_tools::*,
    project::{GeometryUpdate, Project, Typography, TypographyUpdate},
};

pub struct ProjectHost {
    project: Arc<Mutex<Project>>,
    renderer: Renderer,
    rasterizer: OnceCell<Arc<Rasterizer>>,
    pipeline: OnceCell<Library>,
    cpu: bool,
}

impl ProjectHost {
    pub fn new(project: Arc<Mutex<Project>>, cpu: bool) -> Result<Self> {
        Ok(Self {
            project,
            renderer: Renderer::new()?,
            rasterizer: OnceCell::new(),
            pipeline: OnceCell::new(),
            cpu,
        })
    }

    async fn context_value(&self) -> Result<Value> {
        let (info, pages) = {
            let project = self.project.lock().await;
            let snapshot = project.snapshot();
            let pages = Project::pages(&snapshot)?
                .into_iter()
                .map(|page| Project::page(&snapshot, page.id))
                .collect::<Result<Vec<_>>>()?;
            (project.info(), pages)
        };
        let pipeline = PipelineConfig::load()?.read()?.clone();
        let typesetting = koharu_renderer::TypesettingConfig::load()?.read()?.clone();
        let providers = ProvidersConfig::load()?.read()?.entries().into_iter()
            .map(|config| -> Result<Value> {
                let provider = config.provider();
                let configured = if provider == koharu_translator::Provider::Local {
                    false
                } else {
                    let key: &'static str = provider.into();
                    koharu_secrets::get(key)?.is_some()
                };
                Ok(json!({"name": provider.name(), "config": config, "credential_configured": configured}))
            }).collect::<Result<Vec<_>>>()?;
        let fonts = self.renderer.available_fonts().await?;
        Ok(json!({
            "project": info,
            "pages": pages,
            "configuration": {
                "pipeline": pipeline,
                "providers": providers,
                "typesetting": typesetting,
                "available_fonts": fonts.into_iter().map(|font| font.name).collect::<Vec<_>>(),
            },
        }))
    }

    async fn pipeline(&self) -> Result<&Library> {
        self.pipeline
            .get_or_try_init(|| async {
                let config = PipelineConfig::load()?.read()?.clone();
                let providers = ProvidersConfig::load()?.read()?.clone();
                Library::initialize(config, providers, self.cpu).await
            })
            .await
    }

    async fn rendered_page(&self, page: koharu_scene::EntityId) -> Result<(String, Vec<u8>)> {
        let (label, snapshot) = {
            let project = self.project.lock().await;
            let snapshot = project.snapshot();
            let label = snapshot.page(page)?.page()?.label;
            (label, snapshot)
        };
        let frame = self.renderer.render(&snapshot, page).await?;
        let rasterizer = self
            .rasterizer
            .get_or_try_init(|| async { Rasterizer::new().map(Arc::new) })
            .await?;
        let raster = rasterizer.rasterize(&frame.raster_frame()?, RasterOptions::default())?;
        let image = raster.image;
        let mut bytes = Vec::new();
        PngEncoder::new(&mut bytes).write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            ExtendedColorType::Rgba8,
        )?;
        Ok((label, bytes))
    }
}

#[async_trait]
impl Host for ProjectHost {
    async fn context(&self) -> Result<Value> {
        self.context_value().await
    }

    fn tools(&self) -> Vec<Tool> {
        definitions()
    }

    async fn invoke(&self, call: ToolCall, control: &Control) -> Result<Invocation> {
        match call.name.as_str() {
            "inspect_project" => {
                let _: InspectProject = arguments(&call)?;
                Invocation::read(self.context_value().await?)
            }
            "view_page" => {
                let args: ViewPage = arguments(&call)?;
                let page = entity(&args.page)?;
                let (label, bytes) = self.rendered_page(page).await?;
                Ok(
                    Invocation::read(json!({"page": page, "label": label}))?.with_image(
                        format!("Rendered page {label} ({page})"),
                        format!("data:image/png;base64,{}", STANDARD.encode(bytes)),
                    ),
                )
            }
            "rename_page" => {
                let args: RenamePage = arguments(&call)?;
                let page = entity(&args.page)?;
                self.project
                    .lock()
                    .await
                    .rename_page(page, args.label)
                    .await?;
                Invocation::changed(json!({"page": page}))
            }
            "move_page" => {
                let args: MovePage = arguments(&call)?;
                let page = entity(&args.page)?;
                self.project
                    .lock()
                    .await
                    .move_page(page, args.index)
                    .await?;
                Invocation::changed(json!({"page": page}))
            }
            "delete_pages" => {
                let args: DeletePages = arguments(&call)?;
                let pages = entities(&args.pages)?;
                let mut project = self.project.lock().await;
                project.delete_pages(pages.clone()).await?;
                project.reconcile_page();
                Invocation::changed(json!({"pages": pages}))
            }
            "add_text_box" => {
                let args: AddTextBox = arguments(&call)?;
                let page = entity(&args.page)?;
                let frame = koharu_desktop::Frame {
                    x: args.x,
                    y: args.y,
                    width: args.width,
                    height: args.height,
                    angle_degrees: args.angle_degrees,
                };
                let (_, element) = self.project.lock().await.add_text_box(page, frame).await?;
                Invocation::changed(json!({"page": page, "element": element}))
            }
            "set_source_text" => {
                let args: SetText = arguments(&call)?;
                let element = entity(&args.element)?;
                self.project
                    .lock()
                    .await
                    .set_source_text(element, args.text)
                    .await?;
                Invocation::changed(json!({"element": element}))
            }
            "set_translation" => {
                let args: SetTranslation = arguments(&call)?;
                let element = entity(&args.element)?;
                self.project
                    .lock()
                    .await
                    .set_translation(element, args.text)
                    .await?;
                Invocation::changed(json!({"element": element}))
            }
            "set_typography" => {
                let args: SetTypography = arguments(&call)?;
                let element = entity(&args.element)?;
                let typography = Typography {
                    preferred_font: args.preferred_font,
                    font_weight: args.font_weight,
                    font_style: args.font_style.map(Into::into),
                    size: args.size,
                    auto_fit: args.auto_fit,
                    color: args.color,
                    stroke_color: args.stroke_color,
                    stroke_width: args.stroke_width,
                    alignment: args.alignment.map(Into::into),
                    writing_mode: args.writing_mode.map(Into::into),
                };
                self.project
                    .lock()
                    .await
                    .set_typography(vec![TypographyUpdate {
                        layer: element,
                        typography,
                    }])
                    .await?;
                Invocation::changed(json!({"element": element}))
            }
            "set_geometry" => {
                let args: SetGeometry = arguments(&call)?;
                let element = entity(&args.element)?;
                let points = args
                    .points
                    .into_iter()
                    .map(|point| crate::project::Point {
                        x: point.x,
                        y: point.y,
                    })
                    .collect();
                self.project
                    .lock()
                    .await
                    .set_geometry(vec![GeometryUpdate {
                        layer: element,
                        points: Some(points),
                    }])
                    .await?;
                Invocation::changed(json!({"element": element}))
            }
            "set_visibility" => {
                let args: SetVisibility = arguments(&call)?;
                let elements = entities(&args.elements)?;
                self.project
                    .lock()
                    .await
                    .set_visibility(elements.clone(), args.visible, args.opacity)
                    .await?;
                Invocation::changed(json!({"elements": elements}))
            }
            "delete_elements" => {
                let args: DeleteElements = arguments(&call)?;
                let elements = entities(&args.elements)?;
                self.project
                    .lock()
                    .await
                    .delete_layers(elements.clone())
                    .await?;
                Invocation::changed(json!({"elements": elements}))
            }
            "move_element" => {
                let args: MoveElement = arguments(&call)?;
                let element = entity(&args.element)?;
                let parent = entity(&args.parent)?;
                self.project
                    .lock()
                    .await
                    .move_layer(element, parent, args.index)
                    .await?;
                Invocation::changed(json!({"element": element, "parent": parent}))
            }
            "run_pipeline" => {
                let args: RunPipeline = arguments(&call)?;
                let scope: Scope = args.scope()?;
                let stop = StopToken::default();
                let cancellation = {
                    let control = control.clone();
                    let stop = stop.clone();
                    tokio::spawn(async move {
                        control.cancelled().await;
                        stop.stop();
                    })
                };
                let library = self.pipeline().await?;
                let mut project = self.project.lock().await;
                let report = library
                    .process_project(
                        &mut project,
                        Request {
                            operation: args.operation.into(),
                            scope,
                            stop,
                            ..Request::default()
                        },
                    )
                    .await;
                cancellation.abort();
                let report = report?;
                if report.status == RunStatus::Stopped {
                    bail!("pipeline was cancelled");
                }
                Invocation::changed(json!({
                    "completed": report.completed,
                    "total": report.total,
                    "revision": report.final_revision,
                }))
            }
            name => bail!("unknown Koharu tool {name}"),
        }
    }
}
