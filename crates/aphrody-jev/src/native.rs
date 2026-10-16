// SPDX-License-Identifier: Apache-2.0
//! Jev endpoint adapter for the product's existing local model service.
//!
//! Every question becomes one constrained completion on an OpenAI-compatible
//! server supplied by the caller: the options are labelled `A`,
//! `B`, … and the model emits a single token. The engine reads the log
//! probabilities of the option letters, not the generated text, so each
//! answer is a normalized distribution:
//!
//! - `Noul` — `A` = yes, `B` = no; the answer is `P(yes)`.
//! - `Choice` — one letter per option; the answer is the arg-max option.
//! - `Score` — one letter per level in order; the answer is the expected level index `Σ i·pᵢ`,
//!   which can fall between two levels like Jev's.
//!
//! `confidence` is the probability of the most likely option. Probabilities
//! are rounded to two decimals and every option is listed, as Jev does.
//! The wire format is compatible; the values come from the configured endpoint.

use std::{collections::BTreeMap, fmt::Write as _};

use futures::future::join_all;
use serde::Deserialize;
use serde_json::json;
use url::Url;

use crate::{Answer, JevError, Question, Request, Response, Usage, check_request, check_response};

/// Letters used to label options; also the maximum option count.
const LABELS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const TOP_LOGPROBS: u8 = 20;

const SYSTEM_PROMPT: &str = "You are a decision function. Read the state, then answer the \
                             question by replying with exactly one option letter and nothing else.";

/// HTTP client of an existing OpenAI-compatible model endpoint.
#[derive(Clone)]
pub struct NativeEngine {
    http: reqwest::Client,
    base: Url,
    model: String,
    api_key: Option<String>,
}

impl std::fmt::Debug for NativeEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NativeEngine")
            .field("base", &self.base.as_str())
            .field("model", &self.model)
            .field("api_key", &self.api_key.as_ref().map(|_| "<redacted>"))
            .finish_non_exhaustive()
    }
}

#[derive(Deserialize)]
struct Completion {
    choices: Vec<CompletionChoice>,
    #[serde(default)]
    usage: Option<CompletionUsage>,
}

#[derive(Deserialize)]
struct CompletionChoice {
    logprobs: Option<ChoiceLogprobs>,
}

#[derive(Deserialize)]
struct ChoiceLogprobs {
    content: Vec<TokenLogprob>,
}

#[derive(Deserialize)]
struct TokenLogprob {
    #[serde(default)]
    top_logprobs: Vec<TopLogprob>,
}

#[derive(Deserialize)]
struct TopLogprob {
    token: String,
    logprob: f64,
}

#[derive(Deserialize, Default)]
struct CompletionUsage {
    #[serde(default)]
    prompt_tokens: u64,
    #[serde(default)]
    completion_tokens: u64,
}

impl NativeEngine {
    /// Engine on an OpenAI-compatible base URL that already contains the
    /// version segment, e.g. `http://127.0.0.1:8091/v1`.
    ///
    /// # Errors
    /// [`JevError::Config`] for a malformed URL or empty model.
    pub fn new(
        base: &str,
        model: impl Into<String>,
        api_key: Option<String>,
    ) -> Result<Self, JevError> {
        let model = model.into();
        if model.trim().is_empty() {
            return Err(JevError::Config("native engine model is empty".into()));
        }
        let with_slash = if base.ends_with('/') {
            base.to_owned()
        } else {
            format!("{base}/")
        };
        let base = Url::parse(&with_slash).map_err(|e| JevError::Config(format!("{base}: {e}")))?;
        #[cfg(not(target_arch = "wasm32"))]
        let _ = rustls::crypto::ring::default_provider().install_default();
        let http = reqwest::Client::builder()
            .user_agent(concat!("aphrody-jev/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| JevError::Config(e.to_string()))?;
        Ok(Self {
            http,
            base,
            model,
            api_key,
        })
    }

    /// Model id reported in responses: `aphrody-jev/<local model>`.
    #[must_use]
    pub fn model_id(&self) -> String {
        format!("aphrody-jev/{}", self.model)
    }

    /// Answer every question of `request`, concurrently.
    ///
    /// # Errors
    /// [`JevError::Unavailable`] when the engine cannot be reached (so the
    /// router may fail over), [`JevError::Format`] when it returns no usable
    /// log probabilities, [`JevError::InvalidRequest`] for too many options.
    pub async fn decide(
        &self,
        request: &Request,
        timeout: std::time::Duration,
    ) -> Result<Response, JevError> {
        check_request(request)?;
        let state = match &request.state {
            serde_json::Value::String(text) => text.clone(),
            other => other.to_string(),
        };
        let calls = request.questions.iter().map(|(name, question)| {
            let state = &state;
            async move { (name.clone(), self.answer(state, question, timeout).await) }
        });
        let mut answers = BTreeMap::new();
        let mut usage = Some(Usage::default());
        for (name, result) in join_all(calls).await {
            let (answer, used) = result?;
            usage = match (usage, used) {
                (Some(usage), Some(used)) => Some(Usage {
                    input_tokens: usage
                        .input_tokens
                        .checked_add(used.prompt_tokens)
                        .ok_or_else(|| {
                            JevError::Format("native input token count overflow".into())
                        })?,
                    output_tokens: usage
                        .output_tokens
                        .checked_add(used.completion_tokens)
                        .ok_or_else(|| {
                            JevError::Format("native output token count overflow".into())
                        })?,
                }),
                _ => None,
            };
            answers.insert(name, answer);
        }
        let response = Response {
            model: self.model_id(),
            answers,
            usage,
        };
        check_response(request, &response)?;
        Ok(response)
    }

    async fn answer(
        &self,
        state: &str,
        question: &Question,
        timeout: std::time::Duration,
    ) -> Result<(Answer, Option<CompletionUsage>), JevError> {
        let options = options(question);
        if options.len() > LABELS.len() {
            return Err(JevError::InvalidRequest(format!(
                "the native engine supports at most {} options",
                LABELS.len()
            )));
        }
        let (instructions, criteria_note) = match question {
            Question::Noul { instructions, .. } | Question::Choice { instructions, .. } => {
                (instructions, "")
            }
            Question::Score { instructions, .. } => (
                instructions,
                "\nThe options are ordered from lowest to highest.",
            ),
        };
        let mut listing = String::new();
        for (index, (_, text)) in options.iter().enumerate() {
            writeln!(listing, "{}) {text}", char::from(LABELS[index]))
                .expect("writing to a String cannot fail");
        }
        let instructions = entry_text(instructions);
        let prompt = format!(
            "State:\n{state}\n\nQuestion: \
             {instructions}{criteria_note}\n\nOptions:\n{listing}\nReply with one letter."
        );
        let body = json!({
            "model": self.model,
            "temperature": 0,
            "max_tokens": 1,
            "logprobs": true,
            "top_logprobs": TOP_LOGPROBS,
            "messages": [
                { "role": "system", "content": SYSTEM_PROMPT },
                { "role": "user", "content": prompt },
            ],
        });
        let url = self
            .base
            .join("chat/completions")
            .map_err(|e| JevError::Config(e.to_string()))?;
        let mut call = self.http.post(url).timeout(timeout).json(&body);
        if let Some(key) = &self.api_key {
            call = call.bearer_auth(key);
        }
        let reply = call
            .send()
            .await
            .map_err(|_| JevError::Unavailable("native_transport_error".into()))?;
        let status = reply.status();
        let bytes = reply
            .bytes()
            .await
            .map_err(|_| JevError::Unavailable("native_response_body_error".into()))?;
        if !status.is_success() {
            return Err(JevError::Unavailable(format!(
                "native_http_{}",
                status.as_u16(),
            )));
        }
        let completion: Completion = serde_json::from_slice(&bytes)
            .map_err(|e| JevError::Format(format!("native engine: {e}")))?;
        let top = completion
            .choices
            .first()
            .and_then(|c| c.logprobs.as_ref())
            .and_then(|l| l.content.first())
            .map(|t| t.top_logprobs.as_slice())
            .unwrap_or_default();
        let probabilities = letter_distribution(top, options.len())?;
        let answer = shape(question, &options, &probabilities);
        Ok((answer, completion.usage))
    }
}

fn entry_text(entry: &crate::Entry) -> String {
    match entry {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Null => String::new(),
        value => value.to_string(),
    }
}

/// `(key, text shown to the model)` per option, in label order.
fn options(question: &Question) -> Vec<(String, String)> {
    match question {
        Question::Noul { criteria, .. } => {
            let meaning = |key: &str| {
                criteria
                    .as_ref()
                    .and_then(|c| c.get(key))
                    .map_or_else(String::new, |m| format!(" — {}", entry_text(m)))
            };
            vec![
                ("true".into(), format!("Yes{}", meaning("true"))),
                ("false".into(), format!("No{}", meaning("false"))),
            ]
        }
        Question::Choice { criteria, .. } => criteria
            .iter()
            .map(|(key, text)| (key.clone(), format!("{key}: {}", entry_text(text))))
            .collect(),
        Question::Score { criteria, .. } => criteria
            .iter()
            .enumerate()
            .map(|(i, text)| (i.to_string(), entry_text(text)))
            .collect(),
    }
}

/// Softmax over the option letters found among the top log-probabilities.
/// Letters absent from the top list get probability zero.
fn letter_distribution(top: &[TopLogprob], count: usize) -> Result<Vec<f64>, JevError> {
    let mut mass = vec![0.0_f64; count];
    for candidate in top {
        let token = candidate.token.trim();
        let mut chars = token.chars();
        let (Some(letter), None) = (chars.next(), chars.next()) else {
            continue;
        };
        let letter = letter.to_ascii_uppercase();
        if let Some(index) = LABELS.iter().position(|&l| l as char == letter)
            && index < count
        {
            mass[index] += candidate.logprob.exp();
        }
    }
    let total: f64 = mass.iter().sum();
    if !(total.is_finite() && total > 0.0) {
        return Err(JevError::Format(
            "native engine: no option letter among the top log-probabilities".into(),
        ));
    }
    Ok(mass.into_iter().map(|m| m / total).collect())
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn shape(question: &Question, options: &[(String, String)], probabilities: &[f64]) -> Answer {
    let (best, best_p) =
        probabilities
            .iter()
            .copied()
            .enumerate()
            .fold(
                (0, f64::MIN),
                |acc, (i, p)| if p > acc.1 { (i, p) } else { acc },
            );
    let distribution = || {
        options
            .iter()
            .zip(probabilities)
            .map(|((key, _), p)| (key.clone(), round2(*p)))
            .collect::<BTreeMap<_, _>>()
    };
    match question {
        Question::Noul { .. } => Answer::Noul {
            noul: round2(probabilities[0]),
        },
        Question::Choice { .. } => Answer::Choice {
            choice: options[best].0.clone(),
            confidence: round2(best_p),
            probabilities: distribution(),
        },
        Question::Score { criteria, .. } => {
            #[allow(clippy::cast_precision_loss, reason = "level counts are tiny")]
            let expected: f64 = probabilities
                .iter()
                .enumerate()
                .map(|(i, p)| i as f64 * p)
                .sum();
            Answer::Score {
                score: round2(expected),
                confidence: round2(best_p),
                legend: criteria
                    .iter()
                    .enumerate()
                    .map(|(i, text)| (i.to_string(), text.clone()))
                    .collect(),
                probabilities: distribution(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn top(pairs: &[(&str, f64)]) -> Vec<TopLogprob> {
        pairs
            .iter()
            .map(|(t, p)| TopLogprob {
                token: (*t).into(),
                logprob: p.ln(),
            })
            .collect()
    }

    #[test]
    fn distribution_merges_case_and_whitespace_and_ignores_words() {
        let dist = letter_distribution(
            &top(&[("A", 0.6), (" a", 0.1), ("B", 0.2), ("Yes", 0.1)]),
            2,
        )
        .unwrap();
        assert!((dist[0] - 0.7 / 0.9).abs() < 1e-9);
        assert!((dist[1] - 0.2 / 0.9).abs() < 1e-9);
    }

    #[test]
    fn letters_beyond_the_option_count_are_ignored() {
        let dist = letter_distribution(&top(&[("C", 0.9), ("A", 0.05), ("B", 0.05)]), 2).unwrap();
        assert_eq!(dist, vec![0.5, 0.5]);
        assert!(letter_distribution(&top(&[("Yes", 1.0)]), 2).is_err());
    }

    #[test]
    fn score_is_the_expected_level_and_lists_every_level() {
        let question = Question::score("How angry?", ["Calm", "Frustrated", "Very angry"]);
        let options = options(&question);
        let Answer::Score {
            score,
            confidence,
            legend,
            probabilities,
        } = shape(&question, &options, &[0.0, 0.96, 0.04])
        else {
            panic!("score expected")
        };
        assert!((score - 1.04).abs() < 1e-9);
        assert!((confidence - 0.96).abs() < 1e-9);
        assert_eq!(legend["2"], "Very angry");
        assert_eq!(probabilities.len(), 3);
    }

    #[test]
    fn choice_uses_option_keys() {
        let question = Question::choice("Team?", [("billing", "Payments"), ("technical", "Bugs")]);
        let options = options(&question);
        let Answer::Choice {
            choice,
            probabilities,
            ..
        } = shape(&question, &options, &[0.13, 0.87])
        else {
            panic!("choice expected")
        };
        assert_eq!(choice, "technical");
        assert_eq!(probabilities["billing"], 0.13);
    }
}
