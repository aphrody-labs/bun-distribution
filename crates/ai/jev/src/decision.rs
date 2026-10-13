// SPDX-License-Identifier: Apache-2.0
//! Confidence-gated candidate selection shared by backend consumers.

use crate::{Answer, JevError, Request, Response, check_request, check_response};

pub(crate) fn check_threshold(threshold: f64) -> Result<(), JevError> {
    if threshold.is_finite() && (0.0..=1.0).contains(&threshold) {
        Ok(())
    } else {
        Err(JevError::InvalidRequest("confidence threshold must be within [0, 1]".into()))
    }
}

pub(crate) fn parse_threshold(value: &str) -> Result<f64, JevError> {
    let threshold = value
        .parse::<f64>()
        .map_err(|_| JevError::InvalidRequest("confidence threshold must be a number".into()))?;
    check_threshold(threshold)?;
    Ok(threshold)
}

/// Select all Choice answers after validating the batch once; `None` means abstention.
/// Non-Choice answers remain available in the original response.
///
/// # Errors
/// Invalid thresholds or malformed requests/responses.
pub fn confident_choices<'a>(
    request: &Request,
    response: &'a Response,
    minimum_confidence: f64,
) -> Result<std::collections::BTreeMap<&'a str, Option<&'a str>>, JevError> {
    check_threshold(minimum_confidence)?;
    check_request(request)?;
    check_response(request, response)?;
    Ok(response
        .answers
        .iter()
        .filter_map(|(name, answer)| match answer {
            Answer::Choice { choice, confidence, .. } => Some((
                name.as_str(),
                (*confidence >= minimum_confidence).then_some(choice.as_str()),
            )),
            _ => None,
        })
        .collect())
}

/// Return a validated candidate, or abstain below the caller's confidence threshold.
///
/// This does not execute an action or grant permissions. The caller retains the
/// original response and its distributions for ranking and audit.
///
/// # Errors
/// Invalid thresholds, malformed requests/responses, missing questions, or a
/// question that is not a Choice.
pub fn confident_choice<'a>(
    request: &Request,
    response: &'a Response,
    name: &str,
    minimum_confidence: f64,
) -> Result<Option<&'a str>, JevError> {
    check_threshold(minimum_confidence)?;
    check_request(request)?;
    check_response(request, response)?;
    match response.answers.get(name) {
        Some(Answer::Choice { choice, confidence, .. }) => {
            Ok((*confidence >= minimum_confidence).then_some(choice.as_str()))
        },
        Some(_) => Err(JevError::InvalidRequest(format!("`{name}` is not a Choice question"))),
        None => Err(JevError::InvalidRequest(format!("unknown question `{name}`"))),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use crate::{Question, Usage};

    use super::*;

    fn fixture(confidence: f64) -> (Request, Response) {
        let request = Request::new("synthetic tool-routing fixture").question(
            "tool",
            Question::choice("Choose a supplied tool", [("search", "Search"), ("read", "Read")]),
        );
        let response = Response {
            model: "fixture".into(),
            answers: BTreeMap::from([(
                "tool".into(),
                Answer::Choice {
                    choice: "read".into(),
                    confidence,
                    probabilities: BTreeMap::new(),
                },
            )]),
            usage: Usage::default(),
        };
        (request, response)
    }

    #[test]
    fn accepts_the_boundary_and_abstains_below_it_without_changing_the_response() {
        let (request, response) = fixture(0.8);
        let original = response.clone();
        assert_eq!(confident_choice(&request, &response, "tool", 0.8).unwrap(), Some("read"));
        assert_eq!(confident_choice(&request, &response, "tool", 0.9).unwrap(), None);
        assert_eq!(response, original);
        assert_eq!(confident_choices(&request, &response, 0.8).unwrap()["tool"], Some("read"));
        assert_eq!(confident_choices(&request, &response, 0.9).unwrap()["tool"], None);
    }

    #[test]
    fn rejects_invalid_thresholds_and_malformed_answers_before_selection() {
        let (request, response) = fixture(0.8);
        for threshold in [f64::NAN, f64::INFINITY, -0.1, 1.1] {
            assert!(confident_choice(&request, &response, "tool", threshold).is_err());
        }
        let (_, malformed) = fixture(1.2);
        assert!(confident_choice(&request, &malformed, "tool", 0.0).is_err());
        assert!(confident_choice(&request, &response, "missing", 0.0).is_err());
        let mut foreign = response.clone();
        let Some(Answer::Choice { choice, .. }) = foreign.answers.get_mut("tool") else { panic!() };
        *choice = "execute-unlisted-action".into();
        assert!(confident_choice(&request, &foreign, "tool", 0.0).is_err());
    }
}
