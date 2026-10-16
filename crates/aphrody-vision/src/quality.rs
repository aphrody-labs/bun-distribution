// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
// Deciding whether an answer is an answer.
//
// A vision model never refuses. Shown glyphs it cannot read it emits a motif
// (`4# 4# 4#`); pushed past what it has to say it repeats one word until the
// token budget runs out. Both come back on stdout with exit status 0 and read,
// to a caller, exactly like a description. The OCR pipeline learned this on
// real plates (see aphrody-ocr-core::audit); the same rules apply here, so
// they are *called*, not restated.
//
// What this module adds is the verdict type: a caption that could not be
// produced is `Unusable`, never an empty string, because an empty string is a
// claim ("nothing to describe") that nobody made.

use aphrody_ocr_core::{
    audit::{Finding, audit_text},
    doctags,
};

/// Why a model answer cannot be used.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "reason", rename_all = "kebab-case")]
#[non_exhaustive]
pub enum Unusable {
    /// The model produced nothing, or nothing but page furniture.
    Empty,
    /// The model repeated a short motif instead of describing anything.
    Filler {
        /// A sample of what it produced.
        sample: String,
    },
    /// The generation got stuck repeating itself.
    Degenerate {
        /// The audit finding that caught it, rendered.
        detail: String,
    },
}

/// A free-form model answer, classified.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum Answer {
    /// Usable prose.
    Ok {
        /// The cleaned text.
        text: String,
    },
    /// Nothing usable came back.
    Unusable(
        /// Why.
        Unusable,
    ),
}

impl Answer {
    /// The text, when there is any.
    #[must_use]
    pub fn text(&self) -> Option<&str> {
        match self {
            Self::Ok { text } => Some(text),
            Self::Unusable(_) => None,
        }
    }

    /// Whether this answer is usable.
    #[must_use]
    pub const fn is_ok(&self) -> bool {
        matches!(self, Self::Ok { .. })
    }
}

/// Clean and classify a model's raw answer.
///
/// The cleanup is the OCR path's: control tokens out, HTML flattened,
/// watermark-only lines dropped. Two things differ, and both follow from a
/// description not being a transcription:
///
/// * emptiness is judged on the *answer*, not on the image — a page with no text on it may still
///   have a perfectly good caption;
/// * a runaway repetition is **rejected, not truncated**. The OCR path keeps the salvageable prefix
///   because half a page of real text is worth having. Half of a description is not: the model was
///   not describing anything, it was stuck, and the prefix would read like a confident short
///   caption.
#[must_use]
pub fn classify(raw: &str) -> Answer {
    let plain = doctags::html_to_text(&doctags::strip_control_tokens(raw));
    let cleaned = doctags::strip_watermarks(&plain).trim().to_owned();

    if cleaned.is_empty() || !cleaned.chars().any(char::is_alphanumeric) {
        return Answer::Unusable(Unusable::Empty);
    }
    if doctags::looks_like_filler(&cleaned) {
        return Answer::Unusable(Unusable::Filler { sample: sample(&cleaned) });
    }
    if let Some(finding) = audit_text(&cleaned).into_iter().find(Finding::is_blocking) {
        return Answer::Unusable(Unusable::Degenerate { detail: render(&finding) });
    }
    Answer::Ok { text: cleaned }
}

/// A short, char-safe excerpt for an error message.
fn sample(text: &str) -> String {
    text.chars().take(60).collect::<String>().trim().to_owned()
}

/// A finding as one line of prose.
fn render(finding: &Finding) -> String {
    match finding {
        Finding::ControlToken { token } => format!("chat control token `{token}` in the answer"),
        Finding::Loop { word, repeats } => format!("`{word}` repeated {repeats} times in a row"),
        Finding::Markup { sample } => format!("markup survived into the answer: {sample}"),
        Finding::Watermark { line } => format!("watermark line: {line}"),
        _ => "unclassified defect".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_prose_is_usable() {
        let answer = classify("A screenshot of a code editor with a terminal panel.");
        assert!(answer.is_ok());
        assert_eq!(answer.text().unwrap(), "A screenshot of a code editor with a terminal panel.");
    }

    #[test]
    fn a_stuck_generation_is_not_a_description() {
        // Observed shape: the model latches onto a word and rides the budget.
        let answer = classify("the the the the the the the the the the");
        match answer {
            Answer::Unusable(Unusable::Degenerate { detail }) => {
                assert!(detail.contains("repeated"), "{detail}");
            },
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn the_motif_a_model_emits_for_unreadable_glyphs_is_rejected() {
        // `4# 4# 4#` is what granite-docling produced for Japanese speech
        // bubbles; recording it as an answer is worse than recording nothing.
        match classify("4# 4# 4# 4# 4#") {
            Answer::Unusable(Unusable::Filler { sample }) => assert!(sample.contains("4#")),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn an_empty_answer_is_unusable_not_an_empty_string() {
        for raw in ["", "   ", "\n\n\t", "----", "..."] {
            assert_eq!(classify(raw), Answer::Unusable(Unusable::Empty), "{raw:?}");
            assert_eq!(classify(raw).text(), None);
        }
    }

    #[test]
    fn chat_control_tokens_are_stripped_rather_than_flagged() {
        // They are an artefact of the harness, not of the answer: stripping
        // them keeps a good caption instead of discarding it.
        let answer = classify("A red bicycle leaning on a wall.<|im_end|>");
        assert_eq!(answer.text().unwrap(), "A red bicycle leaning on a wall.");
    }

    #[test]
    fn html_answers_are_flattened_to_prose() {
        let answer = classify("<p>Two people at a <b>desk</b>.</p>");
        let text = answer.text().unwrap();
        assert!(!text.contains('<'), "{text}");
        assert!(text.contains("desk"), "{text}");
    }

    #[test]
    fn a_long_answer_survives_classification_intact() {
        let long = (0..20)
            .map(|index| format!("Panel {index} shows a distinct dashboard metric."))
            .collect::<Vec<_>>()
            .join(" ");
        assert!(classify(&long).is_ok());
    }

    #[test]
    fn the_verdict_serialises_with_a_status_discriminant() {
        let json = serde_json::to_string(&Answer::Unusable(Unusable::Empty)).unwrap();
        assert_eq!(json, r#"{"status":"unusable","reason":"empty"}"#);
        let json = serde_json::to_string(&Answer::Ok { text: "x".into() }).unwrap();
        assert_eq!(json, r#"{"status":"ok","text":"x"}"#);
    }

    #[test]
    fn the_filler_sample_is_bounded_and_char_safe() {
        let sampled = sample(&"é".repeat(500));
        assert_eq!(sampled.chars().count(), 60);
    }
}
