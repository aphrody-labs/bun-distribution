// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
// What we ask a vision model, and which models may be asked it.
//
// The prompt is not decoration. A document model handed a free-form
// instruction stops transcribing and starts captioning; a chat VLM handed
// `Convert this page to docling.` answers with an empty turn. Both failures
// look, downstream, exactly like a page that had nothing on it — which is the
// most expensive mistake this pipeline can make, because it is silent.
//
// So the mapping mode x family -> prompt lives in one table, and a mode a
// family cannot honestly serve is refused up front rather than served badly.

use crate::{Result, VisionError};

/// The model family a catalog id belongs to.
///
/// Families are distinguished by what they were *trained to answer*, not by
/// size or vendor: that is the only property that decides whether a prompt
/// will produce a transcription, a description, or silence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
#[non_exhaustive]
pub enum Family {
    /// Docling document models (granite-docling): emit `DocTags` with
    /// coordinates. Document-only — they have no conversational head.
    Docling,
    /// Florence-2: one checkpoint, task selected by a `<TASK>` control token.
    Florence,
    /// Instruction-tuned chat VLMs (`SmolVLM` and friends).
    Chat,
}

impl Family {
    /// The family a catalog id belongs to.
    ///
    /// Matching is on the id prefix rather than an exhaustive list so a new
    /// quantisation of a known checkpoint (`smolvlm-500m-q4`) does not have to
    /// be enumerated again to be usable.
    #[must_use]
    pub fn of(model_id: &str) -> Self {
        let id = model_id.to_ascii_lowercase();
        if id.contains("docling") || id.starts_with("dots-ocr") {
            Self::Docling
        } else if id.starts_with("florence") {
            Self::Florence
        } else {
            Self::Chat
        }
    }
}

/// What the caller wants to know about an image.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum VisionMode {
    /// One short description of the whole image.
    Caption,
    /// A description per region, with boxes when the model emits them.
    DenseRegion,
    /// Full-page text. Delegated to the OCR path, verbatim.
    FullPageOcr,
    /// A free-form question about the image.
    Vqa {
        /// The question, as the caller phrased it.
        question: String,
    },
}

/// The mode discriminant, without the question payload.
///
/// Reports serialise this rather than the mode itself so a consumer can group
/// by mode without every VQA question becoming its own bucket.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
#[non_exhaustive]
pub enum ModeKind {
    /// [`VisionMode::Caption`].
    Caption,
    /// [`VisionMode::DenseRegion`].
    DenseRegion,
    /// [`VisionMode::FullPageOcr`].
    FullPageOcr,
    /// [`VisionMode::Vqa`].
    Vqa,
}

impl VisionMode {
    /// A VQA mode for `question`.
    #[must_use]
    pub fn vqa(question: impl Into<String>) -> Self {
        Self::Vqa { question: question.into() }
    }

    /// This mode's discriminant.
    #[must_use]
    pub const fn kind(&self) -> ModeKind {
        match self {
            Self::Caption => ModeKind::Caption,
            Self::DenseRegion => ModeKind::DenseRegion,
            Self::FullPageOcr => ModeKind::FullPageOcr,
            Self::Vqa { .. } => ModeKind::Vqa,
        }
    }

    /// Whether `family` was trained to answer this mode.
    ///
    /// Docling models are refused caption and VQA deliberately. They will
    /// answer — with `DocTags` prose that reads like a description and is not
    /// one. A refusal that names a model which *can* answer costs the caller
    /// one retry; a plausible wrong answer costs them a corpus.
    #[must_use]
    pub const fn is_supported_by(&self, family: Family) -> bool {
        match (self, family) {
            // Florence-2 is refused VQA for a different reason than Docling:
            // it has no free-form conversational head at all, only task
            // control tokens, and it is not driven through llama.cpp here.
            (Self::Caption | Self::Vqa { .. }, Family::Docling)
            | (Self::Vqa { .. }, Family::Florence) => false,
            _ => true,
        }
    }

    /// The instruction to hand the model for this mode and family.
    ///
    /// # Errors
    ///
    /// [`VisionError::ModeUnsupported`] when the family cannot honestly serve
    /// the mode.
    pub fn prompt_for(&self, model_id: &str) -> Result<String> {
        let family = Family::of(model_id);
        if !self.is_supported_by(family) {
            return Err(VisionError::ModeUnsupported {
                mode: self.kind(),
                model_id: model_id.to_owned(),
                alternative: alternative_for(self.kind()),
            });
        }

        Ok(match (self, family) {
            // The OCR path owns this prompt; asking it keeps the two crates
            // from drifting into two different transcriptions of one page.
            (Self::FullPageOcr, _) => aphrody_ocr_vlm::vlm::default_prompt(model_id).to_owned(),
            (Self::Caption, Family::Florence) => "<CAPTION>".to_owned(),
            (Self::Caption, _) => "Describe this image in one or two sentences.".to_owned(),
            (Self::DenseRegion, Family::Docling) => {
                // DocTags carry <loc_*> boxes per block, which is exactly the
                // per-region answer, so the trained instruction is reused.
                "Convert this page to docling.".to_owned()
            },
            (Self::DenseRegion, Family::Florence) => "<DENSE_REGION_CAPTION>".to_owned(),
            (Self::DenseRegion, Family::Chat) => "List each distinct region of this image and \
                                                  describe it on its own line."
                .to_owned(),
            (Self::Vqa { question }, _) => question.clone(),
        })
    }

    /// A token budget suited to this mode.
    ///
    /// A caption that runs to a thousand tokens is a degenerate generation,
    /// not a thorough one; a full page of dense text genuinely needs the room.
    #[must_use]
    pub const fn default_max_tokens(&self) -> u32 {
        match self {
            Self::Caption => 128,
            Self::Vqa { .. } => 256,
            Self::DenseRegion => 512,
            Self::FullPageOcr => 1024,
        }
    }
}

/// A chat-family alternative for `Caption`/`Vqa` when the requested model
/// belongs to a document-only family. Not one of [`aphrody_models::LocalRole`]'s
/// roles — [`DEFAULT_CAPTION_MODEL`](crate::describe::DEFAULT_CAPTION_MODEL)
/// already covers that default — just the smallest catalogued chat VLM,
/// named once so it is not retyped at every call site.
const CHAT_ALTERNATIVE_MODEL: &str = "smolvlm-500m-q8";

/// A catalog id known to serve `kind`, for an error message.
fn alternative_for(kind: ModeKind) -> &'static str {
    match kind {
        ModeKind::FullPageOcr | ModeKind::DenseRegion => {
            aphrody_models::LocalRole::Ocr.default_model()
        },
        ModeKind::Caption | ModeKind::Vqa => CHAT_ALTERNATIVE_MODEL,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn families_are_recognised_from_catalog_ids() {
        assert_eq!(Family::of("granite-docling-258m"), Family::Docling);
        assert_eq!(Family::of("dots-ocr"), Family::Docling);
        assert_eq!(Family::of("florence2-base-ft"), Family::Florence);
        assert_eq!(Family::of("smolvlm-500m-q8"), Family::Chat);
    }

    #[test]
    fn family_matching_is_case_insensitive_and_prefix_based() {
        // A new quantisation of a known checkpoint must not need a new arm.
        assert_eq!(Family::of("SmolVLM-500M-Q4"), Family::Chat);
        assert_eq!(Family::of("granite-DOCLING-1b"), Family::Docling);
    }

    #[test]
    fn an_unknown_id_defaults_to_the_chat_family() {
        // Chat is the safe default: its prompts are free-form, so a wrong
        // guess produces a poor answer, not a silently empty one.
        assert_eq!(Family::of("qwen2-vl-7b"), Family::Chat);
    }

    #[test]
    fn docling_models_refuse_caption_and_vqa() {
        assert!(!VisionMode::Caption.is_supported_by(Family::Docling));
        assert!(!VisionMode::vqa("what is this?").is_supported_by(Family::Docling));
        assert!(VisionMode::FullPageOcr.is_supported_by(Family::Docling));
        assert!(VisionMode::DenseRegion.is_supported_by(Family::Docling));
    }

    #[test]
    fn chat_models_serve_every_mode() {
        for mode in [
            VisionMode::Caption,
            VisionMode::DenseRegion,
            VisionMode::FullPageOcr,
            VisionMode::vqa("q"),
        ] {
            assert!(mode.is_supported_by(Family::Chat), "{mode:?}");
        }
    }

    #[test]
    fn refusing_a_mode_names_a_model_that_serves_it() {
        let error = VisionMode::Caption.prompt_for("granite-docling-258m").unwrap_err();
        let rendered = error.to_string();
        assert!(rendered.contains("smolvlm-500m-q8"), "{rendered}");
        assert!(matches!(error, VisionError::ModeUnsupported { .. }));
    }

    #[test]
    fn full_page_ocr_reuses_the_ocr_crate_prompt() {
        // Not "contains docling": the point is that it is literally the same
        // string, so the two crates cannot transcribe one page two ways.
        for id in ["granite-docling-258m", "dots-ocr"] {
            assert_eq!(
                VisionMode::FullPageOcr.prompt_for(id).unwrap(),
                aphrody_ocr_vlm::vlm::default_prompt(id)
            );
        }
    }

    #[test]
    fn florence_modes_use_task_control_tokens() {
        assert_eq!(VisionMode::Caption.prompt_for("florence2-base-ft").unwrap(), "<CAPTION>");
        assert_eq!(
            VisionMode::DenseRegion.prompt_for("florence2-base-ft").unwrap(),
            "<DENSE_REGION_CAPTION>"
        );
    }

    #[test]
    fn vqa_passes_the_question_through_unchanged() {
        let question = "How many windows are open, and which one is focused?";
        assert_eq!(VisionMode::vqa(question).prompt_for("smolvlm-500m-q8").unwrap(), question);
    }

    #[test]
    fn dense_region_on_docling_asks_for_doctags() {
        // Any other instruction loses the <loc_*> boxes, which are the whole
        // point of the mode on this family.
        let prompt = VisionMode::DenseRegion.prompt_for("granite-docling-258m").unwrap();
        assert!(prompt.contains("docling"), "{prompt}");
    }

    #[test]
    fn token_budgets_grow_with_the_expected_answer_length() {
        assert!(
            VisionMode::Caption.default_max_tokens() < VisionMode::DenseRegion.default_max_tokens()
        );
        assert!(
            VisionMode::DenseRegion.default_max_tokens()
                < VisionMode::FullPageOcr.default_max_tokens()
        );
    }

    #[test]
    fn mode_kind_drops_the_question_payload() {
        assert_eq!(VisionMode::vqa("a").kind(), VisionMode::vqa("b").kind());
        assert_eq!(
            serde_json::to_string(&VisionMode::DenseRegion.kind()).unwrap(),
            "\"dense-region\""
        );
    }
}
