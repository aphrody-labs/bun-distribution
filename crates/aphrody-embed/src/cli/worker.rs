// SPDX-License-Identifier: Apache-2.0
//! `aphrody-embed worker`: persistent length-prefixed JSON worker for Aphrody.
//!
//! Models are loaded lazily once per worker. No request data appears in argv.

use std::io::{self, Read, Write};

use crate::native::{
    DEFAULT_MODEL_ID, DEFAULT_RERANKER_ID, ModelFiles, embed_flat, ensure_model, find_model,
    find_reranker, global_embedder, is_installed, model_manifest, models_root, rerank_json,
    reranker_manifest,
};
use base64::Engine as _;
use serde_json::{Value, json};

const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;

fn error(message: impl std::fmt::Display) -> Value {
    json!({ "error": message.to_string() })
}

fn selected(name: &str, default: &str) -> String {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default.into())
}

fn info() -> Value {
    let embed_id = selected("APHRODY_EMBED_MODEL", DEFAULT_MODEL_ID);
    let rerank_id = selected("APHRODY_RERANK_MODEL", DEFAULT_RERANKER_ID);
    let embed = find_model(&embed_id).map(|spec| {
        json!({
            "id": spec.versioned_id(),
            "dim": spec.dim,
            "installed": is_installed(&spec, &spec.default_dir()),
            "dir": spec.default_dir(),
            "sizeBytes": spec.total_size(),
        })
    });
    let rerank = find_reranker(&rerank_id).map(|spec| {
        json!({
            "id": spec.versioned_id(),
            "installed": is_installed(&spec, &spec.default_dir()),
            "dir": spec.default_dir(),
            "sizeBytes": spec.total_size(),
        })
    });
    json!({
        "embed": embed,
        "rerank": rerank,
        "modelsDir": models_root(),
        "available": {
            "embed": model_manifest().iter().map(|m| m.id.clone()).collect::<Vec<_>>(),
            "rerank": reranker_manifest().iter().map(|m| m.id.clone()).collect::<Vec<_>>(),
        }
    })
}

fn embed(request: &Value) -> Value {
    let Some(texts) = request.get("texts").and_then(Value::as_array) else {
        return error("expected a JSON array of strings");
    };
    let Some(texts) = texts.iter().map(Value::as_str).collect::<Option<Vec<_>>>() else {
        return error("expected a JSON array of strings");
    };
    let kind = request
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("passage");
    let model = match global_embedder() {
        Ok(embedder) => embedder.spec().versioned_id(),
        Err(err) => return error(err),
    };
    match embed_flat(&texts, kind) {
        Ok((flat, dim)) => {
            let mut bytes = Vec::with_capacity(flat.len() * 4);
            for value in flat {
                bytes.extend_from_slice(&value.to_le_bytes());
            }
            json!({
                "model": model,
                "dim": dim,
                "count": (bytes.len() / 4).checked_div(dim).unwrap_or(0),
                "data": base64::engine::general_purpose::STANDARD.encode(bytes),
            })
        }
        Err(err) => error(err),
    }
}

fn install(request: &Value) -> Value {
    let Some(id) = request.get("model_id").and_then(Value::as_str) else {
        return error("invalid model id");
    };
    if let Some(spec) = find_model(id) {
        return match ensure_model(&spec, &spec.default_dir()) {
            Ok(dir) => json!({ "id": spec.versioned_id(), "dir": dir }),
            Err(err) => error(err),
        };
    }
    if let Some(spec) = find_reranker(id) {
        return match ensure_model(&spec, &spec.default_dir()) {
            Ok(dir) => json!({ "id": spec.versioned_id(), "dir": dir }),
            Err(err) => error(err),
        };
    }
    error(format!("unknown model id {id}"))
}

fn handle(request: &Value) -> Value {
    match request.get("op").and_then(Value::as_str) {
        Some("info") => info(),
        Some("embed") => embed(request),
        Some("rerank") => {
            let Some(query) = request.get("query").and_then(Value::as_str) else {
                return error("invalid rerank arguments");
            };
            let Some(passages) = request.get("passages") else {
                return error("invalid rerank arguments");
            };
            serde_json::from_str(&rerank_json(query, &passages.to_string())).unwrap_or_else(error)
        }
        Some("install") => install(request),
        _ => error("unknown embedding operation"),
    }
}

fn serve(mut input: impl Read, mut output: impl Write) -> io::Result<()> {
    loop {
        let mut prefix = [0u8; 4];
        match input.read(&mut prefix[..1])? {
            0 => return Ok(()),
            _ => input.read_exact(&mut prefix[1..])?,
        }
        let size = u32::from_le_bytes(prefix) as usize;
        if size > MAX_REQUEST_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "embedding request too large",
            ));
        }
        let mut request = vec![0u8; size];
        input.read_exact(&mut request)?;
        let response = match serde_json::from_slice::<Value>(&request) {
            Ok(request) => std::panic::catch_unwind(|| handle(&request))
                .unwrap_or_else(|_| error("embedding worker panicked")),
            Err(err) => error(format!("invalid embedding request JSON: {err}")),
        };
        let mut bytes = response.to_string().into_bytes();
        if bytes.len() > MAX_RESPONSE_BYTES {
            bytes = error("embedding response too large")
                .to_string()
                .into_bytes();
        }
        output.write_all(&(bytes.len() as u32).to_le_bytes())?;
        output.write_all(&bytes)?;
        output.flush()?;
    }
}

pub(crate) fn run() -> io::Result<()> {
    serve(io::stdin().lock(), io::stdout().lock())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn info_and_bad_requests_do_not_load_models() {
        let info = handle(&json!({ "op": "info" }));
        assert!(info["available"]["embed"].as_array().is_some());
        assert!(handle(&json!({ "op": "embed", "texts": 5 }))["error"].is_string());
        assert!(handle(&json!({ "op": "install", "model_id": "unknown" }))["error"].is_string());
    }

    #[test]
    fn worker_handles_repeated_framed_requests() {
        let mut input = Vec::new();
        for request in [
            json!({ "op": "info" }),
            json!({ "op": "embed", "texts": 5 }),
        ] {
            let bytes = request.to_string().into_bytes();
            input.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
            input.extend_from_slice(&bytes);
        }
        let mut output = Vec::new();
        serve(&input[..], &mut output).unwrap();
        let mut cursor = &output[..];
        for key in ["available", "error"] {
            let mut prefix = [0u8; 4];
            cursor.read_exact(&mut prefix).unwrap();
            let mut payload = vec![0u8; u32::from_le_bytes(prefix) as usize];
            cursor.read_exact(&mut payload).unwrap();
            let response: Value = serde_json::from_slice(&payload).unwrap();
            assert!(response.get(key).is_some());
        }
        assert!(cursor.is_empty());
    }

    #[test]
    fn worker_rejects_oversized_request_before_allocating() {
        let prefix = ((MAX_REQUEST_BYTES + 1) as u32).to_le_bytes();
        let error = serve(&prefix[..], Vec::new()).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }
}
