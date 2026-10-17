// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Benchmark execution harness evaluating retrieval targets against gold sets.

use std::collections::BTreeMap;

use aphrody_rag_core::eval::{
    CaseResult, Gate, GoldCase, LatencyStats, Report, latency_stats, run_case,
};
use serde::{Deserialize, Serialize};

use crate::{
    error::{EvalError, Result},
    target::EvalTarget,
};

/// Configuration options for an evaluation run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalOptions {
    /// Maximum retrieval depth (rank limit) per query (default: 10).
    pub limit_k: usize,
    /// Allow varying `mode_served` across cases. When false, mismatch aborts run.
    pub allow_mixed: bool,
    /// Quality gate expressions to enforce (e.g. `recall@5>=0.80`, `mrr>=0.65`).
    pub gates: Vec<String>,
    /// Optional tag filter to run a subset of gold cases.
    pub tag_filter: Option<String>,
}

impl Default for EvalOptions {
    fn default() -> Self {
        Self {
            limit_k: 10,
            allow_mixed: false,
            gates: Vec::new(),
            tag_filter: None,
        }
    }
}

/// Comprehensive summary report of an evaluation run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalSummary {
    /// Name or URI of the evaluated target.
    pub target_name: String,
    /// Dominant or uniform retrieval mode served.
    pub dominant_mode: String,
    /// Distribution of modes served across all executed queries.
    pub modes_distribution: BTreeMap<String, usize>,
    /// Underlying evaluation report containing overall and per-tag metrics.
    pub report: Report,
    /// Latency percentiles (p50, p95).
    pub latency: LatencyStats,
    /// Whether all configured quality gates passed.
    pub passed_gates: bool,
    /// Detailed failures if quality gates failed.
    pub gate_failures: Vec<String>,
}

impl EvalSummary {
    /// Total number of evaluated cases.
    pub fn cases_count(&self) -> usize {
        self.report.cases.len()
    }

    /// Format the evaluation results as a clean GitHub-flavored markdown table.
    pub fn format_markdown(&self) -> String {
        let mut out = String::new();
        out.push_str(&format!(
            "## RAG Evaluation Report: `{}`\n\n",
            self.target_name
        ));
        out.push_str(&format!(
            "- **Cases evaluated**: {}\n- **Condition served**: `{}`\n- **Latency**: p50 = \
             {:.1}ms, p95 = {:.1}ms\n- **Status**: {}\n\n",
            self.report.cases.len(),
            self.dominant_mode,
            self.latency.p50_ms,
            self.latency.p95_ms,
            if self.passed_gates {
                "**PASSED**"
            } else {
                "**GATE FAILED**"
            }
        ));

        if !self.gate_failures.is_empty() {
            out.push_str("### Quality Gate Violations\n");
            for f in &self.gate_failures {
                out.push_str(&format!("- ❌ {}\n", f));
            }
            out.push('\n');
        }

        out.push_str("### Overall Metrics\n\n");
        out.push_str("| Metric | Value |\n|---|---|\n");
        for (&k, &val) in &self.report.overall.recall {
            out.push_str(&format!(
                "| **Recall@{}** | {:.4} ({:.1}%) |\n",
                k,
                val,
                val * 100.0
            ));
        }
        out.push_str(&format!("| **MRR** | {:.4} |\n", self.report.overall.mrr));
        out.push_str(&format!(
            "| **nDCG@10** | {:.4} |\n\n",
            self.report.overall.ndcg
        ));

        if !self.report.by_tag.is_empty() {
            out.push_str("### Per-Tag Breakdown\n\n");
            out.push_str(
                "| Tag | Cases | Recall@1 | Recall@5 | Recall@10 | MRR | nDCG@10 \
                 |\n|---|---|---|---|---|---|---|\n",
            );
            for (tag, agg) in &self.report.by_tag {
                let r1 = agg.recall.get(&1).copied().unwrap_or(0.0);
                let r5 = agg.recall.get(&5).copied().unwrap_or(0.0);
                let r10 = agg.recall.get(&10).copied().unwrap_or(0.0);
                out.push_str(&format!(
                    "| `{}` | {} | {:.2} | {:.2} | {:.2} | {:.3} | {:.3} |\n",
                    tag, agg.cases, r1, r5, r10, agg.mrr, agg.ndcg
                ));
            }
            out.push('\n');
        }

        out
    }
}

/// Execute a benchmark evaluation run against `target` using the provided `cases`.
pub async fn run_eval(
    target: &dyn EvalTarget,
    cases: &[GoldCase],
    opts: &EvalOptions,
) -> Result<EvalSummary> {
    let filtered_cases: Vec<&GoldCase> = if let Some(ref filter) = opts.tag_filter {
        cases
            .iter()
            .filter(|c| c.tags.iter().any(|t| t == filter))
            .collect()
    } else {
        cases.iter().collect()
    };

    if filtered_cases.is_empty() {
        return Err(EvalError::EmptyGoldSet);
    }

    let mut modes_distribution: BTreeMap<String, usize> = BTreeMap::new();
    let mut initial_mode: Option<String> = None;
    let mut case_results: Vec<CaseResult> = Vec::with_capacity(filtered_cases.len());
    let mut latencies_ms: Vec<f64> = Vec::with_capacity(filtered_cases.len());

    for case in filtered_cases {
        let resp = target.query(&case.q, opts.limit_k).await?;
        let mode = resp.mode_served.trim().to_ascii_lowercase();
        if matches!(mode.as_str(), "" | "unknown" | "error" | "mcp" | "none") {
            return Err(EvalError::ConditionMismatch {
                expected: "explicit retrieval mode".to_owned(),
                observed: resp.mode_served,
            });
        }

        // Mode consistency check
        if let Some(ref expected) = initial_mode {
            if !opts.allow_mixed && &mode != expected {
                return Err(EvalError::ConditionMismatch {
                    expected: expected.clone(),
                    observed: mode,
                });
            }
        } else {
            initial_mode = Some(mode.clone());
        }

        *modes_distribution.entry(mode.clone()).or_insert(0) += 1;
        latencies_ms.push(resp.latency_ms as f64);

        let cr = run_case(case.clone(), &resp.hits, &mode, resp.latency_ms);
        case_results.push(cr);
    }

    let dominant_mode = modes_distribution
        .iter()
        .max_by_key(|(_, count)| *count)
        .map(|(m, _)| m.clone())
        .ok_or(EvalError::EmptyGoldSet)?;

    let report = Report::from_cases(&dominant_mode, case_results);
    let latency = latency_stats(&latencies_ms);

    // Evaluate quality gates
    let mut gate_failures = Vec::new();
    for gate_expr in &opts.gates {
        match Gate::parse(gate_expr) {
            Ok(gate) => {
                if let Err(failure) = gate.check(&report.overall) {
                    gate_failures.push(failure.to_string());
                }
            }
            Err(err) => {
                gate_failures.push(format!("Invalid gate '{gate_expr}': {err}"));
            }
        }
    }

    let passed_gates = gate_failures.is_empty();

    Ok(EvalSummary {
        target_name: target.name().to_string(),
        dominant_mode,
        modes_distribution,
        report,
        latency,
        passed_gates,
        gate_failures,
    })
}
