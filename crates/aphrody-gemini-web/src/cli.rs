// SPDX-License-Identifier: Apache-2.0
//! One-request JSON process boundary for OS clients of Gemini Web.
//!
//! The request is read from stdin so neither the cookie path nor the prompt
//! appears in process arguments. Stdout contains one JSON response.
//!
//! The boundary needs stdin and a cookie file, so it exists on host targets
//! only; a browser links the library instead.

use std::{
    ffi::OsString,
    io::{Read, Write},
};

use serde::Deserialize;
use serde_json::{json, Value};

use crate::{GeminiModel, GeminiWebClient};

#[derive(Deserialize)]
struct Request {
    cookie_path: Option<String>,
    prompt: String,
    model: Option<String>,
}

fn model_header(model: Option<String>) -> Option<String> {
    model.map(|id| GeminiModel::from_id(&id).map_or(id, GeminiModel::header))
}

async fn answer(request: Request) -> Value {
    let client_res = if let Some(path) = request.cookie_path.as_deref().filter(|p| !p.is_empty()) {
        GeminiWebClient::from_cookie_file(path, "en").await
    } else {
        GeminiWebClient::from_default_cookie_file("en").await
    };
    let client = match client_res {
        Ok(client) => client,
        Err(error) => {
            return json!({"error": format!("Failed to execute Gemini request: {error}")});
        }
    };
    let header = model_header(request.model);
    match client.ask(&request.prompt, header.as_deref()).await {
        Ok(reply) => json!({
            "text": reply.text,
            "conversation_id": reply.metadata.conversation_id,
            "response_id": reply.metadata.response_id,
            "choice_id": reply.metadata.choice_id,
        }),
        Err(error) => json!({"error": format!("Failed to execute Gemini request: {error}")}),
    }
}

/// Read one request from stdin, answer it, write one JSON line to stdout.
async fn run() {
    let mut input = Vec::new();
    let response = match std::io::stdin()
        .take(1024 * 1024 + 1)
        .read_to_end(&mut input)
    {
        Ok(_) if input.len() <= 1024 * 1024 => match serde_json::from_slice::<Request>(&input) {
            Ok(request) => answer(request).await,
            Err(_) => json!({"error": "invalid Gemini request JSON"}),
        },
        _ => json!({"error": "Gemini request exceeds 1 MiB"}),
    };
    let mut output = std::io::stdout().lock();
    let _ = writeln!(output, "{response}");
}

/// Entry point of the former `aphrody-gemini-web` binary, now reached through the `aphrody`
/// multi-call binary. `args[0]` is the program name (argv convention). Returns the process exit
/// code. The arguments are ignored: the request comes from stdin.
#[must_use]
pub fn cli_main(_args: Vec<OsString>) -> i32 {
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("aphrody-gemini-web: runtime: {error}");
            return 1;
        }
    };
    runtime.block_on(run());
    0
}

#[cfg(test)]
mod tests {
    use super::model_header;
    use crate::GeminiModel;

    #[test]
    fn expands_known_model_and_preserves_custom_header() {
        assert_eq!(
            model_header(Some("flash".into())),
            Some(GeminiModel::Flash.header())
        );
        assert_eq!(model_header(Some("custom".into())), Some("custom".into()));
        assert_eq!(model_header(None), None);
    }
}
