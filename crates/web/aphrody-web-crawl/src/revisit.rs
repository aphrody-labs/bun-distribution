// SPDX-License-Identifier: Apache-2.0

/// Observations retained for a crawled page.
#[derive(Debug, Clone, Copy, Default)]
pub struct ChangeHistory {
    pub fetch_count: u32,
    pub change_count: u32,
    pub first_fetched_at: Option<i64>,
    pub last_fetched_at: Option<i64>,
}

/// Poisson change-rate policy retained from the source frontier.
#[derive(Debug, Clone, Copy)]
pub struct RevisitPolicy {
    pub min_interval_ms: i64,
    pub max_interval_ms: i64,
    pub prior_changes: f64,
    pub prior_interval_ms: f64,
    pub min_samples: u32,
    pub importance_ref: f64,
}

impl Default for RevisitPolicy {
    fn default() -> Self {
        Self {
            min_interval_ms: 300_000,
            max_interval_ms: 30 * 86_400_000,
            prior_changes: 1.0,
            prior_interval_ms: 7.0 * 86_400_000.0,
            min_samples: 3,
            importance_ref: 1.0,
        }
    }
}

#[must_use]
pub fn estimate_change_rate(history: ChangeHistory, policy: RevisitPolicy) -> f64 {
    let elapsed = match (history.first_fetched_at, history.last_fetched_at) {
        (Some(first), Some(last)) => last.saturating_sub(first).max(0) as f64,
        _ => 0.0,
    };
    let revisits = history.fetch_count.saturating_sub(1);
    if revisits >= policy.min_samples && elapsed > 0.0 {
        let changes = history.change_count.min(revisits);
        let rate = -((f64::from(revisits - changes) + 0.5) / (f64::from(revisits) + 0.5)).ln()
            / (elapsed / f64::from(revisits));
        let prior = policy.prior_changes / (elapsed + policy.prior_interval_ms);
        return rate.max(if changes == 0 { prior * 0.1 } else { 0.0 });
    }
    (f64::from(history.change_count) + policy.prior_changes) / (elapsed + policy.prior_interval_ms)
}

#[must_use]
pub fn importance_weight(importance: f64, policy: RevisitPolicy) -> f64 {
    let reference = if policy.importance_ref > 0.0 { policy.importance_ref } else { 1.0 };
    let weight = importance / reference;
    if !weight.is_finite() {
        return 0.1;
    }
    weight.clamp(0.1, 10.0)
}

#[must_use]
pub fn revisit_interval_ms(rate: f64, importance: f64, policy: RevisitPolicy) -> i64 {
    if rate <= 0.0 || !rate.is_finite() {
        return policy.max_interval_ms;
    }
    let interval = 1.0 / (rate * importance_weight(importance, policy));
    interval.clamp(policy.min_interval_ms as f64, policy.max_interval_ms as f64) as i64
}

#[must_use]
pub fn revisit_priority(rate: f64, importance: f64, elapsed_ms: i64, policy: RevisitPolicy) -> f64 {
    if rate <= 0.0 || elapsed_ms <= 0 {
        return 0.0;
    }
    importance_weight(importance, policy) * (1.0 - (-rate * elapsed_ms as f64).exp())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interval_shortens_for_frequently_changing_pages() {
        let policy = RevisitPolicy::default();
        let slow = revisit_interval_ms(1.0 / 86_400_000.0, 1.0, policy);
        let fast = revisit_interval_ms(1.0 / 3_600_000.0, 1.0, policy);
        assert!(fast < slow);
    }

    #[test]
    fn estimate_stays_finite_without_history() {
        let rate = estimate_change_rate(ChangeHistory::default(), RevisitPolicy::default());
        assert!(rate.is_finite() && rate > 0.0);
    }
}
