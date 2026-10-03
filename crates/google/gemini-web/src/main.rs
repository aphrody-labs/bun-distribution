// SPDX-License-Identifier: Apache-2.0
//! One-request JSON process boundary for OS clients of Gemini Web.
//!
//! The request is read from stdin so neither the cookie path nor the prompt
//! appears in process arguments. Stdout contains one JSON response.
//!
//! The boundary needs stdin and a cookie file, so it exists on host targets
//! only; a browser links the library instead and this binary is an empty stub
//! there.

#[cfg(not(target_family = "wasm"))]
mod host {
    use std::io::{Read, Write};

    use aphrody_gemini_web::{GeminiModel, GeminiWebClient};
    use serde::Deserialize;
    use serde_json::{Value, json};

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
            },
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
    pub(crate) async fn run() {
        let mut input = Vec::new();
        let response = match std::io::stdin().take(1024 * 1024 + 1).read_to_end(&mut input) {
            Ok(_) if input.len() <= 1024 * 1024 => {
                match serde_json::from_slice::<Request>(&input) {
                    Ok(request) => answer(request).await,
                    Err(_) => json!({"error": "invalid Gemini request JSON"}),
                }
            },
            _ => json!({"error": "Gemini request exceeds 1 MiB"}),
        };
        let mut output = std::io::stdout().lock();
        let _ = writeln!(output, "{response}");
    }

    #[cfg(test)]
    mod tests {
        use aphrody_gemini_web::GeminiModel;

        use super::model_header;

        #[test]
        fn expands_known_model_and_preserves_custom_header() {
            assert_eq!(model_header(Some("flash".into())), Some(GeminiModel::Flash.header()));
            assert_eq!(model_header(Some("custom".into())), Some("custom".into()));
            assert_eq!(model_header(None), None);
        }
    }
}

#[cfg(not(target_family = "wasm"))]
#[tokio::main]
async fn main() {
    host::run().await;
}

#[cfg(target_family = "wasm")]
fn main() {}
