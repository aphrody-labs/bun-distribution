// SPDX-License-Identifier: Apache-2.0
//! Parser for `.codexpolicy` rules files.

use crate::execpolicy::{
    decision::Decision,
    error::{Error, Result},
    policy::Policy,
    rule::{PrefixPattern, PrefixRule},
};

/// Parser for `.codexpolicy` / Starlark-compatible prefix rule files.
#[derive(Debug, Default)]
pub struct PolicyParser;

impl PolicyParser {
    #[must_use]
    pub fn new() -> Self {
        Self
    }

    /// Parse policy rules from a file content string.
    pub fn parse(&self, content: &str) -> Result<Policy> {
        let mut policy = Policy::new();

        // Strip comments line by line while preserving line counts
        let clean = strip_comments(content);

        // Find all occurrences of prefix_rule(...)
        let mut cursor = 0;
        while let Some(start_idx) = clean[cursor..].find("prefix_rule(") {
            let abs_start = cursor + start_idx + "prefix_rule(".len();
            // Match balanced parentheses
            if let Some(end_rel) = find_matching_paren(&clean[abs_start..]) {
                let abs_end = abs_start + end_rel;
                let block = &clean[abs_start..abs_end];
                let rule = parse_prefix_rule_block(block, line_number_at(&clean, abs_start))?;
                rule.validate_examples()?;
                policy.add_prefix_rule(rule);
                cursor = abs_end + 1;
            } else {
                return Err(Error::ParseError {
                    line: line_number_at(&clean, abs_start),
                    message: "Unclosed parentheses in prefix_rule".to_string(),
                });
            }
        }

        Ok(policy)
    }
}

/// Strip `#` comments from content.
fn strip_comments(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    for line in content.lines() {
        if let Some(pos) = line.find('#') {
            out.push_str(&line[..pos]);
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

/// Find the relative index of the closing ')' matching the opening '('.
fn find_matching_paren(input: &str) -> Option<usize> {
    let mut depth = 1;
    let mut in_quote = false;
    let mut quote_char = ' ';
    let mut escape = false;

    for (idx, ch) in input.char_indices() {
        if escape {
            escape = false;
            continue;
        }
        if ch == '\\' {
            escape = true;
            continue;
        }
        if in_quote {
            if ch == quote_char {
                in_quote = false;
            }
            continue;
        }
        if ch == '"' || ch == '\'' {
            in_quote = true;
            quote_char = ch;
            continue;
        }
        if ch == '(' || ch == '[' {
            depth += 1;
        } else if ch == ')' || ch == ']' {
            depth -= 1;
            if depth == 0 {
                return Some(idx);
            }
        }
    }
    None
}

/// Calculate 1-indexed line number at a given byte offset.
fn line_number_at(content: &str, offset: usize) -> usize {
    content[..offset.min(content.len())].chars().filter(|&c| c == '\n').count() + 1
}

/// Parse the body of a `prefix_rule(...)` call.
fn parse_prefix_rule_block(block: &str, line: usize) -> Result<PrefixRule> {
    let mut pattern: Option<PrefixPattern> = None;
    let mut decision = Decision::Allow; // Default upstream decision is Allow if unspecified
    let mut justification: Option<String> = None;
    let mut match_examples: Vec<Vec<String>> = Vec::new();
    let mut not_match_examples: Vec<Vec<String>> = Vec::new();

    // Parse key-value arguments
    let args = split_top_level_arguments(block);
    for (key, val) in args {
        match key.trim() {
            "pattern" => {
                let tokens = parse_string_list(val.trim(), line)?;
                pattern = Some(PrefixPattern::from_tokens(&tokens)?);
            },
            "decision" => {
                let dec_str = parse_string_literal(val.trim(), line)?;
                decision = Decision::parse(&dec_str)?;
            },
            "justification" => {
                justification = Some(parse_string_literal(val.trim(), line)?);
            },
            "match" => {
                match_examples = parse_examples_list(val.trim(), line)?;
            },
            "not_match" => {
                not_match_examples = parse_examples_list(val.trim(), line)?;
            },
            _ => {
                // Ignore unknown metadata attributes
            },
        }
    }

    let Some(pat) = pattern else {
        return Err(Error::ParseError {
            line,
            message: "Missing required 'pattern' in prefix_rule".to_string(),
        });
    };

    let mut rule = PrefixRule::new(pat, decision, justification);
    rule.match_examples = match_examples;
    rule.not_match_examples = not_match_examples;
    Ok(rule)
}

/// Split top-level arguments by commas not enclosed in lists or strings.
fn split_top_level_arguments(block: &str) -> Vec<(String, String)> {
    let mut pairs = Vec::new();
    let mut depth = 0;
    let mut in_quote = false;
    let mut quote_char = ' ';
    let mut escape = false;
    let mut current = String::new();

    for ch in block.chars() {
        if escape {
            escape = false;
            current.push(ch);
            continue;
        }
        if ch == '\\' {
            escape = true;
            current.push(ch);
            continue;
        }
        if in_quote {
            if ch == quote_char {
                in_quote = false;
            }
            current.push(ch);
            continue;
        }
        if ch == '"' || ch == '\'' {
            in_quote = true;
            quote_char = ch;
            current.push(ch);
            continue;
        }
        if ch == '[' || ch == '(' {
            depth += 1;
            current.push(ch);
            continue;
        }
        if ch == ']' || ch == ')' {
            depth -= 1;
            current.push(ch);
            continue;
        }
        if ch == ',' && depth == 0 {
            if let Some((k, v)) = split_key_value(&current) {
                pairs.push((k, v));
            }
            current.clear();
            continue;
        }
        current.push(ch);
    }

    if let Some((k, v)) = split_key_value(&current) {
        pairs.push((k, v));
    }

    pairs
}

fn split_key_value(input: &str) -> Option<(String, String)> {
    let trimmed = input.trim();
    let eq_pos = trimmed.find('=')?;
    let key = trimmed[..eq_pos].trim().to_string();
    let val = trimmed[eq_pos + 1..].trim().to_string();
    if key.is_empty() { None } else { Some((key, val)) }
}

/// Parse a string literal like `"hello"` or `'hello'`.
fn parse_string_literal(input: &str, line: usize) -> Result<String> {
    let trimmed = input.trim();
    if (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
    {
        Ok(trimmed[1..trimmed.len() - 1].to_string())
    } else {
        Err(Error::ParseError { line, message: format!("Expected string literal, got: {trimmed}") })
    }
}

/// Parse a list of string literals like `["git", "status"]`.
fn parse_string_list(input: &str, line: usize) -> Result<Vec<String>> {
    let trimmed = input.trim();
    if !trimmed.starts_with('[') || !trimmed.ends_with(']') {
        return Err(Error::ParseError {
            line,
            message: format!("Expected list [...], got: {trimmed}"),
        });
    }

    let inner = &trimmed[1..trimmed.len() - 1];
    let mut out = Vec::new();
    for part in split_by_top_level_comma(inner) {
        let p = part.trim();
        if !p.is_empty() {
            out.push(parse_string_literal(p, line)?);
        }
    }
    Ok(out)
}

/// Parse examples list which can contain both `["git", "status"]` lists and `"git status"` strings.
fn parse_examples_list(input: &str, line: usize) -> Result<Vec<Vec<String>>> {
    let trimmed = input.trim();
    if !trimmed.starts_with('[') || !trimmed.ends_with(']') {
        return Err(Error::ParseError {
            line,
            message: format!("Expected examples list [...], got: {trimmed}"),
        });
    }

    let inner = &trimmed[1..trimmed.len() - 1];
    let mut out = Vec::new();

    for item in split_by_top_level_comma(inner) {
        let trimmed_item = item.trim();
        if trimmed_item.is_empty() {
            continue;
        }

        if trimmed_item.starts_with('[') {
            out.push(parse_string_list(trimmed_item, line)?);
        } else {
            // String representation parsed using shlex
            let raw_str = parse_string_literal(trimmed_item, line)?;
            if let Some(tokens) = shlex::split(&raw_str) {
                out.push(tokens);
            } else {
                out.push(raw_str.split_whitespace().map(String::from).collect());
            }
        }
    }

    Ok(out)
}

/// Split comma-separated tokens not nested inside quotes or brackets.
fn split_by_top_level_comma(input: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut depth = 0;
    let mut in_quote = false;
    let mut quote_char = ' ';
    let mut escape = false;
    let mut current = String::new();

    for ch in input.chars() {
        if escape {
            escape = false;
            current.push(ch);
            continue;
        }
        if ch == '\\' {
            escape = true;
            current.push(ch);
            continue;
        }
        if in_quote {
            if ch == quote_char {
                in_quote = false;
            }
            current.push(ch);
            continue;
        }
        if ch == '"' || ch == '\'' {
            in_quote = true;
            quote_char = ch;
            current.push(ch);
            continue;
        }
        if ch == '[' || ch == '(' {
            depth += 1;
            current.push(ch);
            continue;
        }
        if ch == ']' || ch == ')' {
            depth -= 1;
            current.push(ch);
            continue;
        }
        if ch == ',' && depth == 0 {
            out.push(std::mem::take(&mut current));
            continue;
        }
        current.push(ch);
    }

    if !current.trim().is_empty() {
        out.push(current);
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_policy() {
        let policy_str = r#"
        # Example policy
        prefix_rule(
            pattern = ["git", "reset", "--hard"],
            decision = "forbidden",
            justification = "destructive operation",
            match = [
                ["git", "reset", "--hard"],
            ],
            not_match = [
                ["git", "reset", "--keep"],
                "git reset --merge",
            ],
        )

        prefix_rule(
            pattern = ["ls"],
            match = [
                ["ls"],
                ["ls", "-la"],
            ],
        )
        "#;

        let parser = PolicyParser::new();
        let policy = parser.parse(policy_str).expect("parse must succeed");

        assert_eq!(policy.rule_count(), 2);

        let eval_forbidden = policy
            .evaluate(&["git".to_string(), "reset".to_string(), "--hard".to_string()])
            .expect("must match");
        assert_eq!(eval_forbidden.decision, Decision::Forbidden);
        assert_eq!(eval_forbidden.justification.as_deref(), Some("destructive operation"));

        let eval_allow =
            policy.evaluate(&["ls".to_string(), "-la".to_string()]).expect("must match");
        assert_eq!(eval_allow.decision, Decision::Allow);
    }
}
