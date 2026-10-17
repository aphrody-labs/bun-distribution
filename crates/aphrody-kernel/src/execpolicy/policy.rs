// SPDX-License-Identifier: Apache-2.0
//! Policy store and multi-rule resolution engine.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::execpolicy::{
    decision::Decision,
    rule::{PrefixRule, RuleMatch},
};

/// User approval mode governing how `Prompt` decisions are handled.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalPolicy {
    /// Zero Human In The Loop doctrine: prompts are deterministically converted
    /// to `Forbidden` with a structured reason for the agent to re-plan.
    #[default]
    Never,
    /// Prompt the user only when explicitly required by a rule.
    OnRequest,
    /// Prompt for any command not explicitly allowed by policy.
    Untrusted,
    /// Always prompt before executing any command.
    Always,
}

/// The outcome of an execution policy evaluation including No-HITL adjustments.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PolicyEvaluation {
    /// The final effective decision after applying approval policies.
    pub decision: Decision,
    /// The rule that determined this decision, if any matched.
    pub matched_rule: Option<RuleMatch>,
    /// Structured explanation for denials or policy transformations.
    pub explanation: Option<String>,
}

impl PolicyEvaluation {
    /// True if the command is authorized to execute immediately.
    #[must_use]
    pub const fn is_allowed(&self) -> bool {
        matches!(self.decision, Decision::Allow)
    }

    /// True if the command was forbidden.
    #[must_use]
    pub const fn is_forbidden(&self) -> bool {
        matches!(self.decision, Decision::Forbidden)
    }
}

/// A collection of prefix execution rules indexed for fast lookup.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Policy {
    /// Prefix rules grouped by their primary command token.
    rules_by_program: HashMap<String, Vec<PrefixRule>>,
    /// Fallback decision when no rule matches.
    pub default_decision: Decision,
}

impl Policy {
    /// Create an empty policy with default decision set to `Prompt`.
    #[must_use]
    pub fn new() -> Self {
        Self {
            rules_by_program: HashMap::new(),
            default_decision: Decision::Prompt,
        }
    }

    /// Create an empty policy with custom default decision.
    #[must_use]
    pub fn with_default_decision(default_decision: Decision) -> Self {
        Self {
            rules_by_program: HashMap::new(),
            default_decision,
        }
    }

    /// Add a prefix rule to the policy.
    pub fn add_prefix_rule(&mut self, rule: PrefixRule) {
        let key = rule.pattern.first.to_string();
        self.rules_by_program.entry(key).or_default().push(rule);
    }

    /// Total number of rules registered in the policy.
    #[must_use]
    pub fn rule_count(&self) -> usize {
        self.rules_by_program.values().map(Vec::len).sum()
    }

    /// Evaluate `cmd` against all matching rules and resolve using `max(severity)`.
    ///
    /// If multiple rules match:
    /// 1. Higher severity always wins: `Forbidden > Prompt > Allow`.
    /// 2. Tie-breaker: longer matched prefix (more specific rule).
    #[must_use]
    pub fn evaluate(&self, cmd: &[String]) -> Option<RuleMatch> {
        let (first, _) = cmd.split_first()?;

        // Normalize first token (remove .exe on Windows)
        let prog_key = first.strip_suffix(".exe").unwrap_or(first);
        let rules = self.rules_by_program.get(prog_key)?;

        let mut best_match: Option<RuleMatch> = None;

        for rule in rules {
            if let Some(matched_prefix) = rule.pattern.matches_prefix(cmd) {
                let candidate = RuleMatch {
                    matched_prefix,
                    decision: rule.decision,
                    justification: rule.justification.clone(),
                };

                best_match = match best_match {
                    None => Some(candidate),
                    Some(existing) => {
                        if candidate.decision > existing.decision
                            || (candidate.decision == existing.decision
                                && candidate.matched_prefix.len() > existing.matched_prefix.len())
                        {
                            Some(candidate)
                        } else {
                            Some(existing)
                        }
                    }
                };
            }
        }

        best_match
    }

    /// Evaluate `cmd` with respect to the active [`ApprovalPolicy`].
    ///
    /// When `approval` is `Never` (aphrody default No-HITL):
    /// - If the raw decision is `Prompt`, it is upgraded to `Forbidden`.
    /// - A structured explanation is generated for the agent to re-plan.
    #[must_use]
    pub fn evaluate_with_approval(
        &self,
        cmd: &[String],
        approval: ApprovalPolicy,
    ) -> PolicyEvaluation {
        let matched = self.evaluate(cmd);
        let raw_decision = matched
            .as_ref()
            .map_or(self.default_decision, |m| m.decision);

        match (raw_decision, approval) {
            (Decision::Allow, _) => PolicyEvaluation {
                decision: Decision::Allow,
                matched_rule: matched,
                explanation: None,
            },
            (Decision::Forbidden, _) => {
                let reason = matched
                    .as_ref()
                    .and_then(|m| m.justification.clone())
                    .unwrap_or_else(|| "Command is forbidden by execution policy.".to_string());
                PolicyEvaluation {
                    decision: Decision::Forbidden,
                    matched_rule: matched,
                    explanation: Some(reason),
                }
            }
            (Decision::Prompt, ApprovalPolicy::Never) => {
                // Autonomous No-HITL transformation: Prompt => Forbidden
                let rule_reason = matched
                    .as_ref()
                    .and_then(|m| m.justification.clone())
                    .unwrap_or_else(|| "operation requires approval".to_string());

                let explanation = format!(
                    "Command `{}` requires confirmation ('prompt'), but approval_policy is \
                     'never' (No-HITL doctrine). Upgraded to Forbidden. Reason: {rule_reason}",
                    cmd.join(" ")
                );

                PolicyEvaluation {
                    decision: Decision::Forbidden,
                    matched_rule: matched,
                    explanation: Some(explanation),
                }
            }
            (Decision::Prompt, _) => PolicyEvaluation {
                decision: Decision::Prompt,
                matched_rule: matched,
                explanation: Some(
                    "Command requires user confirmation before execution.".to_string(),
                ),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execpolicy::rule::PrefixPattern;

    #[test]
    fn test_policy_resolution_max_severity() {
        let mut policy = Policy::new();

        // Rule 1: allow "git"
        let r1 = PrefixRule::new(
            PrefixPattern::from_tokens(&["git".to_string()]).unwrap(),
            Decision::Allow,
            None,
        );
        policy.add_prefix_rule(r1);

        // Rule 2: prompt "git reset"
        let r2 = PrefixRule::new(
            PrefixPattern::from_tokens(&["git".to_string(), "reset".to_string()]).unwrap(),
            Decision::Prompt,
            Some("reset can lose working state".to_string()),
        );
        policy.add_prefix_rule(r2);

        // Rule 3: forbidden "git reset --hard"
        let r3 = PrefixRule::new(
            PrefixPattern::from_tokens(&[
                "git".to_string(),
                "reset".to_string(),
                "--hard".to_string(),
            ])
            .unwrap(),
            Decision::Forbidden,
            Some("destructive git reset".to_string()),
        );
        policy.add_prefix_rule(r3);

        // "git status" => Allow
        let eval_status = policy
            .evaluate(&["git".to_string(), "status".to_string()])
            .unwrap();
        assert_eq!(eval_status.decision, Decision::Allow);

        // "git reset" => Prompt
        let eval_reset = policy
            .evaluate(&["git".to_string(), "reset".to_string()])
            .unwrap();
        assert_eq!(eval_reset.decision, Decision::Prompt);

        // "git reset --hard HEAD" => Forbidden (max severity wins)
        let eval_hard = policy
            .evaluate(&["git".to_string(), "reset".to_string(), "--hard".to_string()])
            .unwrap();
        assert_eq!(eval_hard.decision, Decision::Forbidden);
    }

    #[test]
    fn test_no_hitl_prompt_to_forbidden_transform() {
        let mut policy = Policy::new();
        let rule = PrefixRule::new(
            PrefixPattern::from_tokens(&["rm".to_string()]).unwrap(),
            Decision::Prompt,
            Some("file deletion requires confirmation".to_string()),
        );
        policy.add_prefix_rule(rule);

        let cmd = vec!["rm".to_string(), "-rf".to_string(), "/tmp/test".to_string()];

        // Under OnRequest: remains Prompt
        let eval_prompt = policy.evaluate_with_approval(&cmd, ApprovalPolicy::OnRequest);
        assert_eq!(eval_prompt.decision, Decision::Prompt);

        // Under Never (No-HITL): becomes Forbidden with structured explanation
        let eval_nohitl = policy.evaluate_with_approval(&cmd, ApprovalPolicy::Never);
        assert_eq!(eval_nohitl.decision, Decision::Forbidden);
        assert!(
            eval_nohitl
                .explanation
                .unwrap()
                .contains("approval_policy is 'never'")
        );
    }
}
