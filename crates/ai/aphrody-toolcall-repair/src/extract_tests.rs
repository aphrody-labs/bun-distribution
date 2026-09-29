// SPDX-License-Identifier: Apache-2.0
use pretty_assertions::assert_eq;
use serde_json::json;

use super::*;

#[test]
fn hermes_single_call() {
    let text = r#"Sure, I'll do that.
<tool_call>
{"name": "read_file", "arguments": {"path": "src/lib.rs"}}
</tool_call>"#;
    let calls = extract_inline_tool_calls(text, ToolDialect::Hermes);
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].name, "read_file");
    assert_eq!(calls[0].arguments, json!({"path": "src/lib.rs"}));
    assert_eq!(
        &text[calls[0].span.clone()],
        "<tool_call>\n{\"name\": \"read_file\", \"arguments\": {\"path\": \
         \"src/lib.rs\"}}\n</tool_call>"
    );
}

#[test]
fn hermes_two_calls_in_one_message() {
    let text = "<tool_call>{\"name\": \"a\", \"arguments\": {}}</tool_call> then \
                <tool_call>{\"name\": \"b\", \"arguments\": {\"x\": 1}}</tool_call>";
    let calls = extract_inline_tool_calls(text, ToolDialect::Hermes);
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].name, "a");
    assert_eq!(calls[1].name, "b");
    assert_eq!(calls[1].arguments, json!({"x": 1}));
}

#[test]
fn hermes_string_encoded_arguments_are_decoded() {
    let text = r#"<tool_call>{"name": "run", "arguments": "{\"cmd\": \"ls\"}"}</tool_call>"#;
    let calls = extract_inline_tool_calls(text, ToolDialect::Hermes);
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].arguments, json!({"cmd": "ls"}));
}

#[test]
fn qwen3_coder_xml_basic() {
    let text = "<tool_call><function=write_file><parameter=path>\nnotes/todo.md\n</\
                parameter><parameter=content>\nline one\nline \
                two\n</parameter></function></tool_call>";
    let calls = extract_inline_tool_calls(text, ToolDialect::Qwen3CoderXml);
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].name, "write_file");
    assert_eq!(
        calls[0].arguments,
        json!({"path": "notes/todo.md", "content": "line one\nline two"})
    );
}

#[test]
fn qwen3_coder_xml_coerces_scalars() {
    let text = r#"<tool_call><function=set_flag><parameter=count>
3
</parameter><parameter=ratio>
1.5
</parameter><parameter=enabled>
true
</parameter><parameter=payload>
{"a": 1}
</parameter></function></tool_call>"#;
    let calls = extract_inline_tool_calls(text, ToolDialect::Qwen3CoderXml);
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].arguments,
        json!({"count": 3, "ratio": 1.5, "enabled": true, "payload": {"a": 1}})
    );
}

#[test]
fn mistral_tool_calls_marker() {
    let text = r#"[TOOL_CALLS][{"name": "search", "arguments": {"query": "rust"}}]"#;
    let calls = extract_inline_tool_calls(text, ToolDialect::MistralToolCalls);
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].name, "search");
    assert_eq!(calls[0].arguments, json!({"query": "rust"}));
}

#[test]
fn openai_json_shape() {
    let text = r#"{"tool_calls": [{"type": "function", "function": {"name": "get_weather", "arguments": "{\"city\": \"Paris\"}"}}]}"#;
    let calls = extract_inline_tool_calls(text, ToolDialect::OpenAiJson);
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].name, "get_weather");
    assert_eq!(calls[0].arguments, json!({"city": "Paris"}));
}

#[test]
fn bare_json_single_object() {
    let text = "Here is my call: {\"name\": \"list_dir\", \"parameters\": {\"path\": \".\"}}";
    let calls = extract_inline_tool_calls(text, ToolDialect::BareJson);
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].name, "list_dir");
    assert_eq!(calls[0].arguments, json!({"path": "."}));
}

#[test]
fn bare_json_array_of_calls() {
    let text = r#"[{"name": "a", "arguments": {}}, {"name": "b", "arguments": {"x": 1}}]"#;
    let calls = extract_inline_tool_calls(text, ToolDialect::BareJson);
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].name, "a");
    assert_eq!(calls[1].name, "b");
}

#[test]
fn extract_any_prefers_hermes_when_present() {
    let text = "<tool_call>{\"name\": \"only\", \"arguments\": {}}</tool_call>";
    let calls = extract_any(text);
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].name, "only");
}

#[test]
fn extract_any_falls_back_to_bare_json() {
    let text = r#"{"name": "fallback", "arguments": {"ok": true}}"#;
    let calls = extract_any(text);
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].name, "fallback");
}

#[test]
fn extract_any_returns_empty_for_plain_prose() {
    assert!(extract_any("I don't need any tools for that.").is_empty());
}

#[test]
fn strip_tool_calls_removes_spans_and_trims() {
    let text = "Let me check.\n<tool_call>{\"name\": \"a\", \"arguments\": {}}</tool_call>\nDone.";
    let calls = extract_inline_tool_calls(text, ToolDialect::Hermes);
    let stripped = strip_tool_calls(text, &calls);
    assert_eq!(stripped, "Let me check.\n\nDone.");
}

#[test]
fn strip_tool_calls_handles_multiple_spans_in_order() {
    let text = "<tool_call>{\"name\": \"a\", \"arguments\": {}}</tool_call> and \
                <tool_call>{\"name\": \"b\", \"arguments\": {}}</tool_call>";
    let calls = extract_inline_tool_calls(text, ToolDialect::Hermes);
    let stripped = strip_tool_calls(text, &calls);
    assert_eq!(stripped, "and");
}
