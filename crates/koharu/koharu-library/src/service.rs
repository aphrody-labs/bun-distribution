// SPDX-License-Identifier: MIT OR Apache-2.0
//! Native in-process Koharu service and RPC dispatcher.
//!
//! Provides direct in-process execution of all Koharu document, pipeline,
//! project, canvas, and translation operations without spawning external subprocesses.

use std::{path::PathBuf, sync::Arc};

use anyhow::{Context as _, Result, bail};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use koharu_desktop::Desktop;
use koharu_agent::{Agent, Codex, Config as AgentConfig, Control, RunId};
use koharu_pipeline::{Progress, RunStatus, StopToken};
use koharu_rasterizer::ResourceId;
use koharu_scene::EntityId;
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};
use tokio::sync::{Mutex, mpsc};

use crate::agent_host::ProjectHost;
use crate::project::{
    GeometryUpdate, Point, Project, ProjectLibrary, RasterStrokeMode, TypographyUpdate,
};
use crate::{
    Library, Operation, PipelineConfig, ProvidersConfig, Request, Scope,
    renderer::TypesettingConfig,
    secrets,
    translator::{Provider, ProviderConfig, Translator},
};

pub struct ActiveAgent {
    pub run: RunId,
    pub control: Control,
    pub task: tokio::task::JoinHandle<()>,
}

pub struct ActiveLogin {
    pub control: Control,
    pub task: tokio::task::JoinHandle<()>,
}

pub struct ActivePipeline {
    pub job: u64,
    pub stop: StopToken,
    pub task: tokio::task::JoinHandle<()>,
}

pub struct Service {
    pub projects: ProjectLibrary,
    pub project: Option<Arc<Mutex<Project>>>,
    pub library: Option<(bool, Library)>,
    pub desktop: Option<Desktop>,
    pub agent: Option<ActiveAgent>,
    pub agent_instance: Option<(bool, Arc<Agent<ProjectHost>>)>,
    pub login: Option<ActiveLogin>,
    pub pipeline: Option<ActivePipeline>,
    pub next_job: u64,
    pub output: mpsc::UnboundedSender<Value>,
}

impl Service {
    pub fn new(output: mpsc::UnboundedSender<Value>) -> Result<Self> {
        Self::with_root(None, output)
    }

    pub fn with_root(root: Option<PathBuf>, output: mpsc::UnboundedSender<Value>) -> Result<Self> {
        let projects = match root {
            Some(root) => ProjectLibrary::at(root)?,
            None => ProjectLibrary::new()?,
        };
        Ok(Self {
            projects,
            project: None,
            library: None,
            desktop: None,
            agent: None,
            agent_instance: None,
            login: None,
            pipeline: None,
            next_job: 0,
            output,
        })
    }

    pub async fn project(&self) -> Result<tokio::sync::MutexGuard<'_, Project>> {
        Ok(self
            .project
            .as_ref()
            .context("no project is open")?
            .lock()
            .await)
    }

    pub fn active_agent(&mut self) -> Option<&ActiveAgent> {
        if self
            .agent
            .as_ref()
            .is_some_and(|agent| agent.task.is_finished())
        {
            self.agent = None;
        }
        self.agent.as_ref()
    }

    pub fn active_login(&mut self) -> Option<&ActiveLogin> {
        if self
            .login
            .as_ref()
            .is_some_and(|login| login.task.is_finished())
        {
            self.login = None;
        }
        self.login.as_ref()
    }

    pub fn active_pipeline(&mut self) -> Option<&ActivePipeline> {
        if self
            .pipeline
            .as_ref()
            .is_some_and(|job| job.task.is_finished())
        {
            self.pipeline = None;
        }
        self.pipeline.as_ref()
    }

    pub fn desktop(&mut self) -> Result<&Desktop> {
        if self.desktop.is_none() {
            self.desktop = Some(Desktop::new()?);
        }
        Ok(self.desktop.as_ref().expect("desktop was initialized"))
    }

    pub async fn library(&mut self, cpu: bool) -> Result<&Library> {
        if self.library.is_none() {
            let pipeline = PipelineConfig::load()?.read()?.clone();
            let providers = ProvidersConfig::load()?.read()?.clone();
            self.library = Some((cpu, Library::initialize(pipeline, providers, cpu).await?));
        }
        let (selected_cpu, library) = self.library.as_ref().expect("library was initialized");
        if *selected_cpu != cpu {
            bail!("compute device is fixed for this SDK process");
        }
        Ok(library)
    }

    pub async fn call(&mut self, method: &str, value: Value) -> Result<Value> {
        match method {
            "agent.status" => {
                let authenticated = Codex::new()?.account()?.is_some();
                let running = self.active_agent().map(|agent| agent.run);
                let login_running = self.active_login().is_some();
                let config = AgentConfig::load()?.read()?.clone();
                Ok(
                    json!({"authenticated": authenticated, "running": running, "login_running": login_running, "config": config}),
                )
            }
            "agent.models" => Ok(json!(Codex::new()?.models().await?)),
            "agent.setConfig" => {
                let AgentPreference { config } = decode(value)?;
                let saved = if let Some((_, agent)) = &self.agent_instance {
                    agent.save_config(config)?
                } else {
                    let stored = AgentConfig::load()?;
                    let mut current = stored.write()?;
                    *current = config;
                    let saved = current.clone();
                    current.save()?;
                    saved
                };
                Ok(json!({"config": saved}))
            }
            "agent.clear" => {
                if self.active_agent().is_some() {
                    bail!("cannot clear agent history during a run");
                }
                if let Some((_, agent)) = &self.agent_instance {
                    agent.clear().await;
                }
                Ok(Value::Null)
            }
            "agent.login" => {
                if self.active_login().is_some() {
                    bail!("agent login is already active");
                }
                let codex = Codex::new()?;
                let control = Control::default();
                let task_control = control.clone();
                let output = self.output.clone();
                let task = tokio::spawn(async move {
                    let result = codex
                        .login_device(&task_control, |event| {
                            let _ = output.send(json!({"event": "agent_login", "value": event}));
                        })
                        .await;
                    let value = match result {
                        Ok(_) => json!({"type": "completed", "authenticated": true}),
                        Err(_) if task_control.is_cancelled() => json!({"type": "cancelled"}),
                        Err(error) => json!({"type": "failed", "message": format!("{error:#}")}),
                    };
                    let _ = output.send(json!({"event": "agent_login", "value": value}));
                });
                self.login = Some(ActiveLogin { control, task });
                Ok(json!({"started": true}))
            }
            "agent.cancelLogin" => {
                let login = self.active_login().context("no agent login is active")?;
                login.control.cancel();
                Ok(json!({"cancelled": true}))
            }
            "agent.logout" => {
                if self.active_agent().is_some() || self.active_login().is_some() {
                    bail!("cancel the active agent work before logout");
                }
                Codex::new()?.logout()?;
                self.agent_instance = None;
                Ok(json!({"authenticated": false}))
            }
            "agent.run" => {
                let AgentRun { prompt, cpu } = decode(value)?;
                if prompt.trim().is_empty() {
                    bail!("agent prompt must not be empty");
                }
                if self.active_agent().is_some() {
                    bail!("an agent run is already active");
                }
                if self.active_pipeline().is_some() {
                    bail!("a pipeline job is active");
                }
                if self.active_login().is_some() {
                    bail!("agent login is active");
                }
                let codex = Codex::new()?;
                if codex.account()?.is_none() {
                    bail!("Codex account is not authenticated");
                }
                let cpu = cpu.unwrap_or(false);
                let agent = match &self.agent_instance {
                    Some((selected_cpu, agent)) => {
                        if *selected_cpu != cpu {
                            bail!("agent compute device is fixed while the project is open");
                        }
                        Arc::clone(agent)
                    }
                    None => {
                        let project =
                            Arc::clone(self.project.as_ref().context("no project is open")?);
                        let agent = Arc::new(Agent::new(codex, ProjectHost::new(project, cpu)?)?);
                        self.agent_instance = Some((cpu, Arc::clone(&agent)));
                        agent
                    }
                };
                let run = RunId::new();
                let control = Control::default();
                let task_control = control.clone();
                let output = self.output.clone();
                let task = tokio::spawn(async move {
                    let _ = agent
                        .run(run, prompt, task_control, |event| {
                            let _ =
                                output.send(json!({"event": "agent", "run": run, "value": event}));
                        })
                        .await;
                });
                self.agent = Some(ActiveAgent { run, control, task });
                Ok(json!({"run": run}))
            }
            "agent.cancel" => {
                let AgentCancel { run } = decode(value)?;
                let agent = self.active_agent().context("no agent run is active")?;
                if agent.run != run {
                    bail!("agent run identifier does not match the active run");
                }
                agent.control.cancel();
                Ok(json!({"cancelled": true}))
            }
            "preferences.get" => {
                let pipeline = PipelineConfig::load()?.read()?.clone();
                let providers = ProvidersConfig::load()?.read()?.clone();
                let typesetting = TypesettingConfig::load()?.read()?.clone();
                let entries = providers
                    .entries()
                    .into_iter()
                    .map(|config| -> Result<Value> {
                        let provider = config.provider();
                        let configured = if provider == Provider::Local {
                            false
                        } else {
                            let key: &'static str = provider.into();
                            secrets::get(key)?.is_some()
                        };
                        Ok(json!({"config": config, "credential_configured": configured}))
                    })
                    .collect::<Result<Vec<_>>>()?;
                Ok(json!({"pipeline": pipeline, "providers": entries, "typesetting": typesetting}))
            }
            "preferences.setPipeline" => {
                let PipelinePreference { mut pipeline } = decode(value)?;
                pipeline.remember_selected_profiles();
                pipeline.validate()?;
                let config = PipelineConfig::load()?;
                let mut current = config.write()?;
                *current = pipeline;
                current.save()?;
                self.library = None;
                Ok(json!({"pipeline": config.read()?.clone()}))
            }
            "preferences.setProviders" => {
                let ProviderPreferences { entries } = decode(value)?;
                let providers = ProvidersConfig::from_entries(entries)?;
                let config = ProvidersConfig::load()?;
                let mut current = config.write()?;
                *current = providers;
                current.save()?;
                self.library = None;
                Ok(json!({"providers": config.read()?.entries()}))
            }
            "preferences.setTypesetting" => {
                let TypesettingPreference { typesetting } = decode(value)?;
                let config = TypesettingConfig::load()?;
                let mut current = config.write()?;
                *current = typesetting;
                current.save()?;
                self.library = None;
                self.desktop = None;
                Ok(json!({"typesetting": config.read()?.clone()}))
            }
            "preferences.setCredential" => {
                let CredentialPreference {
                    provider,
                    value,
                    clear,
                } = decode(value)?;
                let provider: Provider = provider.parse()?;
                if provider == Provider::Local {
                    bail!("local translation does not accept credentials");
                }
                let key: &'static str = provider.into();
                if clear.unwrap_or(false) {
                    secrets::delete(key)?;
                } else if let Some(value) = value {
                    if value.trim().is_empty() {
                        secrets::delete(key)?;
                    } else {
                        secrets::set(key, &value.into())?;
                    }
                } else {
                    bail!("credential value or clear must be provided");
                }
                self.library = None;
                Ok(json!({"credential_configured": secrets::get(key)?.is_some()}))
            }
            "models.translation" => Ok(json!(Translator::models().await?)),
            "models.pipeline" => Ok(json!(PipelineConfig::model_catalog())),
            "resources.status" => {
                let sample = self
                    .library
                    .as_ref()
                    .map(|(_, library)| library.resource_snapshot());
                Ok(json!({
                    "store": crate::runtime::Store::root(),
                    "device": koharu_ml::device(false),
                    "sample": sample.map(|sample| json!({
                        "process_memory_bytes": sample.process_memory_bytes,
                        "system_memory_bytes": sample.system_memory_bytes,
                        "process_cpu_percent": sample.process_cpu_percent,
                        "devices": sample.devices.into_iter().map(|device| json!({
                            "name": device.name,
                            "selected": device.selected,
                            "memory_budget_bytes": device.memory_budget_bytes,
                            "memory_used_bytes": device.memory_used_bytes,
                            "utilization_percent": device.utilization_percent,
                        })).collect::<Vec<_>>(),
                    })),
                }))
            }
            "project.list" => Ok(json!(self.projects.list()?)),
            "project.delete" => {
                let Named { name } = decode(value)?;
                if let Some(open) = &self.project {
                    if open.lock().await.info().name == name {
                        bail!("close the project before deleting it");
                    }
                }
                self.projects.delete(&name)?;
                Ok(Value::Null)
            }
            "project.create" | "project.open" => {
                let Named { name } = decode(value)?;
                if self.project.is_some() {
                    bail!("close the current project first");
                }
                let project = if method == "project.create" {
                    self.projects.create(&name).await?
                } else {
                    self.projects.open(&name).await?
                };
                let info = project.info();
                self.project = Some(Arc::new(Mutex::new(project)));
                Ok(json!(info))
            }
            "project.close" => {
                if self.active_agent().is_some() {
                    bail!("cancel the active agent run before closing the project");
                }
                if self.active_pipeline().is_some() {
                    bail!("cancel the active pipeline job before closing the project");
                }
                self.project = None;
                self.agent_instance = None;
                self.desktop = None;
                Ok(Value::Null)
            }
            "project.info" => Ok(json!(self.project().await?.info())),
            "project.pages" => {
                let snapshot = self.project().await?.snapshot();
                Ok(json!(Project::pages(&snapshot)?))
            }
            "project.page" => {
                let PageId { page } = decode(value)?;
                let snapshot = self.project().await?.snapshot();
                Ok(json!(Project::page(&snapshot, page)?))
            }
            "project.selectPage" => {
                let PageId { page } = decode(value)?;
                let mut project = self.project().await?;
                project.select_page(page)?;
                Ok(json!(project.info()))
            }
            "project.importPaths" => {
                let Paths { paths } = decode(value)?;
                let mut project = self.project().await?;
                let (_, pages) = project.import_paths(paths).await?;
                Ok(json!({"pages": pages, "project": project.info()}))
            }
            "page.rename" => {
                let Rename { page, label } = decode(value)?;
                let mut project = self.project().await?;
                project.rename_page(page, label).await?;
                Ok(json!(project.info()))
            }
            "page.delete" => {
                let Pages { pages } = decode(value)?;
                let mut project = self.project().await?;
                project.delete_pages(pages).await?;
                project.reconcile_page();
                Ok(json!(project.info()))
            }
            "page.move" => {
                let MovePage { page, index } = decode(value)?;
                let mut project = self.project().await?;
                project.move_page(page, index).await?;
                Ok(json!(project.info()))
            }
            "text.addPoint" => {
                let AddPoint { page, point } = decode(value)?;
                let mut project = self.project().await?;
                let (_, layer) = project.add_point_text(page, point).await?;
                Ok(json!({"layer": layer, "project": project.info()}))
            }
            "text.addBox" => {
                let AddBox { page, frame } = decode(value)?;
                let mut project = self.project().await?;
                let (_, layer) = project.add_text_box(page, frame).await?;
                Ok(json!({"layer": layer, "project": project.info()}))
            }
            "text.setSource" => {
                let SetText { layer, text } = decode(value)?;
                let mut project = self.project().await?;
                project.set_source_text(layer, text).await?;
                Ok(json!(project.info()))
            }
            "text.setTranslation" => {
                let SetTranslation { layer, text } = decode(value)?;
                let mut project = self.project().await?;
                project.set_translation(layer, text).await?;
                Ok(json!(project.info()))
            }
            "text.setTypography" => {
                let Updates { updates }: Updates<TypographyUpdate> = decode(value)?;
                let mut project = self.project().await?;
                project.set_typography(updates).await?;
                Ok(json!(project.info()))
            }
            "layer.setGeometry" => {
                let Updates { updates }: Updates<GeometryUpdate> = decode(value)?;
                let mut project = self.project().await?;
                project.set_geometry(updates).await?;
                Ok(json!(project.info()))
            }
            "layer.setVisibility" => {
                let Visibility {
                    layers,
                    visible,
                    opacity,
                } = decode(value)?;
                let mut project = self.project().await?;
                project.set_visibility(layers, visible, opacity).await?;
                Ok(json!(project.info()))
            }
            "layer.delete" => {
                let Layers { layers } = decode(value)?;
                let mut project = self.project().await?;
                project.delete_layers(layers).await?;
                Ok(json!(project.info()))
            }
            "layer.move" => {
                let MoveLayer {
                    layer,
                    parent,
                    index,
                } = decode(value)?;
                let mut project = self.project().await?;
                project.move_layer(layer, parent, index).await?;
                Ok(json!(project.info()))
            }
            "raster.stroke" => {
                let RasterStroke {
                    page,
                    layer,
                    mode,
                    color,
                    diameter,
                    points,
                } = decode(value)?;
                let mode = match mode.as_str() {
                    "paint" => RasterStrokeMode::Paint,
                    "erase" => RasterStrokeMode::Erase,
                    _ => bail!("raster mode must be paint or erase"),
                };
                let mut project = self.project().await?;
                let (_, layer) = project
                    .apply_raster_stroke(
                        page,
                        layer,
                        mode,
                        color,
                        diameter,
                        points
                            .into_iter()
                            .map(|point| koharu_scene::Point {
                                x: point.x,
                                y: point.y,
                            })
                            .collect(),
                    )
                    .await?;
                Ok(json!({"layer": layer, "project": project.info()}))
            }
            "project.undo" | "project.redo" => {
                let mut project = self.project().await?;
                if method == "project.undo" {
                    project.undo().await?;
                } else {
                    project.redo().await?;
                }
                project.reconcile_page();
                Ok(json!(project.info()))
            }
            "page.result" => {
                let PageId { page } = decode(value)?;
                Ok(json!(self.project().await?.page_result(page).await?))
            }
            "page.sourceSha256" => {
                let PageId { page } = decode(value)?;
                let sha256 = self.project().await?.source_sha256(page).await?;
                Ok(json!({"sha256": sha256}))
            }
            "pipeline.run" => {
                if self.active_agent().is_some() || self.active_pipeline().is_some() {
                    bail!("another processing job is active");
                }
                let RunPipeline {
                    operation,
                    scope,
                    cpu,
                } = decode(value)?;
                let cpu = cpu.unwrap_or(false);
                self.library(cpu).await?;
                let mut project = self.project().await?;
                let library = &self.library.as_ref().expect("library initialized").1;
                let report = library
                    .process_project(
                        &mut project,
                        Request {
                            operation: operation.unwrap_or_default(),
                            scope: scope.unwrap_or_default(),
                            ..Request::default()
                        },
                    )
                    .await?;
                Ok(json!({
                    "status": format!("{:?}", report.status).to_lowercase(),
                    "base": report.base,
                    "finalRevision": report.final_revision,
                    "completed": report.completed,
                    "total": report.total,
                    "elapsedMs": report.elapsed.as_millis(),
                    "project": project.info(),
                }))
            }
            "pipeline.status" => Ok(json!({
                "running": self.active_pipeline().map(|job| job.job),
            })),
            "pipeline.start" => {
                let RunPipeline {
                    operation,
                    scope,
                    cpu,
                } = decode(value)?;
                if self.active_agent().is_some() || self.active_pipeline().is_some() {
                    bail!("another processing job is active");
                }
                let project = Arc::clone(self.project.as_ref().context("no project is open")?);
                self.next_job = self
                    .next_job
                    .checked_add(1)
                    .context("pipeline job ID overflow")?;
                let job = self.next_job;
                let stop = StopToken::default();
                let task_stop = stop.clone();
                let output = self.output.clone();
                let task = tokio::spawn(async move {
                    let _ = output
                        .send(json!({"event": "pipeline", "job": job, "value": {"type": "started"}}));
                    let result: Result<Value> = async {
                        let pipeline = PipelineConfig::load()?.read()?.clone();
                        let providers = ProvidersConfig::load()?.read()?.clone();
                        let library =
                            Library::initialize(pipeline, providers, cpu.unwrap_or(false)).await?;
                        if task_stop.stopped() {
                            return Ok(json!({"type": "stopped"}));
                        }
                        let progress_output = output.clone();
                        let progress = Arc::new(move |event: Progress| {
                            let _ = progress_output.send(json!({
                                "event": "pipeline",
                                "job": job,
                                "value": progress_value(event)
                            }));
                        });
                        let mut project = project.lock().await;
                        let report = library
                            .process_project(
                                &mut project,
                                Request {
                                    operation: operation.unwrap_or_default(),
                                    scope: scope.unwrap_or_default(),
                                    stop: task_stop.clone(),
                                    progress: Some(progress),
                                    ..Request::default()
                                },
                            )
                            .await?;
                        Ok(json!({
                            "type": if report.status == RunStatus::Stopped { "stopped" } else { "completed" },
                            "status": format!("{:?}", report.status).to_lowercase(),
                            "base": report.base,
                            "finalRevision": report.final_revision,
                            "completed": report.completed,
                            "total": report.total,
                            "elapsedMs": report.elapsed.as_millis(),
                            "project": project.info(),
                        }))
                    }
                    .await;
                    let value = match result {
                        Ok(value) => value,
                        Err(error) => json!({"type": "failed", "message": format!("{error:#}")}),
                    };
                    let _ = output.send(json!({"event": "pipeline", "job": job, "value": value}));
                });
                self.pipeline = Some(ActivePipeline { job, stop, task });
                Ok(json!({"job": job}))
            }
            "pipeline.cancel" => {
                let PipelineCancel { job } = decode(value)?;
                let active = self
                    .active_pipeline()
                    .context("no pipeline job is active")?;
                if active.job != job {
                    bail!("pipeline job identifier does not match the active job");
                }
                active.stop.stop();
                Ok(json!({"cancelled": true}))
            }
            "page.exportPng" | "page.exportPsd" => {
                let Export { page, path } = decode(value)?;
                let snapshot = self.project().await?.snapshot();
                let cpu = self.library.as_ref().map_or(false, |(cpu, _)| *cpu);
                let library = self.library(cpu).await?;
                let bytes = if method == "page.exportPng" {
                    library.export_png_snapshot(&snapshot, page).await?
                } else {
                    library
                        .export_psd_snapshot(&snapshot, page, &Default::default())
                        .await?
                };
                tokio::fs::write(&path, &bytes).await?;
                Ok(json!({"path": path, "bytes": bytes.len()}))
            }
            "canvas.preparePage" => {
                let PageId { page } = decode(value)?;
                let snapshot = self.project().await?.snapshot();
                let prepared = self.desktop()?.prepare_page(&snapshot, page).await?;
                Ok(json!({"prepared": prepared, "revision": snapshot.revision()}))
            }
            "canvas.manifest" => {
                let PageId { page } = decode(value)?;
                let snapshot = self.project().await?.snapshot();
                let bytes = self
                    .desktop()?
                    .page_manifest_bytes(page, snapshot.revision())?;
                Ok(json!({"base64": STANDARD.encode(bytes)}))
            }
            "canvas.resource" => {
                let CanvasResource { page, resource } = decode(value)?;
                let snapshot = self.project().await?.snapshot();
                let resource: ResourceId = resource.parse()?;
                let bytes =
                    self.desktop()?
                        .page_resource_bytes(page, snapshot.revision(), resource)?;
                Ok(json!({"base64": STANDARD.encode(bytes)}))
            }
            _ => bail!("unknown SDK method: {method}"),
        }
    }
}

fn decode<T: DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(value).context("invalid method parameters")
}

fn progress_value(progress: Progress) -> Value {
    match progress {
        Progress::Started { pages, stages } => {
            json!({"type": "progress_started", "pages": pages, "stages": stages})
        }
        Progress::Loading { page, stage, model } => {
            json!({"type": "loading", "page": page, "stage": stage, "model": model})
        }
        Progress::Running { page, stage, model } => {
            json!({"type": "running", "page": page, "stage": stage, "model": model})
        }
        Progress::Finished {
            page,
            stage,
            model,
            elapsed,
        } => {
            json!({
                "type": "finished",
                "page": page,
                "stage": stage,
                "model": model,
                "elapsedMs": elapsed.as_millis()
            })
        }
        Progress::Skipped { page, stage } => json!({"type": "skipped", "page": page, "stage": stage}),
    }
}

#[derive(Deserialize)]
struct Named {
    name: String,
}
#[derive(Deserialize)]
struct PageId {
    page: EntityId,
}
#[derive(Deserialize)]
struct Pages {
    pages: Vec<EntityId>,
}
#[derive(Deserialize)]
struct Paths {
    paths: Vec<PathBuf>,
}
#[derive(Deserialize)]
struct Rename {
    page: EntityId,
    label: String,
}
#[derive(Deserialize)]
struct MovePage {
    page: EntityId,
    index: usize,
}
#[derive(Deserialize)]
struct AddPoint {
    page: EntityId,
    point: Point,
}
#[derive(Deserialize)]
struct AddBox {
    page: EntityId,
    frame: koharu_desktop::Frame,
}
#[derive(Deserialize)]
struct SetText {
    layer: EntityId,
    text: String,
}
#[derive(Deserialize)]
struct SetTranslation {
    layer: EntityId,
    text: Option<String>,
}
#[derive(Deserialize)]
struct Updates<T> {
    updates: Vec<T>,
}
#[derive(Deserialize)]
struct Layers {
    layers: Vec<EntityId>,
}
#[derive(Deserialize)]
struct MoveLayer {
    layer: EntityId,
    parent: EntityId,
    index: usize,
}
#[derive(Deserialize)]
struct RasterStroke {
    page: EntityId,
    layer: Option<EntityId>,
    mode: String,
    color: [u8; 4],
    diameter: f32,
    points: Vec<Point>,
}
#[derive(Deserialize)]
struct Visibility {
    layers: Vec<EntityId>,
    visible: Option<bool>,
    opacity: Option<f32>,
}
#[derive(Deserialize)]
struct RunPipeline {
    operation: Option<Operation>,
    scope: Option<Scope>,
    cpu: Option<bool>,
}
#[derive(Deserialize)]
struct Export {
    page: EntityId,
    path: PathBuf,
}
#[derive(Deserialize)]
struct CanvasResource {
    page: EntityId,
    resource: String,
}
#[derive(Deserialize)]
struct PipelinePreference {
    pipeline: PipelineConfig,
}
#[derive(Deserialize)]
struct ProviderPreferences {
    entries: Vec<ProviderConfig>,
}
#[derive(Deserialize)]
struct TypesettingPreference {
    typesetting: TypesettingConfig,
}
#[derive(Deserialize)]
struct CredentialPreference {
    provider: String,
    value: Option<String>,
    clear: Option<bool>,
}
#[derive(Deserialize)]
struct AgentRun {
    prompt: String,
    cpu: Option<bool>,
}
#[derive(Deserialize)]
struct AgentCancel {
    run: RunId,
}
#[derive(Deserialize)]
struct AgentPreference {
    config: AgentConfig,
}
#[derive(Deserialize)]
struct PipelineCancel {
    job: u64,
}
