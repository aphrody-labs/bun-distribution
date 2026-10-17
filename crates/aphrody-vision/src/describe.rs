// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
// Driving a local vision model over one image, in one of four modes.
//
// The process handling is not re-implemented here. `aphrody-ocr-vlm`'s
// `VlmRunner` already resolves the llama.cpp binary, both GGUF artefacts and
// the child process; it takes the prompt as a field, which is precisely the
// one thing that differs between OCR and visual description. Two copies of
// that spawn would mean two places where a flag such as `--temp 0` could drift,
// and a description that is not reproducible is not auditable.
//
// What this crate owns is the interpretation of the answer, which is where the
// two surfaces genuinely diverge (see `quality` and `mode`).

use std::path::{Path, PathBuf};

use aphrody_models::{Catalog, ModelStore};
use aphrody_ocr_vlm::{OcrOptions, PageText, VlmRunner};

use crate::{
    Result, VisionError,
    mode::{ModeKind, VisionMode},
    quality::{Answer, classify},
    region::{Region, parse_regions},
};

/// Knobs for a description run.
#[derive(Debug, Clone)]
pub struct VisionOptions {
    /// Catalog id of the vision model to drive.
    pub model_id: String,
    /// What to ask of the image.
    pub mode: VisionMode,
    /// Token budget. Defaults to the mode's budget.
    pub max_tokens: u32,
    /// Layers to offload to the GPU; 99 means all of them.
    pub gpu_layers: u32,
    /// Keep the model's raw stdout in the report.
    pub keep_raw: bool,
}

impl VisionOptions {
    /// Options for a mode, on a model, with that mode's token budget.
    #[must_use]
    pub fn new(model_id: impl Into<String>, mode: VisionMode) -> Self {
        let max_tokens = mode.default_max_tokens();
        Self {
            model_id: model_id.into(),
            mode,
            max_tokens,
            gpu_layers: 99,
            keep_raw: false,
        }
    }

    /// Caption options for the default captioning model.
    #[must_use]
    pub fn caption() -> Self {
        Self::new(DEFAULT_CAPTION_MODEL, VisionMode::Caption)
    }

    /// Dense-region options for the default document model.
    #[must_use]
    pub fn dense_region() -> Self {
        Self::new(DEFAULT_DOCUMENT_MODEL, VisionMode::DenseRegion)
    }
}

/// The catalog model used when a caller does not name one for prose modes.
/// Single source of truth: [`aphrody_models::LocalRole::Vision`].
pub const DEFAULT_CAPTION_MODEL: &str = aphrody_models::LocalRole::Vision.default_model();
/// The catalog model used when a caller does not name one for document modes.
/// Single source of truth: [`aphrody_models::LocalRole::Ocr`].
pub const DEFAULT_DOCUMENT_MODEL: &str = aphrody_models::LocalRole::Ocr.default_model();

/// What the model had to say about an image.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[non_exhaustive]
pub enum Description {
    /// A short description of the whole image.
    Caption {
        /// The caption, or why there is none.
        answer: Answer,
    },
    /// A description per region.
    Regions {
        /// The regions, in emission order. Empty means the model located none.
        regions: Vec<Region>,
    },
    /// Full-page text, exactly as the OCR path reports it.
    ///
    /// This carries `PageText`, not a `String`, on purpose: `PageText::None`
    /// is a verdict of "this page holds no text" and it must survive all the
    /// way to the caller. A caption model shown a wordless illustration will
    /// describe it happily, and writing that description into a transcription
    /// corpus is a silent corruption. Caption may describe; OCR may not.
    Page {
        /// The page verdict.
        text: PageText,
    },
    /// An answer to the caller's question.
    Answer {
        /// The question, echoed so a stored report is self-contained.
        question: String,
        /// The answer, or why there is none.
        answer: Answer,
    },
}

impl Description {
    /// Prose from this description, when it holds any.
    ///
    /// A region list is joined with newlines, which is what a caller logging
    /// one line per image wants; the structured regions stay available.
    #[must_use]
    pub fn as_text(&self) -> Option<String> {
        match self {
            Self::Caption { answer } | Self::Answer { answer, .. } => {
                answer.text().map(ToOwned::to_owned)
            }
            Self::Page { text } => text.markdown().map(ToOwned::to_owned),
            Self::Regions { regions } => {
                let joined = regions
                    .iter()
                    .filter(|region| !region.text.is_empty())
                    .map(|region| region.text.as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                (!joined.is_empty()).then_some(joined)
            }
        }
    }
}

/// One image, described.
#[derive(Debug, Clone, serde::Serialize)]
pub struct VisionReport {
    /// The image that was looked at.
    pub image: PathBuf,
    /// The model that looked at it.
    pub model_id: String,
    /// In which mode.
    pub mode: ModeKind,
    /// What it said.
    pub description: Description,
    /// Wall-clock milliseconds the model took.
    pub elapsed_ms: u128,
    /// Raw model output, kept for auditing a surprising answer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

/// A configured vision model, ready to be shown images.
pub struct Describer {
    runner: VlmRunner,
    model_id: String,
    mode: VisionMode,
    keep_raw: bool,
}

impl Describer {
    /// Resolve the runtime and the weights named by `options`.
    ///
    /// Nothing is downloaded here, or anywhere in this crate: a model that is
    /// not on disk produces an error naming the `aphrody model pull` command
    /// that fixes it. Pulling several hundred megabytes in the middle of an
    /// inference call would be a network decision taken on the caller's behalf,
    /// in a code path they asked to be local and offline.
    ///
    /// # Errors
    ///
    /// [`VisionError::ModeUnsupported`] when the model was not trained for the
    /// mode, [`VisionError::ModelNotInstalled`] when the weights are absent,
    /// or [`VisionError::Backend`] when llama.cpp is not installed.
    pub fn new(options: VisionOptions) -> Result<Self> {
        let prompt = options.mode.prompt_for(&options.model_id)?;

        let ocr_options = OcrOptions {
            model_id: options.model_id.clone(),
            prompt,
            max_tokens: options.max_tokens,
            gpu_layers: options.gpu_layers,
            // Always kept from the backend: the crate reads the raw answer to
            // classify it, and only forwards it when the caller asked.
            keep_raw: true,
        };

        let runner = VlmRunner::new(ocr_options).map_err(|error| {
            explain_missing(&error, &options.model_id).unwrap_or_else(|| error.into())
        })?;

        // A model that is being used must not be evicted by the LRU garbage
        // collector while a batch or a background job is halfway through it.
        touch(&options.model_id);

        Ok(Self {
            runner,
            model_id: options.model_id,
            mode: options.mode,
            keep_raw: options.keep_raw,
        })
    }

    /// The resolved llama.cpp binary.
    #[must_use]
    pub fn binary(&self) -> &Path {
        self.runner.binary()
    }

    /// The mode this describer was built for.
    #[must_use]
    pub const fn mode(&self) -> &VisionMode {
        &self.mode
    }

    /// Look at one image.
    ///
    /// # Errors
    ///
    /// [`VisionError::Backend`] when the model process fails.
    pub fn describe(&self, image: &Path) -> Result<VisionReport> {
        let page = self.runner.read(image)?;
        // `keep_raw: true` above guarantees this; an empty answer would be
        // classified as unusable, which is the correct verdict anyway.
        let raw = page.raw.clone().unwrap_or_default();

        let description = match &self.mode {
            VisionMode::Caption => Description::Caption {
                answer: classify(&raw),
            },
            VisionMode::DenseRegion => Description::Regions {
                regions: parse_regions(&raw),
            },
            // Handed through untouched: the OCR path already decided whether
            // this page holds text, and second-guessing it here is exactly how
            // a description ends up filed as a transcription.
            VisionMode::FullPageOcr => Description::Page { text: page.text },
            VisionMode::Vqa { question } => Description::Answer {
                question: question.clone(),
                answer: classify(&raw),
            },
        };

        Ok(VisionReport {
            image: image.to_path_buf(),
            model_id: self.model_id.clone(),
            mode: self.mode.kind(),
            description,
            elapsed_ms: page.elapsed_ms,
            raw: self.keep_raw.then_some(raw),
        })
    }
}

/// Turn a backend "not installed" error into one that says what to run.
///
/// The backend error is accurate and useless to a script: it names a model
/// reference nobody typed. The catalog id the caller passed is what
/// `aphrody model pull` takes.
fn explain_missing(error: &aphrody_ocr_vlm::OcrError, model_id: &str) -> Option<VisionError> {
    matches!(
        error,
        aphrody_ocr_vlm::OcrError::Model(aphrody_models::ModelError::NotInstalled(_))
    )
    .then(|| VisionError::ModelNotInstalled {
        model_id: model_id.to_owned(),
        command: pull_command(model_id),
    })
}

/// The exact command that installs a catalog model.
#[must_use]
pub fn pull_command(model_id: &str) -> String {
    format!("aphrody model pull {model_id}")
}

/// Mark a catalog model as used, so the LRU collector spares it.
///
/// Best-effort: a registry that cannot be written is a reason to log, not a
/// reason to refuse an inference that is otherwise ready to run.
fn touch(model_id: &str) {
    let Ok(entry) = Catalog::builtin().get(model_id) else {
        return;
    };
    let Ok(store) = ModelStore::open() else {
        return;
    };
    for file in &entry.files {
        if let Err(error) = store.touch(&file.reference) {
            tracing::debug!(%error, model = model_id, "could not touch model in the registry");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pull_hint_is_a_command_that_can_be_run_verbatim() {
        assert_eq!(
            pull_command("granite-docling-258m"),
            "aphrody model pull granite-docling-258m"
        );
    }

    #[test]
    fn options_take_the_token_budget_of_their_mode() {
        assert_eq!(
            VisionOptions::caption().max_tokens,
            VisionMode::Caption.default_max_tokens()
        );
        assert_eq!(
            VisionOptions::new("smolvlm-500m-q8", VisionMode::FullPageOcr).max_tokens,
            VisionMode::FullPageOcr.default_max_tokens()
        );
    }

    #[test]
    fn the_default_models_exist_in_the_builtin_catalog() {
        // A default nobody can pull is a broken default.
        for id in [DEFAULT_CAPTION_MODEL, DEFAULT_DOCUMENT_MODEL] {
            let entry = Catalog::builtin()
                .get(id)
                .unwrap_or_else(|e| panic!("{id}: {e}"));
            assert_eq!(entry.task.to_string(), "visual-transcription");
        }
    }

    #[test]
    fn the_default_models_serve_their_default_mode() {
        assert!(
            VisionMode::Caption
                .prompt_for(DEFAULT_CAPTION_MODEL)
                .is_ok()
        );
        assert!(
            VisionMode::DenseRegion
                .prompt_for(DEFAULT_DOCUMENT_MODEL)
                .is_ok()
        );
        assert!(
            VisionMode::FullPageOcr
                .prompt_for(DEFAULT_DOCUMENT_MODEL)
                .is_ok()
        );
    }

    #[test]
    fn a_describer_for_an_unsupported_mode_fails_before_touching_the_disk() {
        // No runtime, no weights and no image are needed to know this is wrong.
        match Describer::new(VisionOptions::new(
            DEFAULT_DOCUMENT_MODEL,
            VisionMode::vqa("what colour is the car?"),
        )) {
            Err(error) => assert!(
                matches!(error, VisionError::ModeUnsupported { .. }),
                "{error}"
            ),
            Ok(_) => panic!("a document model must not accept a free-form question"),
        }
    }

    #[test]
    fn a_missing_model_is_explained_with_its_pull_command() {
        let backend = aphrody_ocr_vlm::OcrError::Model(aphrody_models::ModelError::NotInstalled(
            "hf:x/y/z@0".into(),
        ));
        let explained = explain_missing(&backend, "smolvlm-500m-q8").unwrap();
        let rendered = explained.to_string();
        assert!(
            rendered.contains("aphrody model pull smolvlm-500m-q8"),
            "{rendered}"
        );
    }

    #[test]
    fn a_backend_failure_is_not_rewritten_as_a_missing_model() {
        let backend = aphrody_ocr_vlm::OcrError::NoRunner;
        assert!(explain_missing(&backend, "smolvlm-500m-q8").is_none());
    }

    #[test]
    fn page_descriptions_keep_the_textless_verdict() {
        // The asymmetry at the heart of the crate: OCR is allowed to say
        // "there is no text here", and that must not collapse to "".
        let page = Description::Page {
            text: PageText::None,
        };
        assert_eq!(page.as_text(), None);
        let json = serde_json::to_value(&page).unwrap();
        assert_eq!(json["text"]["kind"], "none");
    }

    #[test]
    fn a_caption_may_describe_where_a_transcription_may_not() {
        let caption = Description::Caption {
            answer: Answer::Ok {
                text: "A drawing of a cat.".into(),
            },
        };
        assert_eq!(caption.as_text().unwrap(), "A drawing of a cat.");
    }

    #[test]
    fn region_text_is_joined_for_a_one_line_log() {
        let regions = Description::Regions {
            regions: vec![
                Region {
                    label: "text".into(),
                    text: "top bar".into(),
                    bbox: None,
                },
                Region {
                    label: "picture".into(),
                    text: String::new(),
                    bbox: None,
                },
                Region {
                    label: "text".into(),
                    text: "footer".into(),
                    bbox: None,
                },
            ],
        };
        assert_eq!(regions.as_text().unwrap(), "top bar\nfooter");
    }

    #[test]
    fn a_region_list_with_nothing_in_it_reads_as_no_text() {
        assert_eq!(
            Description::Regions {
                regions: Vec::new()
            }
            .as_text(),
            None
        );
    }

    #[test]
    fn a_vqa_report_echoes_its_question() {
        let description = Description::Answer {
            question: "how many tabs?".into(),
            answer: Answer::Ok {
                text: "three".into(),
            },
        };
        let json = serde_json::to_value(&description).unwrap();
        assert_eq!(json["kind"], "answer");
        assert_eq!(json["question"], "how many tabs?");
    }

    #[test]
    fn a_report_serialises_with_a_stable_shape() {
        let report = VisionReport {
            image: PathBuf::from("shot.png"),
            model_id: DEFAULT_CAPTION_MODEL.to_owned(),
            mode: ModeKind::Caption,
            description: Description::Caption {
                answer: Answer::Ok {
                    text: "a wall".into(),
                },
            },
            elapsed_ms: 42,
            raw: None,
        };
        let json = serde_json::to_value(&report).unwrap();
        assert_eq!(json["mode"], "caption");
        assert_eq!(json["description"]["answer"]["status"], "ok");
        assert!(json.get("raw").is_none(), "raw must be absent, not null");
    }
}
