use std::{fs, path::PathBuf, sync::Arc};

use anyhow::{Context as _, Result, ensure};
use clap::{Parser, ValueEnum};
use koharu_library::{
    Document, Library, Operation, PipelineConfig, Progress, ProvidersConfig, Request, Scope,
};
use koharu_pipeline::{
    DetectionModel, Flux2KleinConfig, InpaintingModel, KoharuLayoutRFDetrSeg2XLConfig, OcrModel,
    RoremMixedConfig, TranslationConfig,
};
use koharu_translator::{GenerationConfig, Language, ModelSelection, Provider};

#[derive(Debug, Parser)]
#[command(version, about = "Run Koharu's complete headless page pipeline")]
struct Arguments {
    #[arg(short, long, value_name = "INPUT")]
    input: PathBuf,

    #[arg(short, long, value_name = "OUTPUT_PNG")]
    output: PathBuf,

    #[arg(long, value_enum, default_value = "koharu-layout-rfdetr-seg-2xl")]
    detection: DetectionChoice,

    #[arg(long, value_enum, default_value = "paddleocr-vl-1.6")]
    ocr: OcrChoice,

    #[arg(long, value_enum, default_value = "lama")]
    inpainting: InpaintingChoice,

    #[arg(long, default_value = "en-US")]
    target_language: Language,

    #[arg(long)]
    translation_instructions: Option<String>,

    #[arg(long, default_value = "gemma4-12b-it")]
    llm: String,

    #[arg(long)]
    cpu: bool,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum DetectionChoice {
    #[value(name = "koharu-layout-rfdetr-seg-2xl")]
    KoharuLayoutRFDetrSeg2XL,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum OcrChoice {
    #[value(name = "paddleocr-vl-1.6")]
    PaddleOcrVl1_6,
    #[value(name = "manga-ocr")]
    MangaOcr,
    #[value(name = "baberu-ocr")]
    BaberuOcr,
    #[value(name = "hayai-ocr")]
    HayaiOcr,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum InpaintingChoice {
    #[value(name = "lama")]
    LaMa,
    #[value(name = "aot-inpainting")]
    AotInpainting,
    #[value(name = "flux2-klein")]
    Flux2Klein,
    #[value(name = "rorem-mixed")]
    RoremMixed,
}

impl Arguments {
    fn pipeline_config(&self) -> PipelineConfig {
        PipelineConfig {
            detection: match self.detection {
                DetectionChoice::KoharuLayoutRFDetrSeg2XL => {
                    DetectionModel::KoharuLayoutRFDetrSeg2XL(
                        KoharuLayoutRFDetrSeg2XLConfig::default(),
                    )
                }
            },
            ocr: match self.ocr {
                OcrChoice::PaddleOcrVl1_6 => OcrModel::PaddleOcrVl1_6,
                OcrChoice::MangaOcr => OcrModel::MangaOcr,
                OcrChoice::BaberuOcr => OcrModel::BaberuOcr,
                OcrChoice::HayaiOcr => OcrModel::HayaiOcr,
            },
            translation: TranslationConfig {
                model: ModelSelection {
                    provider: Provider::Local,
                    model: Some(self.llm.clone()),
                    quantization: None,
                    vision: true,
                    reasoning: true,
                },
                generation: GenerationConfig::default(),
                target_language: self.target_language,
                instructions: self.translation_instructions.clone(),
            },
            inpainting: match self.inpainting {
                InpaintingChoice::LaMa => InpaintingModel::LaMa {},
                InpaintingChoice::AotInpainting => InpaintingModel::AotInpainting {},
                InpaintingChoice::Flux2Klein => {
                    InpaintingModel::Flux2Klein(Flux2KleinConfig::default())
                }
                InpaintingChoice::RoremMixed => {
                    InpaintingModel::RoremMixed(RoremMixedConfig::default())
                }
            },
            processor: Default::default(),
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let arguments = Arguments::parse();
    ensure!(
        arguments
            .output
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("png")),
        "output must have a .png extension"
    );
    let library = Library::initialize(
        arguments.pipeline_config(),
        ProvidersConfig::default(),
        arguments.cpu,
    )
    .await?;
    let mut document = Document::memory().await?;
    let pages = document.import_paths(vec![arguments.input.clone()]).await?;
    ensure!(pages.len() == 1, "input must contain exactly one page");
    let page = pages[0];
    let report = library
        .process(
            &mut document,
            Request {
                operation: Operation::Full,
                scope: Scope::Pages(vec![page]),
                progress: Some(Arc::new(|event| {
                    if let Progress::Finished { stage, elapsed, .. } = event {
                        eprintln!("{stage} finished in {:.2}s", elapsed.as_secs_f64());
                    }
                })),
                ..Request::default()
            },
        )
        .await?;
    eprintln!("pipeline finished in {:.2}s", report.elapsed.as_secs_f64());
    let png = library.export_png(&document, page).await?;
    fs::write(&arguments.output, png)
        .with_context(|| format!("failed to write {}", arguments.output.display()))?;
    eprintln!("rendered {}", arguments.output.display());
    Ok(())
}
