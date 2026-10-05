// SPDX-License-Identifier: Apache-2.0
//! Error taxonomy, retry policy and pacing for mass use of the X private API.
//!
//! A script that drives thousands of calls needs three answers the raw client cannot give:
//!
//! * **What kind of failure is this?** ([`classify`]): a dead session must stop everything, a
//!   deleted target must be skipped, a throttle must be waited out, a 5xx may be retried.
//! * **How long to wait, how often to retry?** ([`RetryPolicy`]): exponential backoff with jitter for
//!   transient failures, reset-aware waiting for rate limits, retries only where repeating the
//!   request cannot do harm.
//! * **How fast may mutations go out?** ([`Pacer`]): a port of the purge governor of `@aphrody/x`
//!   (rolling per-window and per-day budgets, randomised inter-call delay, `x-rate-limit-*` folding).
//!
//! The code tables live in `data/x-policy.json`, shared with the TypeScript purge engine so that
//! there is exactly one taxonomy.

use std::{
    collections::VecDeque,
    hash::{BuildHasher, RandomState},
    sync::{
        LazyLock, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{XError, client::RateLimit};

/// The shared taxonomy file (see the module documentation).
pub const POLICY_JSON: &str = include_str!("../data/x-policy.json");

#[derive(Debug, Deserialize)]
struct PolicyTable {
    auth_codes: Vec<i64>,
    auth_statuses: Vec<u16>,
    terminal_codes: Vec<i64>,
    terminal_statuses: Vec<u16>,
    rate_limit_codes: Vec<i64>,
    rate_limit_statuses: Vec<u16>,
    daily_limit_codes: Vec<i64>,
    transient_statuses: Vec<u16>,
    csrf_codes: Vec<i64>,
}

static TABLE: LazyLock<PolicyTable> =
    LazyLock::new(|| serde_json::from_str(POLICY_JSON).expect("data/x-policy.json is valid JSON"));

/// The taxonomy tables as JSON (served by the `meta` operation).
pub fn policy_json() -> Value {
    serde_json::from_str(POLICY_JSON).expect("data/x-policy.json is valid JSON")
}

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

/// What a failure means for the caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    /// The session itself is rejected (codes 32, 89, 99, 215, HTTP 401 and 403). Never retried; a
    /// batch stops dispatching because relaunching against dead credentials is what flags accounts.
    Auth,
    /// The target can never be mutated again: gone, suspended, protected, or the action is already
    /// applied. Final; recorded, never retried.
    Terminal,
    /// A throttle (code 88, HTTP 429, a daily limit): wait for the window, then retry the same
    /// target. Not final.
    RateLimit,
    /// A failure expected to pass on its own (5xx, timeout, transport, CSRF rotation).
    Transient,
    /// The request itself is wrong: bad arguments, unknown operation. Final.
    Invalid,
    /// Anything else; retried like `Transient` for idempotent operations, then reported.
    Other,
}

impl ErrorKind {
    /// The wire name (`"auth"`, `"terminal"`, ...).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auth => "auth",
            Self::Terminal => "terminal",
            Self::RateLimit => "rate_limit",
            Self::Transient => "transient",
            Self::Invalid => "invalid",
            Self::Other => "other",
        }
    }

    /// Whether running the same operation again can change the outcome. Final results are replayed,
    /// not re-executed, when a batch resumes from its checkpoint.
    pub fn is_final(self) -> bool {
        matches!(self, Self::Terminal | Self::Invalid)
    }
}

/// A classified failure.
#[derive(Debug, Clone, Serialize)]
pub struct ErrorInfo {
    /// Human-readable message (no credentials, no URL query).
    pub message: String,
    /// The class of the failure.
    pub kind: ErrorKind,
    /// The X API error code, when the failure carried one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<i64>,
    /// The HTTP status, when the failure was a bare HTTP status.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    /// For a rate limit: the epoch second at which the window reopens, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset_epoch: Option<i64>,
    /// The request was certainly not processed (connection refused, CSRF mismatch, throttle), so
    /// repeating it is safe even for a non-idempotent operation.
    #[serde(skip)]
    pub retry_safe: bool,
}

impl ErrorInfo {
    /// An `invalid` failure with `message`.
    pub fn invalid(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            kind: ErrorKind::Invalid,
            code: None,
            status: None,
            reset_epoch: None,
            retry_safe: false,
        }
    }

    /// A transient timeout of `ms` milliseconds.
    pub fn timeout(ms: u128) -> Self {
        Self {
            message: format!("timed out after {ms} ms"),
            kind: ErrorKind::Transient,
            code: None,
            status: None,
            reset_epoch: None,
            retry_safe: false,
        }
    }
}

/// Cut the query string out of a transport error message: it holds the (large) GraphQL variables
/// and feature flags, never credentials, but it floods logs.
fn redact_url(message: &str) -> String {
    let mut out = String::with_capacity(message.len().min(400));
    let mut skipping = false;
    for ch in message.chars() {
        if skipping {
            if ch == ')' || ch == ' ' {
                skipping = false;
                out.push(ch);
            }
            continue;
        }
        if ch == '?' {
            skipping = true;
            continue;
        }
        out.push(ch);
        if out.len() >= 400 {
            out.push('…');
            break;
        }
    }
    out
}

/// Classify any error of this crate (see [`ErrorKind`] for the meaning of each class).
pub fn classify(error: &XError) -> ErrorInfo {
    let table = &*TABLE;
    let base = |kind: ErrorKind| ErrorInfo {
        message: redact_url(&error.to_string()),
        kind,
        code: None,
        status: None,
        reset_epoch: None,
        retry_safe: false,
    };
    match error {
        XError::Api { code, message } => {
            if let Some(status) = error.http_status() {
                let kind = if table.auth_statuses.contains(&status) {
                    ErrorKind::Auth
                } else if table.terminal_statuses.contains(&status) {
                    ErrorKind::Terminal
                } else if table.rate_limit_statuses.contains(&status) {
                    ErrorKind::RateLimit
                } else if table.transient_statuses.contains(&status) || status >= 500 {
                    ErrorKind::Transient
                } else {
                    ErrorKind::Other
                };
                return ErrorInfo {
                    message: message.clone(),
                    status: Some(status),
                    retry_safe: kind == ErrorKind::RateLimit,
                    ..base(kind)
                };
            }
            let code = *code;
            let kind = if table.auth_codes.contains(&code) {
                ErrorKind::Auth
            } else if table.terminal_codes.contains(&code) {
                ErrorKind::Terminal
            } else if table.rate_limit_codes.contains(&code)
                || table.daily_limit_codes.contains(&code)
            {
                ErrorKind::RateLimit
            } else if table.csrf_codes.contains(&code) {
                ErrorKind::Transient
            } else {
                ErrorKind::Other
            };
            ErrorInfo {
                message: error.to_string(),
                code: Some(code),
                retry_safe: matches!(kind, ErrorKind::RateLimit)
                    || table.csrf_codes.contains(&code),
                ..base(kind)
            }
        },
        XError::RateLimited { reset_epoch } => ErrorInfo {
            reset_epoch: Some(*reset_epoch),
            retry_safe: true,
            ..base(ErrorKind::RateLimit)
        },
        XError::Http(source) => {
            if source.is_builder() {
                base(ErrorKind::Invalid)
            } else if source.is_redirect() {
                base(ErrorKind::Other)
            } else {
                // A refused connection never reached the server; a timeout or a reset may have.
                let message = if source.is_timeout() {
                    "request timed out".to_owned()
                } else {
                    redact_url(&error.to_string())
                };
                ErrorInfo { message, retry_safe: source.is_connect(), ..base(ErrorKind::Transient) }
            }
        },
        XError::Invalid(_)
        | XError::UnknownOperation(_)
        | XError::Auth(_)
        | XError::Json(_)
        | XError::Io(_) => base(ErrorKind::Invalid),
        XError::Db(_) => base(ErrorKind::Other),
    }
}

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

/// How an operation is retried and how long it may wait.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct RetryPolicy {
    /// Retries after the first attempt for `transient` and `other` failures.
    pub max_retries: u32,
    /// First backoff, in milliseconds; doubled at each retry.
    pub base_ms: u64,
    /// Upper bound of one backoff, in milliseconds.
    pub max_backoff_ms: u64,
    /// Relative jitter (0.2 = plus or minus 20 %).
    pub jitter: f64,
    /// Consecutive rate-limit waits tolerated before the failure is reported.
    pub max_rate_limit_waits: u32,
    /// Longest single wait for a rate limit, in seconds; longer windows are reported instead.
    pub max_wait_secs: u64,
    /// Margin added to a wait for a window reset, in milliseconds (the reset epoch can be ahead of
    /// the local clock).
    pub rate_limit_margin_ms: u64,
    /// Also retry operations that are not idempotent after an ambiguous failure (a timeout may have
    /// created the post): off by default.
    pub retry_non_idempotent: bool,
    /// Wait out rate limits for mutating operations too. Unset: batches wait, a single mutating
    /// call reports the throttle so that a caller with its own governor (the purge engine) keeps
    /// control.
    pub wait_rate_limit_mutations: Option<bool>,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 3,
            base_ms: 1_000,
            max_backoff_ms: 30_000,
            jitter: 0.2,
            max_rate_limit_waits: 6,
            max_wait_secs: 900,
            rate_limit_margin_ms: 1_000,
            retry_non_idempotent: false,
            wait_rate_limit_mutations: None,
        }
    }
}

impl RetryPolicy {
    /// Backoff before retry number `retry` (1-based); `unit` in `0..=1` places the jitter.
    pub fn backoff(&self, retry: u32, unit: f64) -> Duration {
        let doublings = retry.saturating_sub(1).min(20);
        let exponential = self.base_ms.saturating_mul(1u64 << doublings).min(self.max_backoff_ms);
        let spread = exponential as f64 * self.jitter.clamp(0.0, 1.0);
        let milliseconds = exponential as f64 + spread * (2.0 * unit.clamp(0.0, 1.0) - 1.0);
        Duration::from_millis(milliseconds.max(0.0) as u64)
    }

    /// How long to wait for a rate limit: until the reset epoch (already past: no wait) plus the
    /// margin, or a full 15-minute window when the reset is unknown.
    pub fn rate_limit_wait(&self, info: &ErrorInfo, now_epoch: i64) -> Duration {
        match info.reset_epoch {
            Some(reset) => {
                let seconds = (reset - now_epoch).max(0) as u64;
                Duration::from_secs(seconds) + Duration::from_millis(self.rate_limit_margin_ms)
            },
            None => Duration::from_secs(15 * 60),
        }
    }

    /// Whether a failure is worth another attempt.
    pub fn should_retry(&self, info: &ErrorInfo, idempotent: bool, retries_done: u32) -> bool {
        matches!(info.kind, ErrorKind::Transient | ErrorKind::Other)
            && retries_done < self.max_retries
            && (idempotent || info.retry_safe || self.retry_non_idempotent)
    }
}

/// A uniform value in `0..1` (jitter placement); not cryptographic.
pub fn jitter01() -> f64 {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    (RandomState::new().hash_one(n) >> 11) as f64 / (1u64 << 53) as f64
}

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

/// The rolling window X thinks in (15 minutes), in milliseconds.
pub const WINDOW_MS: i64 = 15 * 60 * 1000;
/// The rolling day budget window, in milliseconds.
pub const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// Pacing knobs for mutating operations. Defaults are conservative, well under observed ceilings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PacingOptions {
    /// Mutations allowed per rolling 15 minutes.
    pub per_window: usize,
    /// Mutations allowed per rolling 24 hours.
    pub per_day: usize,
    /// Shortest delay between two mutations, in milliseconds.
    pub min_delay_ms: u64,
    /// Longest delay between two mutations (the delay is drawn between min and max).
    pub max_delay_ms: u64,
    /// Calls the server says remain in the window that we leave unused before waiting for the reset.
    pub reserve: i64,
}

impl Default for PacingOptions {
    fn default() -> Self {
        Self { per_window: 45, per_day: 400, min_delay_ms: 4_000, max_delay_ms: 11_000, reserve: 2 }
    }
}

/// The pacing state machine, free of clocks and sleeps so it can be tested exactly. Times are epoch
/// milliseconds supplied by the caller.
#[derive(Debug, Clone)]
pub struct PacerState {
    options: PacingOptions,
    /// Epoch ms of every mutation, oldest first.
    history: VecDeque<i64>,
    last_call_at: i64,
    header_wait_until: i64,
}

impl PacerState {
    /// A fresh state; `history` seeds the rolling budgets (a resumed run).
    pub fn new(mut options: PacingOptions, history: Vec<i64>) -> Self {
        options.max_delay_ms = options.max_delay_ms.max(options.min_delay_ms);
        Self { options, history: history.into(), last_call_at: 0, header_wait_until: 0 }
    }

    /// Mutation timestamps still inside the day window.
    pub fn timestamps(&self) -> Vec<i64> {
        self.history.iter().copied().collect()
    }

    fn prune(&mut self, now: i64) {
        let cutoff = now - DAY_MS;
        while self.history.front().is_some_and(|t| *t <= cutoff) {
            self.history.pop_front();
        }
    }

    fn count_since(&self, now: i64, ms: i64) -> usize {
        let cutoff = now - ms;
        self.history.iter().filter(|t| **t > cutoff).count()
    }

    /// How long the next mutation must wait: `(milliseconds, reason)`, `0` meaning "go now".
    /// `unit` in `0..=1` places the randomised pace delay.
    pub fn delay_before_next(&mut self, now: i64, unit: f64) -> (i64, &'static str) {
        self.prune(now);

        let header_wait = self.header_wait_until - now;
        if header_wait > 0 {
            return (header_wait, "x-rate-limit-reset");
        }

        if self.count_since(now, DAY_MS) >= self.options.per_day {
            let oldest = self
                .history
                .len()
                .checked_sub(self.options.per_day)
                .and_then(|index| self.history.get(index))
                .copied()
                .unwrap_or(now);
            return ((oldest + DAY_MS - now).max(0) + 1_000, "day-budget");
        }

        if self.count_since(now, WINDOW_MS) >= self.options.per_window {
            let in_window: Vec<i64> =
                self.history.iter().copied().filter(|t| *t > now - WINDOW_MS).collect();
            let oldest = in_window
                .len()
                .checked_sub(self.options.per_window)
                .and_then(|index| in_window.get(index))
                .copied()
                .unwrap_or(now);
            return ((oldest + WINDOW_MS - now).max(0) + 1_000, "window-budget");
        }

        let span = (self.options.max_delay_ms - self.options.min_delay_ms) as f64;
        let drawn = (unit.clamp(0.0, 1.0) * (span + 1.0)).floor().min(span);
        let jitter = self.options.min_delay_ms as f64 + drawn;
        let since_last = (now - self.last_call_at) as f64;
        let wait = if self.last_call_at == 0 { 0 } else { (jitter - since_last).max(0.0) as i64 };
        (wait, "pace")
    }

    /// Reserve the slot of a mutation about to be sent (counted at dispatch: concurrent calls must
    /// not all see the same free budget).
    pub fn reserve(&mut self, now: i64) {
        self.history.push_back(now);
        self.last_call_at = now;
        self.prune(now);
    }

    /// Fold in what the server reported after a call: when few calls remain in the window, wait for
    /// the reset.
    pub fn observe(&mut self, now: i64, rate_limit: Option<RateLimit>) {
        if let Some(rl) = rate_limit
            && rl.remaining <= self.options.reserve
            && rl.reset_epoch > 0
        {
            let reset_ms = rl.reset_epoch * 1000;
            if reset_ms > now {
                self.header_wait_until = reset_ms + 1_000;
            }
        }
    }

    /// Force a wait after a throttle (until the reset when known, else a full window); returns the
    /// wait in milliseconds.
    pub fn penalise(&mut self, now: i64, rate_limit: Option<RateLimit>) -> i64 {
        let reset_ms = rate_limit.map_or(0, |rl| rl.reset_epoch * 1000);
        let until = if reset_ms > now { reset_ms + 1_000 } else { now + WINDOW_MS };
        self.header_wait_until = self.header_wait_until.max(until);
        until - now
    }

    /// Whether either rolling budget is saturated right now.
    pub fn budget_exhausted(&mut self, now: i64) -> bool {
        self.prune(now);
        self.count_since(now, WINDOW_MS) >= self.options.per_window
            || self.count_since(now, DAY_MS) >= self.options.per_day
    }
}

/// A shareable pacer: concurrent tasks acquire mutation slots one at a time.
#[derive(Debug)]
pub struct Pacer {
    state: Mutex<PacerState>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl Pacer {
    /// A pacer with `options`.
    pub fn new(options: PacingOptions) -> Self {
        Self { state: Mutex::new(PacerState::new(options, Vec::new())) }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, PacerState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Wait until a mutation may go out and reserve its slot. Returns the reason of the last wait
    /// when it was a budget wait (`"window-budget"`, `"day-budget"`, `"x-rate-limit-reset"`).
    pub async fn acquire(&self) -> Option<&'static str> {
        let mut budget_reason = None;
        // Re-check after each sleep: a long header wait can expose a budget wait.
        for _ in 0..64 {
            let (wait, reason) = {
                let mut state = self.lock();
                let now = now_ms();
                let (wait, reason) = state.delay_before_next(now, jitter01());
                if wait <= 0 {
                    state.reserve(now);
                    return budget_reason;
                }
                (wait, reason)
            };
            if reason != "pace" {
                budget_reason = Some(reason);
            }
            tokio::time::sleep(Duration::from_millis(wait as u64)).await;
        }
        let mut state = self.lock();
        state.reserve(now_ms());
        budget_reason
    }

    /// Number of mutations currently counted in the rolling budgets.
    pub fn reserved(&self) -> usize {
        self.lock().history.len()
    }

    /// Fold in the rate limit observed after a call.
    pub fn observe(&self, rate_limit: Option<RateLimit>) {
        self.lock().observe(now_ms(), rate_limit);
    }

    /// Back off after a throttle; returns the wait in milliseconds.
    pub fn penalise(&self, rate_limit: Option<RateLimit>) -> i64 {
        self.lock().penalise(now_ms(), rate_limit)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn api(code: i64, message: &str) -> XError {
        XError::Api { code, message: message.to_owned() }
    }

    fn kind(error: &XError) -> ErrorKind {
        classify(error).kind
    }

    #[test]
    fn auth_codes_and_statuses_are_auth() {
        for code in [32, 89, 99, 215] {
            assert_eq!(kind(&api(code, "x")), ErrorKind::Auth, "code {code}");
        }
        assert_eq!(kind(&api(401, "HTTP 401 Unauthorized")), ErrorKind::Auth);
        assert_eq!(kind(&api(403, "HTTP 403 Forbidden")), ErrorKind::Auth);
    }

    #[test]
    fn terminal_codes_and_404_are_terminal() {
        for code in [34, 50, 63, 108, 139, 144, 162, 179, 187, 220, 327, 425] {
            assert_eq!(kind(&api(code, "x")), ErrorKind::Terminal, "code {code}");
        }
        assert_eq!(kind(&api(404, "HTTP 404 Not Found")), ErrorKind::Terminal);
    }

    #[test]
    fn throttles_are_rate_limit_whether_code_or_status() {
        assert_eq!(kind(&api(88, "Rate limit exceeded")), ErrorKind::RateLimit);
        assert_eq!(kind(&api(344, "daily limit")), ErrorKind::RateLimit);
        assert_eq!(kind(&api(429, "HTTP 429 Too Many Requests")), ErrorKind::RateLimit);
        let info = classify(&XError::RateLimited { reset_epoch: 42 });
        assert_eq!((info.kind, info.reset_epoch), (ErrorKind::RateLimit, Some(42)));
        assert!(info.retry_safe);
    }

    #[test]
    fn server_errors_are_transient() {
        for status in [500, 502, 503, 504, 408, 599] {
            assert_eq!(kind(&api(status, "HTTP x")), ErrorKind::Transient, "status {status}");
        }
        let info = classify(&api(353, "csrf mismatch"));
        assert_eq!(info.kind, ErrorKind::Transient);
        assert!(info.retry_safe, "a CSRF rejection never reached the handler");
    }

    #[test]
    fn a_numeric_x_code_is_not_mistaken_for_an_http_status() {
        // 404 as an X code (no "HTTP " prefix) is a code, 344 is the daily cap, not a status.
        assert_eq!(classify(&api(344, "limit")).status, None);
        assert_eq!(classify(&api(503, "HTTP 503 Service Unavailable")).status, Some(503));
    }

    #[test]
    fn argument_and_local_failures_are_invalid() {
        assert_eq!(kind(&XError::Invalid("bad".into())), ErrorKind::Invalid);
        assert_eq!(kind(&XError::UnknownOperation("Nope".into())), ErrorKind::Invalid);
        assert_eq!(kind(&XError::Auth("no credentials".into())), ErrorKind::Invalid);
        assert!(ErrorKind::Invalid.is_final() && ErrorKind::Terminal.is_final());
        assert!(!ErrorKind::RateLimit.is_final() && !ErrorKind::Auth.is_final());
    }

    #[test]
    fn unknown_x_codes_are_other() {
        assert_eq!(kind(&api(226, "looks automated")), ErrorKind::Other);
    }

    #[test]
    fn urls_lose_their_query_in_messages() {
        let msg = "error sending request for url (https://x.com/i/api/graphql/q/Op?variables=%7B%7D&features=%7B%7D)";
        let shown = redact_url(msg);
        assert!(!shown.contains("variables"), "{shown}");
        assert!(shown.contains("https://x.com/i/api/graphql/q/Op"), "{shown}");
        assert!(shown.ends_with(')'), "{shown}");
    }

    #[test]
    fn the_shared_json_is_the_documented_shape() {
        let table = policy_json();
        for key in [
            "auth_codes",
            "auth_statuses",
            "terminal_codes",
            "terminal_statuses",
            "rate_limit_codes",
            "rate_limit_statuses",
            "daily_limit_codes",
            "transient_statuses",
            "csrf_codes",
        ] {
            assert!(table[key].is_array(), "{key}");
        }
        // Every table entry is classified as the table says (no code listed under two classes).
        let mut seen = std::collections::HashSet::new();
        for key in
            ["auth_codes", "terminal_codes", "rate_limit_codes", "daily_limit_codes", "csrf_codes"]
        {
            for code in table[key].as_array().unwrap() {
                assert!(seen.insert(code.as_i64().unwrap()), "code listed twice: {code}");
            }
        }
    }

    #[test]
    fn backoff_doubles_is_capped_and_jitters_symmetrically() {
        let policy = RetryPolicy { jitter: 0.0, ..RetryPolicy::default() };
        assert_eq!(policy.backoff(1, 0.5), Duration::from_millis(1_000));
        assert_eq!(policy.backoff(2, 0.5), Duration::from_millis(2_000));
        assert_eq!(policy.backoff(3, 0.5), Duration::from_millis(4_000));
        assert_eq!(policy.backoff(40, 0.5), Duration::from_millis(30_000), "capped");

        let jittery = RetryPolicy { jitter: 0.2, ..RetryPolicy::default() };
        assert_eq!(jittery.backoff(1, 0.0), Duration::from_millis(800));
        assert_eq!(jittery.backoff(1, 1.0), Duration::from_millis(1_200));
        assert_eq!(jittery.backoff(1, 0.5), Duration::from_millis(1_000));
    }

    #[test]
    fn rate_limit_wait_follows_the_reset_or_a_full_window() {
        let policy = RetryPolicy::default();
        let mut info = ErrorInfo::invalid("x");
        info.kind = ErrorKind::RateLimit;
        info.reset_epoch = Some(1_000);
        assert_eq!(policy.rate_limit_wait(&info, 900), Duration::from_secs(101));
        assert_eq!(
            policy.rate_limit_wait(&info, 2_000),
            Duration::from_millis(1_000),
            "the window already reopened: only the margin"
        );
        assert_eq!(
            RetryPolicy { rate_limit_margin_ms: 0, ..RetryPolicy::default() }
                .rate_limit_wait(&info, 1_000),
            Duration::ZERO
        );
        info.reset_epoch = None;
        assert_eq!(policy.rate_limit_wait(&info, 900), Duration::from_secs(900));
    }

    #[test]
    fn retries_need_a_retriable_kind_budget_and_safety() {
        let policy = RetryPolicy::default();
        let transient = classify(&api(503, "HTTP 503"));
        assert!(policy.should_retry(&transient, true, 0));
        assert!(policy.should_retry(&transient, true, 2));
        assert!(!policy.should_retry(&transient, true, 3), "budget spent");
        assert!(!policy.should_retry(&transient, false, 0), "a post must not be sent twice");
        assert!(
            RetryPolicy { retry_non_idempotent: true, ..policy.clone() }
                .should_retry(&transient, false, 0)
        );
        let csrf = classify(&api(353, "csrf"));
        assert!(policy.should_retry(&csrf, false, 0), "a pre-handler rejection is always safe");
        for fatal in [api(32, "x"), api(144, "x"), api(88, "x")] {
            assert!(!policy.should_retry(&classify(&fatal), true, 0));
        }
    }

    #[test]
    fn jitter_is_a_unit_interval_and_varies() {
        let draws: Vec<f64> = (0..64).map(|_| jitter01()).collect();
        assert!(draws.iter().all(|d| (0.0..1.0).contains(d)));
        assert!(draws.windows(2).any(|w| w[0] != w[1]));
    }

    // ---- pacing ----------------------------------------------------------

    fn pacer(per_window: usize, per_day: usize) -> PacerState {
        PacerState::new(
            PacingOptions {
                per_window,
                per_day,
                min_delay_ms: 1_000,
                max_delay_ms: 1_000,
                reserve: 2,
            },
            Vec::new(),
        )
    }

    #[test]
    fn the_first_call_goes_immediately_then_the_pace_delay_applies() {
        let mut p = pacer(10, 100);
        assert_eq!(p.delay_before_next(10_000, 0.5), (0, "pace"));
        p.reserve(10_000);
        assert_eq!(p.delay_before_next(10_400, 0.5), (600, "pace"));
        assert_eq!(p.delay_before_next(11_500, 0.5), (0, "pace"));
    }

    #[test]
    fn the_window_budget_waits_for_the_oldest_slot_to_expire() {
        let mut p = pacer(2, 100);
        p.reserve(1_000_000);
        p.reserve(1_001_000);
        let (wait, reason) = p.delay_before_next(1_002_000, 0.0);
        assert_eq!(reason, "window-budget");
        // The oldest of the two in-window calls leaves the window at 1_000_000 + 15 min, plus 1 s.
        assert_eq!(wait, 1_000_000 + WINDOW_MS - 1_002_000 + 1_000);
        // Once it has expired, one slot is free again.
        let (wait, reason) = p.delay_before_next(1_000_000 + WINDOW_MS + 500, 0.0);
        assert_eq!(reason, "pace");
        assert!(wait <= 1_000);
    }

    #[test]
    fn the_day_budget_outranks_the_window_budget() {
        let mut p = pacer(50, 2);
        p.reserve(5_000_000);
        p.reserve(5_001_000);
        let (wait, reason) = p.delay_before_next(5_002_000, 0.0);
        assert_eq!(reason, "day-budget");
        assert_eq!(wait, 5_000_000 + DAY_MS - 5_002_000 + 1_000);
    }

    #[test]
    fn a_zero_budget_waits_a_full_window_from_now_instead_of_panicking() {
        let mut p = pacer(0, 0);
        let (wait, reason) = p.delay_before_next(1_000, 0.0);
        assert_eq!(reason, "day-budget");
        assert_eq!(wait, DAY_MS + 1_000);
    }

    #[test]
    fn low_remaining_calls_in_the_header_force_a_wait_for_the_reset() {
        let mut p = pacer(100, 1000);
        p.reserve(10_000_000);
        p.observe(10_000_000, Some(RateLimit { limit: 50, remaining: 2, reset_epoch: 10_300 }));
        let (wait, reason) = p.delay_before_next(10_000_500, 0.0);
        assert_eq!(reason, "x-rate-limit-reset");
        assert_eq!(wait, 10_300_000 + 1_000 - 10_000_500);
        // Plenty remaining: no header wait.
        let mut q = pacer(100, 1000);
        q.observe(0, Some(RateLimit { limit: 50, remaining: 40, reset_epoch: 10_300 }));
        assert_eq!(q.delay_before_next(1, 0.0).1, "pace");
    }

    #[test]
    fn penalise_waits_until_the_reset_or_a_full_window() {
        let mut p = pacer(100, 1000);
        assert_eq!(
            p.penalise(1_000, Some(RateLimit { limit: 1, remaining: 0, reset_epoch: 31 })),
            31_000
        );
        let mut q = pacer(100, 1000);
        assert_eq!(q.penalise(1_000, None), WINDOW_MS);
        // A shorter penalty reports its own wait but never shortens the one already in force.
        assert_eq!(
            q.penalise(1_000, Some(RateLimit { limit: 1, remaining: 0, reset_epoch: 2 })),
            2_000
        );
        assert_eq!(q.delay_before_next(1_000, 0.0), (WINDOW_MS, "x-rate-limit-reset"));
    }

    #[test]
    fn history_older_than_a_day_is_forgotten() {
        let mut p = PacerState::new(PacingOptions::default(), vec![1, 2, 3]);
        assert!(!p.budget_exhausted(DAY_MS + 10));
        assert!(p.timestamps().is_empty());
    }

    #[tokio::test]
    async fn acquire_returns_at_once_on_a_fresh_pacer() {
        let pacer = Pacer::new(PacingOptions::default());
        let started = std::time::Instant::now();
        assert_eq!(pacer.acquire().await, None);
        assert!(started.elapsed() < Duration::from_millis(500));
    }
}
