// SPDX-License-Identifier: Apache-2.0
//! Pure translation of a neutral [`ChatTurn`] into what the engine needs.
//!
//! The `engine` feature maps a [`PlannedTurn`] onto mistral.rs' `RequestBuilder`
//! one-to-one; everything that can be decided without mistral.rs, the message
//! flattening, the tool-call pairing, the option mapping and the validation, is
//! decided here. That keeps the interesting logic testable on every build,
//! including the default one that links no engine.
//!
//! Recognised keys of [`TurnOptions::extra`], on top of the typed options:
//!
//! | key | meaning |
//! |---|---|
//! | `top_p`, `min_p` | nucleus and min-p sampling |
//! | `top_k` | top-k sampling (a negative value is ignored, as vLLM's `-1`) |
//! | `frequency_penalty`, `presence_penalty`, `repetition_penalty` | penalties |
//! | `tool_choice` | `"auto"`, `"none"`, `"required"` or `{"type":"function","function":{"name":..}}` |
//! | `response_format` | `{"type":"json_object"}` or `{"type":"json_schema","json_schema":{"schema":..}}` |
//! | `enable_thinking`, `chat_template_kwargs.enable_thinking` | thinking toggle |
//! | `truncate_sequence` | truncate a prompt longer than the context instead of failing |
//!
//! Anything else in `extra` is not meaningful to an in-process engine and is
//! ignored (a remote server would receive it verbatim).

use aphrody_model_client::{ChatMessage, ChatTurn, ImageSource, Part, Role, ToolDecl, TurnOptions};
use serde_json::{Map, Value, json};

/// One message of the flattened history.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum PlannedMessage {
    /// The system instruction.
    System { text: String },
    /// A user turn, with the images that belong to it.
    User { text: String, images: Vec<ImageSource> },
    /// A model turn, with the tool calls it made.
    Assistant { text: String, tool_calls: Vec<PlannedToolCall> },
    /// The result of one tool call.
    Tool { call_id: String, content: String },
}

/// A tool call recorded in the history.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlannedToolCall {
    pub id: String,
    pub name: String,
    /// The arguments as JSON text, the form chat templates render.
    pub arguments: String,
}

/// A declared tool.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PlannedTool {
    pub name: String,
    pub description: Option<String>,
    /// The JSON Schema object of the parameters, when there is one.
    pub parameters: Option<Map<String, Value>>,
}

/// How the model may use the declared tools.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PlannedToolChoice {
    Auto,
    None,
    Required,
    Named(String),
}

/// Reasoning effort, in the vocabulary mistral.rs shares with chat templates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Effort {
    Off,
    Low,
    Medium,
    High,
    XHigh,
}

/// Decoding parameters. `None` leaves the choice to the model's own
/// `generation_config.json`, which mistral.rs applies to unset fields.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct PlannedSampling {
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub top_k: Option<usize>,
    pub min_p: Option<f64>,
    pub frequency_penalty: Option<f32>,
    pub presence_penalty: Option<f32>,
    pub repetition_penalty: Option<f32>,
    pub max_tokens: Option<usize>,
    pub stop: Vec<String>,
}

/// Everything the engine needs to run one turn.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PlannedTurn {
    pub messages: Vec<PlannedMessage>,
    pub tools: Vec<PlannedTool>,
    pub tool_choice: PlannedToolChoice,
    pub sampling: PlannedSampling,
    pub json_schema: Option<Value>,
    pub effort: Option<Effort>,
    pub enable_thinking: Option<bool>,
    pub truncate_prompt: bool,
}

/// A turn the engine cannot run, reported to the caller as a `400`.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub(crate) struct PlanError(pub String);

/// Flatten `turn` for the engine.
///
/// `images_supported` is whether the loaded model has a vision pipeline; a turn
/// that carries images for a text-only model is refused here, with a clear
/// message, instead of failing inside the chat template.
pub(crate) fn plan_turn(turn: &ChatTurn, images_supported: bool) -> Result<PlannedTurn, PlanError> {
    let mut messages = Vec::with_capacity(turn.messages.len() + 1);
    if let Some(system) = turn.system.as_deref().filter(|text| !text.trim().is_empty()) {
        messages.push(PlannedMessage::System { text: system.to_owned() });
    }
    for message in &turn.messages {
        push_message(&mut messages, message);
    }
    if !messages.iter().any(|message| !matches!(message, PlannedMessage::System { .. })) {
        return Err(PlanError("a turn needs at least one non-system message".into()));
    }
    let has_images = messages.iter().any(
        |message| matches!(message, PlannedMessage::User { images, .. } if !images.is_empty()),
    );
    if has_images && !images_supported {
        return Err(PlanError(
            "this model does not accept images: it was not loaded through a vision pipeline".into(),
        ));
    }

    let tools: Vec<PlannedTool> = turn.tools.iter().map(plan_tool).collect();
    let options = &turn.options;
    Ok(PlannedTurn {
        messages,
        tool_choice: if tools.is_empty() {
            PlannedToolChoice::Auto
        } else {
            plan_tool_choice(options.extra.get("tool_choice"))?
        },
        tools,
        sampling: plan_sampling(options),
        json_schema: plan_json_schema(options),
        effort: options.reasoning_effort.as_deref().map(parse_effort).transpose()?,
        enable_thinking: plan_enable_thinking(options),
        truncate_prompt: options
            .extra
            .get("truncate_sequence")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

/// The id to pair a call with its result: the provider id, or the function name
/// for a history recorded before ids were tracked.
fn wire_call_id<'a>(id: &'a str, name: &'a str) -> &'a str {
    if id.is_empty() { name } else { id }
}

/// A tool response as the text of a `tool` message.
fn tool_response_content(response: &Value) -> String {
    match response {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// A tool call's arguments as JSON text. A value that was kept as a string
/// because it did not parse is sent back as the text it was.
fn arguments_text(args: &Value) -> String {
    match args {
        Value::Null => "{}".to_owned(),
        Value::String(raw) => raw.clone(),
        other => other.to_string(),
    }
}

fn push_message(out: &mut Vec<PlannedMessage>, message: &ChatMessage) {
    match message.role {
        Role::User => {
            let mut texts: Vec<&str> = Vec::new();
            let mut images: Vec<ImageSource> = Vec::new();
            let mut results: Vec<&Part> = Vec::new();
            for part in &message.parts {
                match part {
                    Part::Text(text) => texts.push(text),
                    Part::Image(image) => images.push(image.clone()),
                    // A tool result filed under a user message (Gemini-style
                    // history) still has to reach the engine as a tool message.
                    Part::FunctionResponse { .. } => results.push(part),
                    _ => {},
                }
            }
            push_tool_results(out, &results);
            if !texts.is_empty() || !images.is_empty() {
                out.push(PlannedMessage::User { text: texts.join("\n"), images });
            }
        },
        Role::Model => {
            let mut texts: Vec<&str> = Vec::new();
            let mut tool_calls: Vec<PlannedToolCall> = Vec::new();
            for part in &message.parts {
                match part {
                    Part::Text(text) => texts.push(text),
                    Part::FunctionCall { id, name, args } => tool_calls.push(PlannedToolCall {
                        id: wire_call_id(id, name).to_owned(),
                        name: name.clone(),
                        arguments: arguments_text(args),
                    }),
                    // Reasoning is not replayed: chat templates drop it.
                    _ => {},
                }
            }
            if !texts.is_empty() || !tool_calls.is_empty() {
                out.push(PlannedMessage::Assistant { text: texts.join("\n"), tool_calls });
            }
        },
        Role::Tool => {
            let results: Vec<&Part> = message
                .parts
                .iter()
                .filter(|part| matches!(part, Part::FunctionResponse { .. }))
                .collect();
            push_tool_results(out, &results);
        },
    }
}

/// One `tool` message per response; the images the tools produced follow in a
/// user message that names their origin, because a `tool` message has no image
/// slot.
fn push_tool_results(out: &mut Vec<PlannedMessage>, results: &[&Part]) {
    let mut images: Vec<ImageSource> = Vec::new();
    let mut origins: Vec<&str> = Vec::new();
    for part in results {
        if let Part::FunctionResponse { id, name, response, images: produced } = part {
            out.push(PlannedMessage::Tool {
                call_id: wire_call_id(id, name).to_owned(),
                content: tool_response_content(response),
            });
            if !produced.is_empty() {
                origins.push(name);
                images.extend(produced.iter().cloned());
            }
        }
    }
    if !images.is_empty() {
        origins.dedup();
        out.push(PlannedMessage::User {
            text: format!("Image output of tool call(s): {}", origins.join(", ")),
            images,
        });
    }
}

fn plan_tool(tool: &ToolDecl) -> PlannedTool {
    PlannedTool {
        name: tool.name.clone(),
        description: Some(tool.description.clone()).filter(|text| !text.trim().is_empty()),
        parameters: match &tool.parameters {
            Value::Object(map) if !map.is_empty() => Some(map.clone()),
            _ => None,
        },
    }
}

fn plan_tool_choice(choice: Option<&Value>) -> Result<PlannedToolChoice, PlanError> {
    let Some(choice) = choice else {
        return Ok(PlannedToolChoice::Auto);
    };
    let unsupported = || PlanError(format!("unsupported tool_choice: {choice}"));
    match choice {
        Value::Null => Ok(PlannedToolChoice::Auto),
        Value::String(word) => match word.as_str() {
            "auto" => Ok(PlannedToolChoice::Auto),
            "none" => Ok(PlannedToolChoice::None),
            "required" | "any" => Ok(PlannedToolChoice::Required),
            _ => Err(unsupported()),
        },
        Value::Object(object) => object
            .get("function")
            .and_then(|function| function.get("name"))
            .or_else(|| object.get("name"))
            .and_then(Value::as_str)
            .map(|name| PlannedToolChoice::Named(name.to_owned()))
            .ok_or_else(unsupported),
        _ => Err(unsupported()),
    }
}

/// `f32` to `f64` without the binary noise: `0.7f32` becomes `0.7`, not
/// `0.699999988…`.
fn widen(value: f32) -> f64 {
    value.to_string().parse().unwrap_or_else(|_| f64::from(value))
}

fn extra_f64(options: &TurnOptions, key: &str) -> Option<f64> {
    options.extra.get(key).and_then(Value::as_f64)
}

fn extra_f32(options: &TurnOptions, key: &str) -> Option<f32> {
    // Narrowing an arbitrary JSON number is the point of this helper.
    extra_f64(options, key).map(|value| value as f32)
}

fn plan_sampling(options: &TurnOptions) -> PlannedSampling {
    PlannedSampling {
        temperature: options.temperature.map(widen),
        top_p: extra_f64(options, "top_p"),
        top_k: options
            .extra
            .get("top_k")
            .and_then(Value::as_u64)
            .and_then(|k| usize::try_from(k).ok())
            .filter(|k| *k > 0),
        min_p: extra_f64(options, "min_p"),
        frequency_penalty: extra_f32(options, "frequency_penalty"),
        presence_penalty: extra_f32(options, "presence_penalty"),
        repetition_penalty: extra_f32(options, "repetition_penalty"),
        max_tokens: options.max_output_tokens.map(|n| usize::try_from(n).unwrap_or(usize::MAX)),
        stop: options.stop.iter().filter(|seq| !seq.is_empty()).cloned().collect(),
    }
}

/// The JSON Schema that constrains the answer: the typed option first, then an
/// OpenAI-style `response_format` carried in `extra`.
fn plan_json_schema(options: &TurnOptions) -> Option<Value> {
    if let Some(schema) = &options.response_schema {
        return Some(schema.clone());
    }
    let format = options.extra.get("response_format")?;
    match format.get("type").and_then(Value::as_str)? {
        "json_object" => Some(json!({ "type": "object" })),
        "json_schema" => format.get("json_schema")?.get("schema").cloned(),
        _ => None,
    }
}

fn plan_enable_thinking(options: &TurnOptions) -> Option<bool> {
    options
        .extra
        .get("enable_thinking")
        .or_else(|| {
            options
                .extra
                .get("chat_template_kwargs")
                .and_then(|kwargs| kwargs.get("enable_thinking"))
        })
        .and_then(Value::as_bool)
}

fn parse_effort(raw: &str) -> Result<Effort, PlanError> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "off" | "none" => Ok(Effort::Off),
        // mistral.rs has no `minimal`; `low` is the closest level.
        "minimal" | "low" => Ok(Effort::Low),
        "medium" => Ok(Effort::Medium),
        "high" => Ok(Effort::High),
        "xhigh" | "max" => Ok(Effort::XHigh),
        _ => Err(PlanError(format!(
            "unsupported reasoning effort `{raw}` (expected off, minimal, low, medium, high, xhigh)"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(text: &str) -> ChatMessage {
        ChatMessage { role: Role::User, parts: vec![Part::Text(text.to_owned())] }
    }

    fn turn(messages: Vec<ChatMessage>) -> ChatTurn {
        ChatTurn { messages, ..ChatTurn::default() }
    }

    fn with_extra(key: &str, value: Value) -> TurnOptions {
        let mut options = TurnOptions::default();
        options.extra.insert(key.to_owned(), value);
        options
    }

    #[test]
    fn system_then_user_flatten_in_order() {
        let mut t = turn(vec![user("hello")]);
        t.system = Some("be brief".into());
        let plan = plan_turn(&t, false).unwrap();
        assert_eq!(
            plan.messages,
            vec![
                PlannedMessage::System { text: "be brief".into() },
                PlannedMessage::User { text: "hello".into(), images: vec![] },
            ]
        );
        assert_eq!(plan.tool_choice, PlannedToolChoice::Auto);
        assert!(plan.tools.is_empty());
    }

    #[test]
    fn a_blank_system_is_dropped_and_an_empty_turn_is_refused() {
        let mut t = turn(vec![]);
        t.system = Some("   ".into());
        assert!(plan_turn(&t, false).unwrap_err().0.contains("at least one"));

        let mut only_system = turn(vec![]);
        only_system.system = Some("rules".into());
        assert!(plan_turn(&only_system, false).is_err());
    }

    #[test]
    fn tool_calls_pair_with_their_results_through_the_call_id() {
        let t = turn(vec![
            user("list files"),
            ChatMessage {
                role: Role::Model,
                parts: vec![
                    Part::Text("on it".into()),
                    Part::function_call("c1", "ls", json!({ "path": "." })),
                    Part::function_call("c2", "ls", json!({ "path": "src" })),
                    Part::Reasoning { text: "t".into(), opaque: json!({}) },
                ],
            },
            ChatMessage {
                role: Role::Tool,
                parts: vec![
                    Part::function_response("c1", "ls", json!({ "files": ["a"] })),
                    Part::function_response("c2", "ls", json!("plain text")),
                ],
            },
        ]);
        let plan = plan_turn(&t, false).unwrap();
        assert_eq!(plan.messages.len(), 4);
        assert_eq!(
            plan.messages[1],
            PlannedMessage::Assistant {
                text: "on it".into(),
                tool_calls: vec![
                    PlannedToolCall {
                        id: "c1".into(),
                        name: "ls".into(),
                        arguments: r#"{"path":"."}"#.into()
                    },
                    PlannedToolCall {
                        id: "c2".into(),
                        name: "ls".into(),
                        arguments: r#"{"path":"src"}"#.into()
                    },
                ],
            }
        );
        assert_eq!(
            plan.messages[2],
            PlannedMessage::Tool { call_id: "c1".into(), content: r#"{"files":["a"]}"#.into() }
        );
        assert_eq!(
            plan.messages[3],
            PlannedMessage::Tool { call_id: "c2".into(), content: "plain text".into() }
        );
    }

    #[test]
    fn a_legacy_history_without_call_ids_falls_back_to_the_function_name() {
        let t = turn(vec![
            user("go"),
            ChatMessage {
                role: Role::Model,
                parts: vec![Part::function_call("", "ls", Value::Null)],
            },
            ChatMessage {
                role: Role::Tool,
                parts: vec![Part::function_response("", "ls", json!({ "ok": true }))],
            },
        ]);
        let plan = plan_turn(&t, false).unwrap();
        let PlannedMessage::Assistant { tool_calls, .. } = &plan.messages[1] else {
            panic!("expected an assistant message");
        };
        assert_eq!(tool_calls[0].id, "ls");
        assert_eq!(tool_calls[0].arguments, "{}");
        assert_eq!(
            plan.messages[2],
            PlannedMessage::Tool { call_id: "ls".into(), content: r#"{"ok":true}"#.into() }
        );
    }

    #[test]
    fn a_tool_result_filed_under_a_user_message_still_becomes_a_tool_message() {
        let t = turn(vec![ChatMessage {
            role: Role::User,
            parts: vec![
                Part::function_response("c1", "ls", json!("ok")),
                Part::Text("thanks".into()),
            ],
        }]);
        let plan = plan_turn(&t, false).unwrap();
        assert_eq!(
            plan.messages,
            vec![
                PlannedMessage::Tool { call_id: "c1".into(), content: "ok".into() },
                PlannedMessage::User { text: "thanks".into(), images: vec![] },
            ]
        );
    }

    #[test]
    fn images_need_a_vision_model_and_tool_images_follow_their_result() {
        let image = ImageSource::base64("image/png", "AAAA");
        let with_image = turn(vec![ChatMessage {
            role: Role::User,
            parts: vec![Part::Text("what is this?".into()), Part::Image(image.clone())],
        }]);
        let refused = plan_turn(&with_image, false).unwrap_err();
        assert!(refused.0.contains("does not accept images"), "{}", refused.0);
        let plan = plan_turn(&with_image, true).unwrap();
        assert_eq!(
            plan.messages,
            vec![PlannedMessage::User {
                text: "what is this?".into(),
                images: vec![image.clone()]
            }]
        );

        let tool_image = turn(vec![
            user("shoot"),
            ChatMessage {
                role: Role::Tool,
                parts: vec![Part::FunctionResponse {
                    id: "c1".into(),
                    name: "screenshot".into(),
                    response: json!("done"),
                    images: vec![image.clone()],
                }],
            },
        ]);
        let plan = plan_turn(&tool_image, true).unwrap();
        assert_eq!(
            plan.messages[2],
            PlannedMessage::User {
                text: "Image output of tool call(s): screenshot".into(),
                images: vec![image],
            }
        );
    }

    #[test]
    fn tool_declarations_keep_their_schema() {
        let mut t = turn(vec![user("hi")]);
        t.tools = vec![
            ToolDecl {
                name: "ls".into(),
                description: "List a directory".into(),
                parameters: json!({ "type": "object", "properties": { "path": { "type": "string" } } }),
            },
            ToolDecl { name: "noop".into(), description: " ".into(), parameters: json!({}) },
        ];
        let plan = plan_turn(&t, false).unwrap();
        assert_eq!(plan.tools[0].description.as_deref(), Some("List a directory"));
        assert_eq!(plan.tools[0].parameters.as_ref().unwrap()["type"], "object");
        assert_eq!(plan.tools[1].description, None);
        assert_eq!(plan.tools[1].parameters, None);
    }

    #[test]
    fn tool_choice_accepts_the_openai_spellings() {
        let choice = |value: Value| plan_tool_choice(Some(&value));
        assert_eq!(choice(json!("auto")).unwrap(), PlannedToolChoice::Auto);
        assert_eq!(choice(json!("none")).unwrap(), PlannedToolChoice::None);
        assert_eq!(choice(json!("required")).unwrap(), PlannedToolChoice::Required);
        assert_eq!(
            choice(json!({ "type": "function", "function": { "name": "ls" } })).unwrap(),
            PlannedToolChoice::Named("ls".into())
        );
        assert_eq!(
            choice(json!({ "type": "function", "name": "ls" })).unwrap(),
            PlannedToolChoice::Named("ls".into())
        );
        assert!(choice(json!("sometimes")).is_err());
        assert!(choice(json!(3)).is_err());
        assert_eq!(plan_tool_choice(None).unwrap(), PlannedToolChoice::Auto);
    }

    #[test]
    fn tool_choice_only_counts_when_tools_are_declared() {
        let mut t = turn(vec![user("hi")]);
        t.options = with_extra("tool_choice", json!("sometimes"));
        // No tools declared: the bad choice is irrelevant.
        assert!(plan_turn(&t, false).is_ok());
        t.tools =
            vec![ToolDecl { name: "x".into(), description: String::new(), parameters: json!({}) }];
        assert!(plan_turn(&t, false).is_err());
    }

    #[test]
    fn typed_options_and_extras_map_onto_sampling() {
        let mut t = turn(vec![user("hi")]);
        t.options = TurnOptions {
            temperature: Some(0.7),
            max_output_tokens: Some(256),
            stop: vec!["</s>".into(), String::new()],
            ..TurnOptions::default()
        };
        for (key, value) in [
            ("top_p", json!(0.9)),
            ("top_k", json!(40)),
            ("min_p", json!(0.05)),
            ("frequency_penalty", json!(0.5)),
            ("presence_penalty", json!(0.25)),
            ("repetition_penalty", json!(1.5)),
            ("unrelated", json!("ignored")),
        ] {
            t.options.extra.insert(key.into(), value);
        }
        let s = plan_turn(&t, false).unwrap().sampling;
        assert_eq!(s.temperature, Some(0.7));
        assert_eq!(s.max_tokens, Some(256));
        assert_eq!(s.stop, vec!["</s>".to_owned()]);
        assert_eq!(s.top_p, Some(0.9));
        assert_eq!(s.top_k, Some(40));
        assert_eq!(s.min_p, Some(0.05));
        assert_eq!(s.frequency_penalty, Some(0.5));
        assert_eq!(s.presence_penalty, Some(0.25));
        assert_eq!(s.repetition_penalty, Some(1.5));
    }

    #[test]
    fn a_negative_top_k_means_disabled() {
        let mut t = turn(vec![user("hi")]);
        t.options = with_extra("top_k", json!(-1));
        assert_eq!(plan_turn(&t, false).unwrap().sampling.top_k, None);
        t.options = with_extra("top_k", json!(0));
        assert_eq!(plan_turn(&t, false).unwrap().sampling.top_k, None);
    }

    #[test]
    fn unset_options_stay_unset_so_the_model_defaults_apply() {
        let plan = plan_turn(&turn(vec![user("hi")]), false).unwrap();
        assert_eq!(plan.sampling, PlannedSampling::default());
        assert_eq!(plan.json_schema, None);
        assert_eq!(plan.effort, None);
        assert_eq!(plan.enable_thinking, None);
        assert!(!plan.truncate_prompt);
    }

    #[test]
    fn json_schema_comes_from_the_typed_option_or_response_format() {
        let mut t = turn(vec![user("hi")]);
        t.options.response_schema = Some(json!({ "type": "object", "required": ["a"] }));
        assert_eq!(plan_turn(&t, false).unwrap().json_schema.unwrap()["required"][0], "a");

        t.options = with_extra("response_format", json!({ "type": "json_object" }));
        assert_eq!(plan_turn(&t, false).unwrap().json_schema, Some(json!({ "type": "object" })));

        t.options = with_extra(
            "response_format",
            json!({ "type": "json_schema", "json_schema": { "name": "r", "schema": { "type": "array" } } }),
        );
        assert_eq!(plan_turn(&t, false).unwrap().json_schema, Some(json!({ "type": "array" })));

        t.options = with_extra("response_format", json!({ "type": "text" }));
        assert_eq!(plan_turn(&t, false).unwrap().json_schema, None);
    }

    #[test]
    fn reasoning_effort_and_thinking_toggles() {
        let mut t = turn(vec![user("hi")]);
        for (raw, want) in [
            ("minimal", Effort::Low),
            ("LOW", Effort::Low),
            ("medium", Effort::Medium),
            ("high", Effort::High),
            ("max", Effort::XHigh),
            ("none", Effort::Off),
        ] {
            t.options.reasoning_effort = Some(raw.to_owned());
            assert_eq!(plan_turn(&t, false).unwrap().effort, Some(want), "{raw}");
        }
        t.options.reasoning_effort = Some("ludicrous".into());
        assert!(plan_turn(&t, false).unwrap_err().0.contains("ludicrous"));

        t.options = with_extra("enable_thinking", json!(false));
        assert_eq!(plan_turn(&t, false).unwrap().enable_thinking, Some(false));
        t.options = with_extra("chat_template_kwargs", json!({ "enable_thinking": true }));
        assert_eq!(plan_turn(&t, false).unwrap().enable_thinking, Some(true));
    }

    #[test]
    fn truncate_sequence_is_honoured() {
        let mut t = turn(vec![user("hi")]);
        t.options = with_extra("truncate_sequence", json!(true));
        assert!(plan_turn(&t, false).unwrap().truncate_prompt);
    }

    #[test]
    fn widen_keeps_the_decimal_the_caller_wrote() {
        assert_eq!(widen(0.7), 0.7);
        assert_eq!(widen(1.0), 1.0);
        assert_eq!(widen(0.0), 0.0);
    }
}
