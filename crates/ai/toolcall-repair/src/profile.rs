// SPDX-License-Identifier: Apache-2.0
//! Per-model prompt profiles: which tool-call dialect and apply-patch format
//! a given open-source model family actually emits, plus the harness
//! instructions that get it to emit that dialect reliably.

use serde::{Deserialize, Serialize};

use crate::{extract::ToolDialect, patch_normalize::PatchFormat};

/// How (if at all) generation should be constrained to guarantee well-formed
/// tool calls.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GrammarMode {
    /// No constrained decoding; rely on the repair layer.
    None,
    /// Constrain to the tool's JSON Schema (e.g. an OpenAI-compatible
    /// `response_format: json_schema` or a llama.cpp GBNF schema grammar).
    JsonSchema,
    /// Constrain with a hand-written GBNF grammar (llama.cpp `--grammar`).
    Gbnf,
}

/// A model family's tool-calling behaviour and the harness instructions that
/// keep it inside that behaviour.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PromptProfile {
    /// A stable identifier for this profile (used as a config key).
    pub id: String,
    /// Glob patterns (`*`, `?`, case-insensitive) matched against the model
    /// name/tag to select this profile.
    pub match_model: Vec<String>,
    /// Harness preamble text prepended to the system prompt telling the
    /// model exactly how to emit tool calls and patches.
    pub system_preamble: String,
    /// The inline tool-call dialect this model family emits.
    pub tool_dialect: ToolDialect,
    /// The edit format this model family should be steered toward.
    pub apply_patch_format: PatchFormat,
    /// Whether the model can be trusted to emit multiple tool calls in one
    /// turn.
    pub parallel_tools: bool,
    /// Cap on the number of tools exposed at once (`None` = no cap).
    pub max_tools: Option<usize>,
    /// Constrained-decoding strategy, if any.
    pub grammar: GrammarMode,
    /// Suggested sampling temperature for tool-calling turns.
    pub temperature: Option<f32>,
    /// Suggested stop sequences (dialect closing tags/markers).
    pub stop: Vec<String>,
}

/// Real-world profiles for the open-source model families aphrody targets.
#[must_use]
pub fn builtin_profiles() -> Vec<PromptProfile> {
    vec![
        qwen25_coder_profile(),
        qwen3_coder_profile(),
        gpt_oss_profile(),
        devstral_profile(),
        llama3_profile(),
        gemma_profile(),
        default_profile(),
    ]
}

fn qwen25_coder_profile() -> PromptProfile {
    PromptProfile {
        id: "qwen2.5-coder".to_string(),
        match_model: vec!["qwen2.5-coder*".to_string(), "qwen2*coder*".to_string()],
        system_preamble: concat!(
            "You have access to tools. When you need one, respond with exactly one JSON ",
            "object per call, on its own, of the shape ",
            "{\"name\": \"<tool name>\", \"arguments\": {<JSON object>}}. Do not wrap it in ",
            "markdown fences, do not add commentary before or after it, and do not emit more ",
            "than one call unless the task truly needs several independent tools in the same ",
            "turn. When editing files, use the apply_patch tool with the exact ",
            "*** Begin Patch / *** Update File: <path> / @@ <context> / -removed / +added / ",
            "*** End Patch envelope; never a unified diff or a SEARCH/REPLACE block."
        )
        .to_string(),
        tool_dialect: ToolDialect::BareJson,
        apply_patch_format: PatchFormat::CodexPatch,
        parallel_tools: false,
        max_tools: Some(24),
        grammar: GrammarMode::JsonSchema,
        temperature: Some(0.1),
        stop: Vec::new(),
    }
}

fn qwen3_coder_profile() -> PromptProfile {
    PromptProfile {
        id: "qwen3-coder".to_string(),
        match_model: vec!["qwen3-coder*".to_string(), "qwen3*coder*".to_string()],
        system_preamble: concat!(
            "You have access to tools. Call a tool with exactly this XML shape: ",
            "<tool_call><function=TOOL_NAME><parameter=PARAM_NAME>value</parameter>",
            "<parameter=OTHER_PARAM>value</parameter></function></tool_call>. One ",
            "<parameter> element per argument, the raw value on its own lines (no quoting, no ",
            "escaping) between the tags. Close every <function> and <tool_call> tag you open. ",
            "For file edits, use the apply_patch function with a single `input` parameter ",
            "whose value is a complete *** Begin Patch ... *** End Patch document."
        )
        .to_string(),
        tool_dialect: ToolDialect::Qwen3CoderXml,
        apply_patch_format: PatchFormat::CodexPatch,
        parallel_tools: true,
        max_tools: Some(32),
        grammar: GrammarMode::None,
        temperature: Some(0.2),
        stop: vec!["</tool_call>".to_string()],
    }
}

fn gpt_oss_profile() -> PromptProfile {
    PromptProfile {
        id: "gpt-oss".to_string(),
        match_model: vec!["gpt-oss*".to_string()],
        system_preamble: concat!(
            "You have access to tools in the OpenAI function-calling shape. Emit a call as a ",
            "single JSON object {\"tool_calls\": [{\"type\": \"function\", \"function\": ",
            "{\"name\": \"<tool name>\", \"arguments\": \"<JSON-encoded arguments object as ",
            "a string>\"}}]} with no surrounding prose. Prefer one tool call per message \
         unless ",
            "the calls are truly independent. Use the apply_patch tool for every file edit; ",
            "never hand-write a diff yourself."
        )
        .to_string(),
        tool_dialect: ToolDialect::OpenAiJson,
        apply_patch_format: PatchFormat::CodexPatch,
        parallel_tools: true,
        max_tools: Some(32),
        grammar: GrammarMode::JsonSchema,
        temperature: Some(0.2),
        stop: Vec::new(),
    }
}

fn devstral_profile() -> PromptProfile {
    PromptProfile {
        id: "devstral-mistral".to_string(),
        match_model: vec![
            "devstral*".to_string(),
            "mistral*".to_string(),
            "codestral*".to_string(),
        ],
        system_preamble: concat!(
            "You have access to tools. To call one, end your message with the literal marker ",
            "[TOOL_CALLS] immediately followed by a JSON array with exactly one element per ",
            "call: [{\"name\": \"<tool name>\", \"arguments\": {<JSON object>}}]. Do not add ",
            "any text after the array. For file edits, use the apply_patch tool with a full ",
            "*** Begin Patch ... *** End Patch document as its `input` argument."
        )
        .to_string(),
        tool_dialect: ToolDialect::MistralToolCalls,
        apply_patch_format: PatchFormat::CodexPatch,
        parallel_tools: false,
        max_tools: Some(24),
        grammar: GrammarMode::None,
        temperature: Some(0.15),
        stop: vec!["[/TOOL_CALLS]".to_string()],
    }
}

fn llama3_profile() -> PromptProfile {
    PromptProfile {
        id: "llama-3".to_string(),
        match_model: vec![
            "llama-3*".to_string(),
            "llama3*".to_string(),
            "*llama-3*".to_string(),
            "*llama3*".to_string(),
        ],
        system_preamble: concat!(
            "You have access to tools. When you use one, wrap the call in ",
            "<tool_call>{\"name\": \"<tool name>\", \"arguments\": {<JSON \
         object>}}</tool_call> ",
            "tags with nothing else inside them. Use plain JSON with double-quoted keys and ",
            "strings; do not use Python literals (True/False/None) or trailing commas. Prefer \
         a ",
            "single tool call per turn. Use the apply_patch tool, not a hand-written diff, \
         for ",
            "file edits."
        )
        .to_string(),
        tool_dialect: ToolDialect::Hermes,
        apply_patch_format: PatchFormat::CodexPatch,
        parallel_tools: false,
        max_tools: Some(16),
        grammar: GrammarMode::None,
        temperature: Some(0.2),
        stop: vec!["</tool_call>".to_string()],
    }
}

fn gemma_profile() -> PromptProfile {
    PromptProfile {
        id: "gemma".to_string(),
        match_model: vec!["gemma*".to_string()],
        system_preamble: concat!(
            "You have access to tools. Respond with a single JSON object of the shape ",
            "{\"name\": \"<tool name>\", \"arguments\": {<JSON object>}} and nothing else \
         when ",
            "you need one. Keep arguments minimal and only call one tool per turn unless the ",
            "task explicitly needs several. Use the apply_patch tool for file edits."
        )
        .to_string(),
        tool_dialect: ToolDialect::BareJson,
        apply_patch_format: PatchFormat::CodexPatch,
        parallel_tools: false,
        max_tools: Some(12),
        grammar: GrammarMode::JsonSchema,
        temperature: Some(0.1),
        stop: Vec::new(),
    }
}

fn default_profile() -> PromptProfile {
    PromptProfile {
        id: "default".to_string(),
        match_model: vec!["*".to_string()],
        system_preamble: concat!(
            "You have access to tools. When you need one, respond with a single JSON object ",
            "{\"name\": \"<tool name>\", \"arguments\": {<JSON object>}}, or wrap it as ",
            "<tool_call>{...}</tool_call> if that is more natural for you. Use plain JSON ",
            "(double-quoted keys/strings, no trailing commas). Use the apply_patch tool with \
         a ",
            "*** Begin Patch ... *** End Patch document for file edits."
        )
        .to_string(),
        tool_dialect: ToolDialect::BareJson,
        apply_patch_format: PatchFormat::CodexPatch,
        parallel_tools: false,
        max_tools: None,
        grammar: GrammarMode::None,
        temperature: None,
        stop: Vec::new(),
    }
}

/// Select the best-matching profile for `model`.
///
/// `user` profiles are tried first (a user override always wins over a
/// built-in); within each list, the most specific matching pattern wins,
/// where specificity is the count of non-wildcard characters. Falls back to
/// the built-in profile with id `"default"`, or the first built-in profile if
/// none is named `"default"`.
///
/// # Panics
/// Panics if both `user` and `builtin` are empty (there is nothing to select
/// from).
#[must_use]
pub fn select_profile<'a>(
    model: &str,
    user: &'a [PromptProfile],
    builtin: &'a [PromptProfile],
) -> &'a PromptProfile {
    best_match(model, user)
        .or_else(|| best_match(model, builtin))
        .or_else(|| builtin.iter().find(|p| p.id == "default"))
        .or_else(|| user.first())
        .or_else(|| builtin.first())
        .expect("select_profile requires at least one profile in `user` or `builtin`")
}

fn best_match<'a>(model: &str, profiles: &'a [PromptProfile]) -> Option<&'a PromptProfile> {
    profiles
        .iter()
        .filter_map(|profile| {
            profile
                .match_model
                .iter()
                .filter(|pattern| glob_match(pattern, model))
                .map(|pattern| specificity(pattern))
                .max()
                .map(|score| (score, profile))
        })
        .max_by_key(|(score, _)| *score)
        .map(|(_, profile)| profile)
}

/// Specificity of a glob pattern: the count of non-wildcard characters,
/// tie-broken by total length (a longer pattern with the same literal count
/// is more specific, e.g. anchoring more of the string).
fn specificity(pattern: &str) -> (usize, usize) {
    let literal_chars = pattern.chars().filter(|c| *c != '*' && *c != '?').count();
    (literal_chars, pattern.len())
}

/// Case-insensitive glob match supporting `*` (any run of characters,
/// possibly empty) and `?` (exactly one character). No new dependency: a
/// small iterative matcher over `char` slices.
#[must_use]
pub fn glob_match(pattern: &str, text: &str) -> bool {
    let pattern: Vec<char> = pattern.to_lowercase().chars().collect();
    let text: Vec<char> = text.to_lowercase().chars().collect();
    glob_match_chars(&pattern, &text)
}

fn glob_match_chars(pattern: &[char], text: &[char]) -> bool {
    let (mut pi, mut ti) = (0usize, 0usize);
    let (mut wildcard_pattern_idx, mut wildcard_text_idx): (Option<usize>, usize) = (None, 0);

    while ti < text.len() {
        if pi < pattern.len() && (pattern[pi] == '?' || pattern[pi] == text[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < pattern.len() && pattern[pi] == '*' {
            wildcard_pattern_idx = Some(pi);
            wildcard_text_idx = ti;
            pi += 1;
        } else if let Some(sp) = wildcard_pattern_idx {
            pi = sp + 1;
            wildcard_text_idx += 1;
            ti = wildcard_text_idx;
        } else {
            return false;
        }
    }
    while pi < pattern.len() && pattern[pi] == '*' {
        pi += 1;
    }
    pi == pattern.len()
}

#[cfg(test)]
#[path = "profile_tests.rs"]
mod tests;
