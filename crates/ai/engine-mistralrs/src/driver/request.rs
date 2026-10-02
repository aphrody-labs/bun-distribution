// SPDX-License-Identifier: Apache-2.0
//! A planned turn as a mistral.rs request.
//!
//! `plan::plan_turn` has already decided what the turn means; [`build_request`] only translates
//! each decision into the matching `RequestBuilder` call, and decodes the images, the one step
//! that can still fail. The tests inspect the finished builder through `RequestLike`, so they run
//! without a model.

use std::collections::HashMap;

use aphrody_model_client::{ImageSource, ModelError};
use base64::Engine as _;
use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD};
use image::DynamicImage;
use mistralrs::core::NamedFunctionToolChoice;
use mistralrs::{
    CalledFunction, Constraint, Function, ReasoningEffort, RequestBuilder, SamplingParams,
    StopTokens, TextMessageRole, Tool, ToolCallResponse, ToolCallType, ToolChoice, ToolType,
};
use url::Url;

use crate::plan::{
    Effort, PlanError, PlannedMessage, PlannedSampling, PlannedTool, PlannedToolCall,
    PlannedToolChoice, PlannedTurn,
};

/// Build the request for `plan`.
///
/// A turn with images is built on a blocking thread: decoding a screenshot is CPU work that
/// should not sit on a runtime worker.
pub(crate) async fn build(plan: PlannedTurn) -> Result<RequestBuilder, ModelError> {
    let built = if has_images(&plan) {
        match tokio::task::spawn_blocking(move || build_request(plan)).await {
            Ok(built) => built,
            Err(error) => {
                let message = format!("image decoding did not finish: {error}");
                return Err(ModelError::Api { status: 500, message });
            },
        }
    } else {
        build_request(plan)
    };
    built.map_err(bad_request)
}

/// A turn the engine cannot run is the caller's mistake: `400`.
pub(crate) fn bad_request(error: PlanError) -> ModelError {
    ModelError::Api { status: 400, message: error.to_string() }
}

fn has_images(plan: &PlannedTurn) -> bool {
    plan.messages
        .iter()
        .any(|message| matches!(message, PlannedMessage::User { images, .. } if !images.is_empty()))
}

fn build_request(plan: PlannedTurn) -> Result<RequestBuilder, PlanError> {
    let PlannedTurn {
        messages,
        tools,
        tool_choice,
        sampling,
        json_schema,
        effort,
        enable_thinking,
        truncate_prompt,
    } = plan;

    let mut request = RequestBuilder::new();
    for message in messages {
        request = add_message(request, message)?;
    }
    // mistral.rs ignores the choice when no tool is declared; the planner already agrees.
    if !tools.is_empty() {
        request = request
            .set_tools(tools.into_iter().map(map_tool).collect())
            .set_tool_choice(map_tool_choice(tool_choice));
    }
    request = request.set_sampling(map_sampling(sampling));
    if let Some(schema) = json_schema {
        request = request.set_constraint(Constraint::JsonSchema(schema));
    }
    if let Some(effort) = effort {
        request = request.with_reasoning_effort(map_effort(effort));
    }
    if let Some(enabled) = enable_thinking {
        request = request.enable_thinking(enabled);
    }
    Ok(request.with_truncate_sequence(truncate_prompt))
}

fn add_message(
    request: RequestBuilder,
    message: PlannedMessage,
) -> Result<RequestBuilder, PlanError> {
    Ok(match message {
        PlannedMessage::System { text } => request.add_message(TextMessageRole::System, text),
        PlannedMessage::User { text, images } if images.is_empty() => {
            request.add_message(TextMessageRole::User, text)
        },
        PlannedMessage::User { text, images } => {
            request.add_image_message(TextMessageRole::User, text, decode_images(&images)?)
        },
        PlannedMessage::Assistant { text, tool_calls } if tool_calls.is_empty() => {
            request.add_message(TextMessageRole::Assistant, text)
        },
        PlannedMessage::Assistant { text, tool_calls } => {
            let calls = tool_calls
                .into_iter()
                .enumerate()
                .map(|(index, call)| map_tool_call(index, call))
                .collect();
            request.add_message_with_tool_call(TextMessageRole::Assistant, text, calls)
        },
        PlannedMessage::Tool { call_id, content } => request.add_tool_message(content, call_id),
    })
}

fn map_tool_call(index: usize, call: PlannedToolCall) -> ToolCallResponse {
    ToolCallResponse {
        index,
        id: call.id,
        tp: ToolCallType::Function,
        function: CalledFunction { name: call.name, arguments: call.arguments },
    }
}

fn map_tool(tool: PlannedTool) -> Tool {
    // mistral.rs keeps the parameter schema as a plain map, not a `serde_json::Map`.
    let parameters = tool.parameters.map(|schema| schema.into_iter().collect::<HashMap<_, _>>());
    Tool {
        tp: ToolType::Function,
        function: Function {
            name: tool.name,
            description: tool.description,
            parameters,
            strict: None,
        },
    }
}

fn map_tool_choice(choice: PlannedToolChoice) -> ToolChoice {
    match choice {
        PlannedToolChoice::Auto => ToolChoice::Auto,
        PlannedToolChoice::None => ToolChoice::None,
        PlannedToolChoice::Required => ToolChoice::Required,
        PlannedToolChoice::Named(name) => {
            ToolChoice::NamedFunction(NamedFunctionToolChoice { tp: ToolType::Function, name })
        },
    }
}

fn map_effort(effort: Effort) -> ReasoningEffort {
    match effort {
        Effort::Off => ReasoningEffort::Off,
        Effort::Low => ReasoningEffort::Low,
        Effort::Medium => ReasoningEffort::Medium,
        Effort::High => ReasoningEffort::High,
        Effort::XHigh => ReasoningEffort::XHigh,
    }
}

/// The neutral sampler plus what the turn set. Not `SamplingParams::deterministic()`: that forces
/// `top_k = 1`, which would keep the model's own `generation_config.json` from filling the
/// fields the caller left unset.
fn map_sampling(sampling: PlannedSampling) -> SamplingParams {
    SamplingParams {
        temperature: sampling.temperature,
        top_k: sampling.top_k,
        top_p: sampling.top_p,
        min_p: sampling.min_p,
        frequency_penalty: sampling.frequency_penalty,
        presence_penalty: sampling.presence_penalty,
        repetition_penalty: sampling.repetition_penalty,
        max_len: sampling.max_tokens,
        stop_toks: (!sampling.stop.is_empty()).then_some(StopTokens::Seqs(sampling.stop)),
        ..SamplingParams::neutral()
    }
}

fn decode_images(images: &[ImageSource]) -> Result<Vec<DynamicImage>, PlanError> {
    images
        .iter()
        .enumerate()
        .map(|(index, source)| {
            decode_image(source)
                .map_err(|reason| PlanError(format!("image {}: {reason}", index + 1)))
        })
        .collect()
}

/// The pixels of an image the turn carries inline.
///
/// Inline base64 and `data:` URLs are decoded. A remote `http(s)` URL is refused with a message
/// that says so: the in-process engine has no HTTP client, and handing a vision model the URL as
/// text would make it describe an image it never saw. A `file:` URL is refused too, because a
/// gateway in front of this client must not turn an image URL into a local file read; the turn
/// loop already loads local files itself and sends them inline.
fn decode_image(source: &ImageSource) -> Result<DynamicImage, String> {
    let bytes = match source {
        ImageSource::Base64 { data, .. } => decode_base64(data)?,
        ImageSource::Url(raw) => url_bytes(raw)?,
    };
    image::load_from_memory(&bytes).map_err(|error| format!("not a decodable image: {error}"))
}

fn url_bytes(raw: &str) -> Result<Vec<u8>, String> {
    let url = Url::parse(raw.trim()).map_err(|error| format!("not a valid image URL: {error}"))?;
    match url.scheme() {
        "data" => {
            let (meta, payload) =
                url.path().split_once(',').ok_or("a data: URL needs a comma before its payload")?;
            if !meta.split(';').any(|part| part.eq_ignore_ascii_case("base64")) {
                return Err("only base64 data: URLs are supported".to_owned());
            }
            decode_base64(payload)
        },
        "http" | "https" => Err("remote image URLs are not fetched by the in-process engine; \
             send the image inline (base64 or a data: URL)"
            .to_owned()),
        "file" => Err("file: image URLs are not read by the in-process engine; \
             send the image inline (base64 or a data: URL)"
            .to_owned()),
        other => Err(format!("unsupported image URL scheme `{other}`; use base64 or a data: URL")),
    }
}

/// Standard base64, padded or not, with the line breaks MIME encoders add.
fn decode_base64(data: &str) -> Result<Vec<u8>, String> {
    let compact: String = data.chars().filter(|c| !c.is_ascii_whitespace()).collect();
    STANDARD
        .decode(&compact)
        .or_else(|_| STANDARD_NO_PAD.decode(&compact))
        .map_err(|error| format!("invalid base64: {error}"))
}

#[cfg(test)]
mod tests {
    use aphrody_model_client::{ChatMessage, ChatTurn, Part, Role, ToolDecl, TurnOptions};
    use mistralrs::RequestLike;
    use serde_json::{Value, json};

    use super::*;
    use crate::plan::plan_turn;

    fn user(text: &str) -> ChatMessage {
        ChatMessage { role: Role::User, parts: vec![Part::Text(text.to_owned())] }
    }

    fn turn(messages: Vec<ChatMessage>) -> ChatTurn {
        ChatTurn { messages, ..ChatTurn::default() }
    }

    fn request_for(turn: &ChatTurn) -> RequestBuilder {
        build_request(plan_turn(turn, true).expect("plans")).expect("builds")
    }

    /// `either` serializes `Either` as `{"Left": ..}`; unwrap the tag so the assertions read like
    /// the OpenAI wire.
    fn untag(value: Value) -> Value {
        match value {
            Value::Object(mut map)
                if map.len() == 1 && (map.contains_key("Left") || map.contains_key("Right")) =>
            {
                untag(map.remove("Left").or_else(|| map.remove("Right")).unwrap_or(Value::Null))
            },
            Value::Object(map) => {
                Value::Object(map.into_iter().map(|(key, value)| (key, untag(value))).collect())
            },
            Value::Array(items) => Value::Array(items.into_iter().map(untag).collect()),
            other => other,
        }
    }

    fn wire_messages(request: &mut RequestBuilder) -> Value {
        untag(serde_json::to_value(request.take_messages()).expect("serializable"))
    }

    fn tiny_png() -> Vec<u8> {
        let mut bytes = Vec::new();
        DynamicImage::new_rgb8(2, 2)
            .write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png)
            .expect("encode a png");
        bytes
    }

    /// A 2x2 PNG as the standard base64 a turn carries.
    fn png_base64() -> String {
        STANDARD.encode(tiny_png())
    }

    #[test]
    fn roles_tool_calls_and_tool_results_keep_their_order_and_pairing() {
        let history = ChatTurn {
            system: Some("be brief".into()),
            messages: vec![
                user("list files"),
                ChatMessage {
                    role: Role::Model,
                    parts: vec![
                        Part::Text("on it".into()),
                        Part::function_call("c1", "ls", json!({ "path": "." })),
                    ],
                },
                ChatMessage {
                    role: Role::Tool,
                    parts: vec![Part::function_response("c1", "ls", json!({ "files": ["a"] }))],
                },
            ],
            ..ChatTurn::default()
        };
        let mut request = request_for(&history);
        let wire = wire_messages(&mut request);
        assert_eq!(
            wire["Chat"]["messages"],
            json!([
                { "role": "system", "content": "be brief" },
                { "role": "user", "content": "list files" },
                {
                    "role": "assistant",
                    "content": "on it",
                    "tool_calls": [{
                        "id": "c1",
                        "type": "function",
                        "function": { "name": "ls", "arguments": r#"{"path":"."}"# }
                    }]
                },
                { "role": "tool", "content": r#"{"files":["a"]}"#, "tool_call_id": "c1" }
            ])
        );
    }

    #[test]
    fn an_image_turns_the_request_multimodal_and_keeps_the_pixels() {
        let with_image = turn(vec![ChatMessage {
            role: Role::User,
            parts: vec![
                Part::Text("what is this?".into()),
                Part::Image(ImageSource::base64("image/png", png_base64())),
            ],
        }]);
        let mut request = request_for(&with_image);
        assert_eq!(request.images_ref().len(), 1);
        assert_eq!((request.images_ref()[0].width(), request.images_ref()[0].height()), (2, 2));
        let wire = wire_messages(&mut request);
        assert_eq!(
            wire["MultimodalChat"]["messages"][0]["content"],
            json!([{ "type": "image" }, { "type": "text", "text": "what is this?" }])
        );
    }

    #[test]
    fn a_turn_without_images_stays_a_plain_chat() {
        let mut request = request_for(&turn(vec![user("hi")]));
        assert!(request.images_ref().is_empty());
        assert!(wire_messages(&mut request).get("Chat").is_some());
    }

    #[test]
    fn declared_tools_and_the_named_choice_reach_the_request() {
        let mut declared = turn(vec![user("go")]);
        declared.tools = vec![
            ToolDecl {
                name: "ls".into(),
                description: "List a directory".into(),
                parameters: json!({
                    "type": "object",
                    "properties": { "path": { "type": "string" } }
                }),
            },
            ToolDecl { name: "noop".into(), description: String::new(), parameters: json!({}) },
        ];
        declared.options.extra.insert(
            "tool_choice".into(),
            json!({ "type": "function", "function": { "name": "ls" } }),
        );
        let mut request = request_for(&declared);
        let (tools, choice) = request.take_tools().expect("tools were declared");
        assert_eq!(
            serde_json::to_value(&tools).unwrap(),
            json!([
                {
                    "type": "function",
                    "function": {
                        "name": "ls",
                        "description": "List a directory",
                        "parameters": {
                            "type": "object",
                            "properties": { "path": { "type": "string" } }
                        }
                    }
                },
                { "type": "function", "function": { "name": "noop" } }
            ])
        );
        assert_eq!(
            serde_json::to_value(&choice).unwrap(),
            json!({ "type": "function", "name": "ls" })
        );
    }

    #[test]
    fn the_tool_choice_words_map_one_to_one() {
        let word =
            |choice: PlannedToolChoice| serde_json::to_value(map_tool_choice(choice)).unwrap();
        assert_eq!(word(PlannedToolChoice::Auto), json!("auto"));
        assert_eq!(word(PlannedToolChoice::None), json!("none"));
        assert_eq!(word(PlannedToolChoice::Required), json!("required"));
    }

    #[test]
    fn no_tools_means_no_tool_section() {
        assert!(request_for(&turn(vec![user("hi")])).take_tools().is_none());
    }

    #[test]
    fn unset_sampling_stays_neutral_so_the_model_defaults_apply() {
        let mut request = request_for(&turn(vec![user("hi")]));
        let sampling = request.take_sampling_params();
        assert_eq!(sampling.top_k, None, "deterministic() would force top_k = 1");
        assert_eq!(sampling.temperature, None);
        assert_eq!(sampling.max_len, None);
        assert!(sampling.stop_toks.is_none());
        assert_eq!(sampling.n_choices, 1);
    }

    #[test]
    fn typed_options_and_extras_reach_the_sampler() {
        let mut sampled = turn(vec![user("hi")]);
        sampled.options = TurnOptions {
            temperature: Some(0.7),
            max_output_tokens: Some(256),
            stop: vec!["</s>".into()],
            ..TurnOptions::default()
        };
        for (key, value) in [
            ("top_p", json!(0.9)),
            ("top_k", json!(40)),
            ("min_p", json!(0.05)),
            ("frequency_penalty", json!(0.5)),
            ("presence_penalty", json!(0.25)),
            ("repetition_penalty", json!(1.5)),
        ] {
            sampled.options.extra.insert(key.into(), value);
        }
        let sampling = request_for(&sampled).take_sampling_params();
        assert_eq!(sampling.temperature, Some(0.7));
        assert_eq!(
            (sampling.top_p, sampling.top_k, sampling.min_p),
            (Some(0.9), Some(40), Some(0.05))
        );
        assert_eq!(
            (sampling.frequency_penalty, sampling.presence_penalty, sampling.repetition_penalty),
            (Some(0.5), Some(0.25), Some(1.5))
        );
        assert_eq!(sampling.max_len, Some(256));
        assert!(matches!(&sampling.stop_toks, Some(StopTokens::Seqs(seqs)) if seqs == &["</s>"]));
    }

    #[test]
    fn a_json_schema_becomes_a_constraint() {
        let mut constrained = turn(vec![user("hi")]);
        constrained.options.response_schema = Some(json!({ "type": "object" }));
        let constraint = request_for(&constrained).take_constraint();
        assert_eq!(
            serde_json::to_value(&constraint).unwrap(),
            json!({ "JsonSchema": { "type": "object" } })
        );
        let free = request_for(&turn(vec![user("hi")])).take_constraint();
        assert!(matches!(free, Constraint::None));
    }

    #[test]
    fn reasoning_effort_thinking_and_truncation_are_forwarded() {
        let mut reasoning = turn(vec![user("hi")]);
        reasoning.options.reasoning_effort = Some("high".into());
        reasoning.options.extra.insert("enable_thinking".into(), json!(true));
        reasoning.options.extra.insert("truncate_sequence".into(), json!(true));
        let mut request = request_for(&reasoning);
        assert!(request.truncate_sequence());
        let wire = wire_messages(&mut request);
        assert_eq!(wire["Chat"]["reasoning_effort"], json!("high"));
        assert_eq!(wire["Chat"]["enable_thinking"], json!(true));

        let mut plain = request_for(&turn(vec![user("hi")]));
        assert!(!plain.truncate_sequence());
        let wire = wire_messages(&mut plain);
        assert_eq!(wire["Chat"]["reasoning_effort"], Value::Null);
        assert_eq!(wire["Chat"]["enable_thinking"], Value::Null);
    }

    #[test]
    fn efforts_map_one_to_one() {
        for (effort, expected) in [
            (Effort::Off, ReasoningEffort::Off),
            (Effort::Low, ReasoningEffort::Low),
            (Effort::Medium, ReasoningEffort::Medium),
            (Effort::High, ReasoningEffort::High),
            (Effort::XHigh, ReasoningEffort::XHigh),
        ] {
            assert_eq!(map_effort(effort), expected);
        }
    }

    #[test]
    fn inline_images_decode_with_or_without_padding_and_line_breaks() {
        let encoded = png_base64();
        let source = |data: String| ImageSource::Base64 { mime: "image/png".into(), data };
        assert_eq!(decode_image(&source(encoded.clone())).unwrap().width(), 2);

        let unpadded = encoded.trim_end_matches('=').to_owned();
        assert_eq!(decode_image(&source(unpadded)).unwrap().height(), 2);

        let (head, tail) = encoded.split_at(8);
        let wrapped = format!("{head}\r\n{tail}\n");
        assert_eq!(decode_image(&source(wrapped)).unwrap().width(), 2);
    }

    #[test]
    fn data_urls_decode_and_other_urls_are_refused_with_a_reason() {
        let data = ImageSource::Url(format!("data:image/png;base64,{}", png_base64()));
        assert_eq!(decode_image(&data).unwrap().width(), 2);

        let refused = |raw: &str| decode_image(&ImageSource::Url(raw.to_owned())).unwrap_err();
        assert!(refused("https://example.test/a.png").contains("not fetched"));
        assert!(refused("http://example.test/a.png").contains("not fetched"));
        assert!(refused("file:///etc/passwd").contains("not read"));
        assert!(refused("ftp://example.test/a.png").contains("unsupported"));
        assert!(refused("data:image/png,AAAA").contains("base64"));
        assert!(refused("data:image/png;base64").contains("comma"));
        assert!(refused("not a url").contains("not a valid image URL"));
    }

    #[test]
    fn bytes_that_are_not_an_image_are_a_clear_error() {
        let junk = ImageSource::base64("image/png", STANDARD.encode(b"hello"));
        assert!(decode_image(&junk).unwrap_err().contains("not a decodable image"));
        let broken = ImageSource::base64("image/png", "!!!!");
        assert!(decode_image(&broken).unwrap_err().contains("invalid base64"));
    }

    #[test]
    fn a_bad_image_fails_the_turn_with_its_position() {
        let two = turn(vec![ChatMessage {
            role: Role::User,
            parts: vec![
                Part::Image(ImageSource::base64("image/png", png_base64())),
                Part::Image(ImageSource::Url("https://example.test/a.png".into())),
            ],
        }]);
        let planned = plan_turn(&two, true).unwrap();
        let error = build_request(planned).err().expect("the second image fails");
        assert!(error.0.starts_with("image 2:"), "{}", error.0);
        assert!(matches!(bad_request(error), ModelError::Api { status: 400, .. }));
    }
}
