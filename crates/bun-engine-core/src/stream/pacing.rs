//! Frame-age drop policy and present-mode preference.
//!
//! Absorbed from tether (`crates/tether-render/src/present_policy.rs`, MIT, Copyright (c) 2026
//! Nick Chapman). The renderer pulls the newest decoded frame on every redraw; a frame older than
//! 1.5x the refresh period, two times in a row, is skipped (with a cooldown) instead of spending a
//! refresh slot on stale content.

use aphrody_gpu_backend::wgpu;

/// Refresh rate used when the monitor does not report one.
pub const REFRESH_RATE_FALLBACK_HZ: u32 = 60;
/// Late threshold as N/2 refresh periods (3/2 = 1.5x).
pub const FRAME_AGE_THRESHOLD_FACTOR: u32 = 3;
/// Consecutive late frames before skipping.
pub const LATE_STREAK_THRESHOLD: u32 = 2;
/// Presents allowed after a skip before the next skip.
pub const SKIP_COOLDOWN_FRAMES: u32 = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum PresentPolicy {
    /// `Immediate > Mailbox > Fifo`: lowest head-of-line latency (may tear).
    #[default]
    LowLatency,
    /// `Fifo > Mailbox > Immediate`: every frame commits to a refresh slot.
    Smooth,
}

impl PresentPolicy {
    pub fn preference(self) -> [wgpu::PresentMode; 3] {
        match self {
            Self::LowLatency => [wgpu::PresentMode::Immediate, wgpu::PresentMode::Mailbox, wgpu::PresentMode::Fifo],
            Self::Smooth => [wgpu::PresentMode::Fifo, wgpu::PresentMode::Mailbox, wgpu::PresentMode::Immediate],
        }
    }
}

#[derive(Default, Debug, Clone, Copy)]
pub struct FrameAgeTracker {
    pub late_streak: u32,
    pub cooldown_remaining: u32,
    pub drops: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PresentDecision {
    Render,
    Skip,
}

/// Decide whether to render a frame `frame_age_ns` old at `refresh_rate_mhz`.
pub fn decide_present(frame_age_ns: u64, refresh_rate_mhz: u32, tracker: &mut FrameAgeTracker) -> PresentDecision {
    let threshold_ns = refresh_period_ns(refresh_rate_mhz).saturating_mul(u64::from(FRAME_AGE_THRESHOLD_FACTOR)) / 2;
    let is_late = frame_age_ns > threshold_ns;
    if tracker.cooldown_remaining > 0 {
        tracker.cooldown_remaining -= 1;
    }
    if !is_late {
        tracker.late_streak = 0;
        return PresentDecision::Render;
    }
    tracker.late_streak = tracker.late_streak.saturating_add(1);
    if tracker.late_streak >= LATE_STREAK_THRESHOLD && tracker.cooldown_remaining == 0 {
        tracker.cooldown_remaining = SKIP_COOLDOWN_FRAMES;
        tracker.drops += 1;
        tracker.late_streak = 0;
        PresentDecision::Skip
    } else {
        PresentDecision::Render
    }
}

/// Refresh period in nanoseconds for a millihertz rate.
pub fn refresh_period_ns(refresh_rate_mhz: u32) -> u64 {
    let rate = if refresh_rate_mhz == 0 { REFRESH_RATE_FALLBACK_HZ * 1000 } else { refresh_rate_mhz };
    1_000_000_000_000u64 / u64::from(rate)
}
