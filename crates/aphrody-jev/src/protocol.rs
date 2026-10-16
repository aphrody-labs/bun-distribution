// SPDX-License-Identifier: MIT
//! Canonical SDK 0.6 JSON protocol and Bun's bounded validation contract.

use serde_json::{Map, Value};

pub const MAX_JSON_BYTES: usize = 1024 * 1024;
const MAX_QUESTIONS: usize = 64;

pub type Result<T> = std::result::Result<T, String>;

pub fn parse(input: &[u8]) -> Result<Value> {
    if input.len() > MAX_JSON_BYTES {
        return Err("Yolo JSON exceeds 1048576 bytes".into());
    }
    serde_json::from_slice(input).map_err(|error| format!("Yolo JSON: {error}"))
}

fn object<'a>(value: &'a Value, name: &str) -> Result<&'a Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| format!("Yolo {name} must be an object"))
}

fn string<'a>(value: &'a Value, name: &str) -> Result<&'a str> {
    value
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Yolo {name} must be a nonempty string"))
}

fn number(value: &Value, name: &str, max: f64) -> Result<f64> {
    value
        .as_f64()
        .filter(|value| value.is_finite() && *value >= 0.0 && *value <= max)
        .ok_or_else(|| format!("Yolo {name} must be finite and between 0 and {max}"))
}

fn entry(value: &Value, name: &str) -> Result<()> {
    if value.is_null() || value.is_string() || value.is_object() || value.is_array() {
        Ok(())
    } else {
        Err(format!(
            "Yolo {name} must be text, an object, an array or null"
        ))
    }
}

fn identifier(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 128
        || matches!(value, "__proto__" | "prototype" | "constructor")
    {
        Err("Yolo question and choice names must be nonempty, at most 128 bytes, and not prototype names".into())
    } else {
        Ok(())
    }
}

pub fn question(value: &Value) -> Result<()> {
    let fields = object(value, "question")?;
    if let Some(instructions) = fields.get("instructions") {
        entry(instructions, "instructions")?;
    }
    match fields.get("type").and_then(Value::as_str) {
        Some("noul") => {
            if let Some(criteria) = fields.get("criteria").filter(|value| !value.is_null()) {
                for (name, value) in object(criteria, "noul criteria")? {
                    if name != "true" && name != "false" {
                        return Err("Yolo noul criteria accept only true and false".into());
                    }
                    entry(value, "noul criterion")?;
                }
            }
        }
        Some("choice") => {
            let criteria = object(
                fields.get("criteria").unwrap_or(&Value::Null),
                "choice criteria",
            )?;
            if !(2..=255).contains(&criteria.len()) {
                return Err("Yolo choice requires 2 to 255 options".into());
            }
            for (name, value) in criteria {
                identifier(name)?;
                entry(value, "choice criterion")?;
            }
        }
        Some("score") => {
            let criteria = fields
                .get("criteria")
                .and_then(Value::as_array)
                .filter(|criteria| (2..=10).contains(&criteria.len()))
                .ok_or("Yolo score requires an ordered list of 2 to 10 criteria")?;
            for value in criteria {
                entry(value, "score criterion")?;
            }
        }
        _ => return Err("Yolo question type must be noul, choice or score".into()),
    }
    if fields
        .keys()
        .any(|key| !matches!(key.as_str(), "type" | "instructions" | "criteria"))
    {
        return Err("Yolo question contains an unknown field".into());
    }
    Ok(())
}

pub fn request(value: &Value) -> Result<()> {
    let fields = object(value, "request")?;
    entry(
        fields.get("state").ok_or("Yolo request requires state")?,
        "state",
    )?;
    let questions = object(fields.get("questions").unwrap_or(&Value::Null), "questions")?;
    if !(1..=MAX_QUESTIONS).contains(&questions.len()) {
        return Err("Yolo requires 1 to 64 named questions".into());
    }
    for (name, value) in questions {
        identifier(name)?;
        question(value)?;
    }
    if let Some(model) = fields.get("model") {
        if string(model, "model")?.len() > 256 {
            return Err("Yolo model name exceeds 256 bytes".into());
        }
    }
    if fields
        .keys()
        .any(|key| !matches!(key.as_str(), "state" | "questions" | "model"))
    {
        return Err("Yolo request contains an unknown field".into());
    }
    Ok(())
}

pub fn answer(value: &Value, question_value: &Value) -> Result<()> {
    question(question_value)?;
    answer_validated(value, question_value)
}

fn answer_validated(value: &Value, question: &Value) -> Result<()> {
    let answer = object(value, "answer")?;
    let kind = question
        .get("type")
        .and_then(Value::as_str)
        .ok_or("Yolo question type is missing")?;
    if answer.get("type").and_then(Value::as_str) != Some(kind) {
        return Err("Yolo answer type differs from its question".into());
    }
    let allowed: &[&str] = match kind {
        "noul" => {
            number(answer.get("noul").unwrap_or(&Value::Null), "noul", 1.0)?;
            &["type", "noul"]
        }
        "choice" | "score" => {
            number(
                answer.get("confidence").unwrap_or(&Value::Null),
                "confidence",
                1.0,
            )?;
            let probabilities = object(
                answer.get("probabilities").unwrap_or(&Value::Null),
                "probabilities",
            )?;
            let expected: Vec<String> = if kind == "choice" {
                let criteria = object(&question["criteria"], "choice criteria")?;
                let choice = string(answer.get("choice").unwrap_or(&Value::Null), "choice")?;
                if !criteria.contains_key(choice) {
                    return Err("Yolo choice answer is not one of its options".into());
                }
                criteria.keys().cloned().collect()
            } else {
                let criteria = question["criteria"]
                    .as_array()
                    .ok_or("Yolo score criteria are missing")?;
                number(
                    answer.get("score").unwrap_or(&Value::Null),
                    "score",
                    (criteria.len() - 1) as f64,
                )?;
                let legend = object(answer.get("legend").unwrap_or(&Value::Null), "score legend")?;
                if legend.len() != criteria.len()
                    || criteria
                        .iter()
                        .enumerate()
                        .any(|(index, value)| legend.get(&index.to_string()) != Some(value))
                {
                    return Err("Yolo score legend differs from its ordered criteria".into());
                }
                (0..criteria.len()).map(|index| index.to_string()).collect()
            };
            if probabilities.len() != expected.len()
                || expected.iter().any(|key| !probabilities.contains_key(key))
            {
                return Err("Yolo probability keys differ from the question options".into());
            }
            for probability in probabilities.values() {
                number(probability, "probability", 1.0)?;
            }
            if kind == "choice" {
                &["type", "choice", "confidence", "probabilities"]
            } else {
                &["type", "score", "confidence", "legend", "probabilities"]
            }
        }
        _ => return Err("Yolo answer type is unknown".into()),
    };
    if answer.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err("Yolo answer contains an unknown field".into());
    }
    Ok(())
}

pub fn response(value: &Value, request_value: &Value) -> Result<()> {
    request(request_value)?;
    let fields = object(value, "response")?;
    if string(
        fields.get("model").unwrap_or(&Value::Null),
        "response model",
    )?
    .len()
        > 256
    {
        return Err("Yolo response model exceeds 256 bytes".into());
    }
    let usage = fields
        .get("usage")
        .ok_or("Yolo response requires usage, or null when unknown")?;
    if !usage.is_null() {
        let usage = object(usage, "usage")?;
        for name in ["input_tokens", "output_tokens"] {
            if usage
                .get(name)
                .and_then(Value::as_u64)
                .filter(|count| *count <= 9_007_199_254_740_991)
                .is_none()
            {
                return Err(format!("Yolo {name} must be a nonnegative safe integer"));
            }
        }
    }
    let answers = object(fields.get("answers").unwrap_or(&Value::Null), "answers")?;
    let questions = object(&request_value["questions"], "questions")?;
    if answers.len() != questions.len() || answers.keys().any(|key| !questions.contains_key(key)) {
        return Err("Yolo answer names differ from its named questions".into());
    }
    for (name, question) in questions {
        answer_validated(answers.get(name).ok_or("Yolo answer is missing")?, question)?;
    }
    Ok(())
}

pub fn threshold(value: &Value) -> Result<f64> {
    number(value, "threshold", 1.0)
}

/// Extract a primitive from an answer validated against its question.
pub fn primitive(answer: &Value, threshold_value: f64) -> Result<Value> {
    let threshold = threshold(&Value::from(threshold_value))?;
    match answer["type"].as_str() {
        Some("noul") => Ok(Value::Bool(
            number(&answer["noul"], "noul", 1.0)? > threshold,
        )),
        Some("choice") => Ok(Value::String(
            string(&answer["choice"], "choice")?.to_owned(),
        )),
        Some("score") => {
            number(&answer["score"], "score", 9.0)?;
            Ok(answer["score"].clone())
        }
        _ => Err("Yolo primitive answer type is unknown".into()),
    }
}
