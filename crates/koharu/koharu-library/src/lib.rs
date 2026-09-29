//! Koharu's native SDK for projects, models, agents, rendering, and page export.
//!
//! This crate owns the headless document workflow. The public modules expose the
//! individual engines for callers needing finer control. Desktop presentation
//! is native, while the interactive canvas is available on `wasm32` only.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{Context as _, Result, bail};
use async_trait::async_trait;
use image::{ExtendedColorType, ImageEncoder as _, codecs::png::PngEncoder};
use koharu_config::Config;
use koharu_ml::Device;
use koharu_pipeline::{Committer, Pipeline, PipelineError, Report, StageOutput};
use koharu_psd::export_page;
use koharu_rasterizer::{RasterOptions, Rasterizer};
use koharu_renderer::{Frame, Renderer};
use koharu_scene::{
    AssetInput, AssetMetadata, AssetRole, At, EntityId, PageDraft, Session, Snapshot,
};
use tokio::sync::OnceCell;

pub mod import;
pub mod agent_tools;
pub mod agent_host;
pub mod project;
mod result;

pub use koharu_agent as agent;
#[cfg(target_arch = "wasm32")]
pub use koharu_canvas as canvas;
pub use koharu_config as config;
pub use koharu_desktop as desktop;
pub use koharu_diffusion as diffusion;
pub use koharu_llama as llama;
pub use koharu_ml as ml;
pub use koharu_pipeline as pipeline;
pub use koharu_psd as psd;
pub use koharu_rasterizer as rasterizer;
pub use koharu_renderer as renderer;
pub use koharu_runtime as runtime;
pub use koharu_scene as scene;
pub use koharu_secrets as secrets;
pub use koharu_storage as storage;
pub use koharu_torch as torch;
pub use koharu_translator as translator;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub use koharu_pipeline::{
    Operation, PipelineConfig, Progress, ProgressSink, Request, Scope, Stage, StopToken,
};
pub use koharu_psd::PsdExportOptions;
pub use koharu_translator::{Language, ProvidersConfig};
pub use result::{GenerationInfo, PageResult, RegionResult, TextResult};

/// A model pipeline and native page renderer shared across documents.
pub struct Library {
    pipeline: Pipeline,
    renderer: Renderer,
    rasterizer: OnceCell<Arc<Rasterizer>>,
}

impl Library {
    /// Initializes the native model runtimes and constructs an in-memory configuration.
    /// The selected CPU/GPU device is shared by the pipeline's model stages.
    pub async fn initialize(
        config: PipelineConfig,
        providers: ProvidersConfig,
        cpu: bool,
    ) -> Result<Self> {
        koharu_ml::init().await?;
        Self::from_config(config, providers, koharu_ml::device(cpu))
    }

    /// Constructs a library after the caller has initialized Koharu's model runtimes.
    /// This must run inside a Tokio runtime, as the pipeline watches its configuration.
    pub fn from_config(
        config: PipelineConfig,
        providers: ProvidersConfig,
        device: Device,
    ) -> Result<Self> {
        Ok(Self {
            pipeline: Pipeline::from_config(
                Config::memory(config),
                Config::memory(providers),
                device,
            )?,
            renderer: Renderer::new()?,
            rasterizer: OnceCell::new(),
        })
    }

    /// Latest local CPU and accelerator sample from the active pipeline.
    pub fn resource_snapshot(&self) -> koharu_pipeline::ResourceSnapshot {
        self.pipeline.subscribe_resources().borrow().clone()
    }

    /// Runs the requested stages and commits their scene patches to the document.
    /// `Request` carries the stage selection, scope, stop token and progress sink.
    pub async fn process(
        &self,
        document: &mut Document,
        request: Request,
    ) -> std::result::Result<Report, PipelineError> {
        let snapshot = document.snapshot();
        let mut committer = SessionCommitter(&mut document.session);
        self.pipeline
            .execute(snapshot, request, &mut committer)
            .await
    }

    /// Runs model stages against a named, persistent project and records every
    /// successful stage in its undo history.
    pub async fn process_project(
        &self,
        project: &mut project::Project,
        request: Request,
    ) -> std::result::Result<Report, PipelineError> {
        let snapshot = project.snapshot();
        let mut committer = ProjectCommitter(project);
        self.pipeline.execute(snapshot, request, &mut committer).await
    }

    /// Resolves one page's retained native frame from the latest scene revision.
    pub async fn render(&self, document: &Document, page: EntityId) -> Result<Frame> {
        self.render_snapshot(&document.snapshot(), page).await
    }

    pub async fn render_snapshot(&self, snapshot: &Snapshot, page: EntityId) -> Result<Frame> {
        self.renderer
            .render(snapshot, page)
            .await
            .map_err(Into::into)
    }

    /// Exports a page as PNG after compositing its current scene on the native GPU.
    pub async fn export_png(&self, document: &Document, page: EntityId) -> Result<Vec<u8>> {
        self.export_png_snapshot(&document.snapshot(), page).await
    }

    pub async fn export_png_snapshot(&self, snapshot: &Snapshot, page: EntityId) -> Result<Vec<u8>> {
        let frame = self.render_snapshot(snapshot, page).await?;
        let rasterizer = self.rasterizer().await?;
        let raster = rasterizer.rasterize(&frame.raster_frame()?, RasterOptions::default())?;
        let image = raster.image;
        let mut output = Vec::new();
        PngEncoder::new(&mut output).write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            ExtendedColorType::Rgba8,
        )?;
        Ok(output)
    }

    /// Exports a page with Koharu's layered PSD exporter.
    pub async fn export_psd(
        &self,
        document: &Document,
        page: EntityId,
        options: &PsdExportOptions,
    ) -> Result<Vec<u8>> {
        self.export_psd_snapshot(&document.snapshot(), page, options).await
    }

    pub async fn export_psd_snapshot(
        &self,
        snapshot: &Snapshot,
        page: EntityId,
        options: &PsdExportOptions,
    ) -> Result<Vec<u8>> {
        let frame = self.renderer.render(snapshot, page).await?;
        export_page(self.rasterizer().await?, snapshot, &frame, options)
            .await
            .map_err(Into::into)
    }

    async fn rasterizer(&self) -> Result<Arc<Rasterizer>> {
        let rasterizer = self
            .rasterizer
            .get_or_try_init(|| async { Rasterizer::new().map(Arc::new) })
            .await?;
        Ok(Arc::clone(rasterizer))
    }
}

/// A Koharu scene session that can be kept in memory or stored on disk.
pub struct Document {
    session: Session,
}

impl Document {
    pub async fn memory() -> Result<Self> {
        Ok(Self {
            session: Session::memory().await?,
        })
    }

    pub async fn create(path: impl AsRef<Path>) -> Result<Self> {
        Ok(Self {
            session: Session::create(path).await?,
        })
    }

    pub async fn open(path: impl AsRef<Path>) -> Result<Self> {
        Ok(Self {
            session: Session::open(path).await?,
        })
    }

    pub fn snapshot(&self) -> Snapshot {
        self.session.snapshot()
    }

    pub fn project_id(&self) -> koharu_scene::ProjectId {
        self.session.project_id()
    }

    pub fn revision(&self) -> koharu_scene::Revision {
        self.session.snapshot().revision()
    }

    /// Validates and applies one scene edit as an atomic, undoable revision.
    pub async fn edit(
        &mut self,
        edit: impl FnOnce(&mut koharu_scene::Edit) -> koharu_scene::Result<()>,
    ) -> Result<koharu_scene::Commit> {
        let patch = self.session.snapshot().patch(edit)?;
        self.session.commit(patch).await.map_err(Into::into)
    }

    /// Applies a patch created from this document's current snapshot.
    pub async fn commit_patch(&mut self, patch: koharu_scene::Patch) -> Result<koharu_scene::Commit> {
        self.session.commit(patch).await.map_err(Into::into)
    }

    pub async fn undo(&mut self, revision: koharu_scene::Revision) -> Result<koharu_scene::Commit> {
        self.session.undo(revision).await.map_err(Into::into)
    }

    pub async fn undo_many(
        &mut self,
        revisions: impl IntoIterator<Item = koharu_scene::Revision>,
    ) -> Result<koharu_scene::Commit> {
        self.session.undo_many(revisions).await.map_err(Into::into)
    }

    pub async fn collect_garbage(&self) -> Result<koharu_storage::GcReport> {
        self.session.collect_garbage().await.map_err(Into::into)
    }

    /// Returns a compact typed view of model output on one page.
    pub async fn page_result(&self, page: EntityId) -> Result<PageResult> {
        result::extract(&self.session.snapshot(), page).await
    }

    /// Imports a PNG, JPEG, or WebP page and retains its original encoded bytes.
    pub async fn import_raster(
        &mut self,
        name: impl Into<String>,
        bytes: impl Into<Arc<[u8]>>,
    ) -> Result<EntityId> {
        let page = import::Page::from_bytes(name, bytes.into())?;
        self.import_pages(vec![page])
            .await?
            .into_iter()
            .next()
            .context("page import did not assign an entity ID")
    }

    /// Imports raster images or pages from ZIP/CBZ, RAR, and PDF files in natural order.
    pub async fn import_paths(&mut self, paths: Vec<PathBuf>) -> Result<Vec<EntityId>> {
        let pages = tokio::task::spawn_blocking(move || import::import(paths)).await??;
        self.import_pages(pages).await
    }

    /// Commits already decoded page inputs in one scene revision.
    pub async fn import_pages(&mut self, pages: Vec<import::Page>) -> Result<Vec<EntityId>> {
        if pages.is_empty() {
            bail!("page import contains no images");
        }
        let mut ids = Vec::with_capacity(pages.len());
        let patch = self.session.snapshot().patch(|edit| {
            let source = AssetRole::new("source")?;
            for page in pages {
                let id = edit.add_page(
                    PageDraft::new(page.name, f64::from(page.width), f64::from(page.height)),
                    At::End,
                )?;
                edit.set_asset(
                    id,
                    &source,
                    AssetInput::new(
                        page.bytes,
                        page.format.to_mime_type(),
                        AssetMetadata {
                            width: Some(page.width),
                            height: Some(page.height),
                            attributes: BTreeMap::new(),
                        },
                    ),
                )?;
                ids.push(id);
            }
            Ok(())
        })?;
        self.session.commit(patch).await?;
        Ok(ids)
    }
}

struct SessionCommitter<'a>(&'a mut Session);

struct ProjectCommitter<'a>(&'a mut project::Project);

#[async_trait]
impl Committer for ProjectCommitter<'_> {
    async fn commit(&mut self, output: StageOutput) -> Result<Snapshot> {
        let Some(commit) = self.0.commit_rebased(output.patch).await? else {
            return Ok(self.0.snapshot());
        };
        self.0.record_commit(&commit);
        Ok(commit.snapshot)
    }
}

#[async_trait]
impl Committer for SessionCommitter<'_> {
    async fn commit(&mut self, output: StageOutput) -> Result<Snapshot> {
        Ok(self.0.commit(output.patch).await?.snapshot)
    }
}
