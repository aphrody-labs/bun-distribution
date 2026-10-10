// SPDX-License-Identifier: Apache-2.0
use aphrody_antigravity::{
    auth::OAuthToken, client::AntigravityClient, endpoints::CloudCodeEndpoint, error::SdkError,
};
use aphrody_model_antigravity::AntigravityModelClient;
use aphrody_model_client::{ChatMessage, ChatTurn, ModelClient, Part, Role};
use pretty_assertions::assert_eq;

fn dummy_client() -> AntigravityClient {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let token = OAuthToken {
        access_token: "dummy-token-12345".to_string(),
        refresh_token: None,
        expiry: None,
        auth_method: Some("consumer".to_string()),
    };
    AntigravityClient::new(reqwest::Client::new(), token)
}

#[test]
fn test_client_initialization_and_capabilities() {
    let raw = dummy_client();
    let client = AntigravityModelClient::new(raw, "gemini-3-flash")
        .with_endpoint(CloudCodeEndpoint::Daily)
        .with_project("test-project-42");

    assert_eq!(client.model_id(), "gemini-3-flash");
    assert_eq!(client.model(), "gemini-3-flash");

    let caps = client.capabilities();
    assert!(caps.tools);
    assert!(caps.parallel_tool_calls);
    assert!(caps.images);
    assert!(caps.reasoning);
    assert!(caps.json_schema);
    assert_eq!(caps.context_window, Some(1_048_576));
}

#[test]
fn test_turn_structure_with_tools_and_thoughts() {
    let turn = ChatTurn {
        system: Some("You are a helpful assistant.".to_string()),
        messages: vec![
            ChatMessage {
                role: Role::User,
                parts: vec![Part::Text("List files in current directory".to_string())],
            },
            ChatMessage {
                role: Role::Model,
                parts: vec![
                    Part::Reasoning {
                        text: "Thinking about which tool to call...".to_string(),
                        opaque: serde_json::json!({ "thoughtSignature": "sig123" }),
                    },
                    Part::FunctionCall {
                        id: "call_ls_1".to_string(),
                        name: "list_dir".to_string(),
                        args: serde_json::json!({ "path": "." }),
                    },
                ],
            },
            ChatMessage {
                role: Role::Tool,
                parts: vec![Part::FunctionResponse {
                    id: "call_ls_1".to_string(),
                    name: "list_dir".to_string(),
                    response: serde_json::json!({ "files": ["Cargo.toml", "src/"] }),
                    images: vec![],
                }],
            },
        ],
        tools: vec![],
        options: Default::default(),
    };

    assert_eq!(turn.messages.len(), 3);
    let body = aphrody_model_client::build_request_body(&turn);
    assert!(body.get("contents").is_some());
    assert!(body.get("systemInstruction").is_some());
}

#[test]
fn test_sdk_geo_restricted_detection() {
    let err = SdkError::OAuthServer {
        status: 400,
        body: "{\"error\":{\"code\":400,\"message\":\"User location is not \
               supported\",\"status\":\"FAILED_PRECONDITION\"}}"
            .to_string(),
    };
    assert!(err.is_geo_restricted());
}
