// SPDX-License-Identifier: Apache-2.0
//! Strict validation: a request must be well-formed before it leaves the
//! process, and a response is accepted only when every answer is a
//! conforming `Noul`, `Choice` or `Score` for the question it answers.

use std::collections::BTreeMap;

use crate::{
    JevError,
    types::{Answer, Question, Request, Response},
};

/// Reject requests the API would refuse with 422.
///
/// # Errors
/// [`JevError::InvalidRequest`] naming the offending question.
pub fn check_request(request: &Request) -> Result<(), JevError> {
    let invalid = |message: String| Err(JevError::InvalidRequest(message));
    if request.model.trim().is_empty() {
        return invalid("model is empty".into());
    }
    if request.questions.is_empty() {
        return invalid("at least one question is required".into());
    }
    for (name, question) in &request.questions {
        let instructions = match question {
            Question::Noul { instructions, .. }
            | Question::Choice { instructions, .. }
            | Question::Score { instructions, .. } => instructions,
        };
        if instructions.trim().is_empty() {
            return invalid(format!("question `{name}` has empty instructions"));
        }
        match question {
            Question::Choice { criteria, .. } if criteria.len() < 2 => {
                return invalid(format!("choice `{name}` needs at least two options"));
            },
            Question::Score { criteria, .. } if criteria.len() < 2 => {
                return invalid(format!("score `{name}` needs at least two levels"));
            },
            _ => {},
        }
    }
    Ok(())
}

/// Accept a response only if it answers exactly the asked questions with
/// conforming primitives.
///
/// # Errors
/// [`JevError::Format`] describing the first violation.
pub fn check_response(request: &Request, response: &Response) -> Result<(), JevError> {
    for name in response.answers.keys() {
        if !request.questions.contains_key(name) {
            return format_error(format!("unexpected answer `{name}`"));
        }
    }
    for (name, question) in &request.questions {
        let Some(answer) = response.answers.get(name) else {
            return format_error(format!("missing answer `{name}`"));
        };
        check_answer(name, question, answer)?;
    }
    Ok(())
}

fn check_answer(name: &str, question: &Question, answer: &Answer) -> Result<(), JevError> {
    match (question, answer) {
        (Question::Noul { .. }, Answer::Noul { noul }) => unit(name, "noul", *noul),
        (
            Question::Choice { criteria, .. },
            Answer::Choice { choice, confidence, probabilities },
        ) => {
            if !criteria.contains_key(choice) {
                return format_error(format!("`{name}` chose `{choice}`, not an option"));
            }
            unit(name, "confidence", *confidence)?;
            distribution(name, probabilities, |key| criteria.contains_key(key))
        },
        (
            Question::Score { criteria, .. },
            Answer::Score { score, confidence, probabilities, .. },
        ) => {
            #[allow(clippy::cast_precision_loss, reason = "level counts are tiny")]
            let top = (criteria.len() - 1) as f64;
            if !score.is_finite() || *score < 0.0 || *score > top {
                return format_error(format!("`{name}` score {score} outside [0, {top}]"));
            }
            unit(name, "confidence", *confidence)?;
            distribution(name, probabilities, |key| {
                key.parse::<usize>().is_ok_and(|level| level < criteria.len())
            })
        },
        _ => format_error(format!(
            "`{name}` asked as {} but answered as {}",
            question.kind(),
            answer.kind()
        )),
    }
}

fn unit(name: &str, field: &str, value: f64) -> Result<(), JevError> {
    if value.is_finite() && (0.0..=1.0).contains(&value) {
        Ok(())
    } else {
        format_error(format!("`{name}` {field} {value} outside [0, 1]"))
    }
}

fn distribution(
    name: &str,
    probabilities: &BTreeMap<String, f64>,
    known: impl Fn(&str) -> bool,
) -> Result<(), JevError> {
    for (key, value) in probabilities {
        if !known(key) {
            return format_error(format!("`{name}` has probability for unknown `{key}`"));
        }
        unit(name, "probability", *value)?;
    }
    Ok(())
}

fn format_error<T>(message: String) -> Result<T, JevError> {
    Err(JevError::Format(message))
}
