// SPDX-License-Identifier: Apache-2.0
//! Sessions: COSMIC workspaces recast for a console. Each workspace is a game session (a Bun
//! Engine machine, an emulator process, a Steam game) or a stream (Moonlight/GameStream client,
//! play.aphrody.app WebRTC), shown in a switcher (the workspaces overview) with its last frame.
//!
//! One session is active; the others are suspended (machine state in memory or on disk, external
//! processes minimized) up to a limit, after which the oldest unpinned one ends so the host can
//! free its state.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum SessionKind {
    /// Bun Engine machine inside the shell (`system`: nes, gba, nds, psx, ...).
    Machine {
        system: String,
    },
    /// Release emulator or RetroArch owned by the shell (`bun-engine library command <id>`).
    Emulator {
        command: String,
    },
    Steam {
        app_id: u32,
    },
    /// Remote game stream (Moonlight host or play.aphrody.app peer).
    Stream {
        host: String,
    },
    /// Web core in a browser.
    Web {
        url: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionState {
    Running,
    Suspended,
    Ended,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// Library key (`steam:<appid>`, `bep:<md5>`, `stream:<host>`).
    pub id: String,
    pub kind: SessionKind,
    pub title: String,
    #[serde(default)]
    pub art: Option<PathBuf>,
    /// Last presented frame (PNG) shown in the switcher.
    #[serde(default)]
    pub last_frame: Option<PathBuf>,
    pub state: SessionState,
    /// Monotonic activity counter (higher = more recent).
    #[serde(default)]
    pub last_active: u64,
    #[serde(default)]
    pub pinned: bool,
}

/// Change the host must apply.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Transition {
    Suspend(String),
    Resume(String),
    Start(String),
    End(String),
}

#[derive(Clone, Debug)]
#[cfg_attr(feature = "bevy", derive(bevy_ecs::resource::Resource))]
pub struct Workspaces {
    sessions: Vec<Session>,
    active: Option<String>,
    clock: u64,
    /// Suspended sessions kept before the oldest unpinned one ends.
    pub max_suspended: usize,
}

impl Workspaces {
    pub fn new(max_suspended: usize) -> Self {
        Self {
            sessions: Vec::new(),
            active: None,
            clock: 0,
            max_suspended,
        }
    }

    pub fn active(&self) -> Option<&Session> {
        let id = self.active.as_deref()?;
        self.sessions.iter().find(|s| s.id == id)
    }

    fn tick(&mut self) -> u64 {
        self.clock += 1;
        self.clock
    }

    /// Open (or resume) `session` and make it active; returns the transitions in order.
    pub fn open(&mut self, mut session: Session) -> Vec<Transition> {
        let mut out = self.suspend_active();
        let now = self.tick();
        let resumed = match self.sessions.iter_mut().find(|s| s.id == session.id) {
            Some(existing) => {
                let resume = existing.state == SessionState::Suspended;
                existing.state = SessionState::Running;
                existing.last_active = now;
                resume
            }
            None => {
                session.state = SessionState::Running;
                session.last_active = now;
                self.sessions.push(session.clone());
                false
            }
        };
        out.push(if resumed {
            Transition::Resume(session.id.clone())
        } else {
            Transition::Start(session.id.clone())
        });
        self.active = Some(session.id);
        out.extend(self.enforce_limit());
        out
    }

    /// Activate an existing session from the switcher.
    pub fn activate(&mut self, id: &str) -> Vec<Transition> {
        match self
            .sessions
            .iter()
            .find(|s| s.id == id && s.state != SessionState::Ended)
            .cloned()
        {
            Some(session) => self.open(session),
            None => Vec::new(),
        }
    }

    /// Suspend the active session (Home, overlay, another launch).
    pub fn suspend_active(&mut self) -> Vec<Transition> {
        let Some(id) = self.active.take() else {
            return Vec::new();
        };
        match self.sessions.iter_mut().find(|s| s.id == id) {
            Some(s) if s.state == SessionState::Running => {
                s.state = SessionState::Suspended;
                vec![Transition::Suspend(id)]
            }
            _ => Vec::new(),
        }
    }

    /// End a session (Close game); it leaves the switcher.
    pub fn close(&mut self, id: &str) -> Vec<Transition> {
        if self.active.as_deref() == Some(id) {
            self.active = None;
        }
        let before = self.sessions.len();
        self.sessions.retain(|s| s.id != id);
        if self.sessions.len() == before {
            Vec::new()
        } else {
            vec![Transition::End(id.to_string())]
        }
    }

    pub fn set_last_frame(&mut self, id: &str, frame: PathBuf) {
        if let Some(s) = self.sessions.iter_mut().find(|s| s.id == id) {
            s.last_frame = Some(frame);
        }
    }

    pub fn pin(&mut self, id: &str, pinned: bool) {
        if let Some(s) = self.sessions.iter_mut().find(|s| s.id == id) {
            s.pinned = pinned;
        }
    }

    fn enforce_limit(&mut self) -> Vec<Transition> {
        let mut out = Vec::new();
        loop {
            let suspended = self
                .sessions
                .iter()
                .filter(|s| s.state == SessionState::Suspended)
                .count();
            if suspended <= self.max_suspended {
                break;
            }
            let Some(oldest) = self
                .sessions
                .iter()
                .filter(|s| s.state == SessionState::Suspended && !s.pinned)
                .min_by_key(|s| s.last_active)
                .map(|s| s.id.clone())
            else {
                break;
            };
            out.extend(self.close(&oldest));
        }
        out
    }

    /// Switcher order: active first, then pinned, then most recent.
    pub fn ordered(&self) -> Vec<&Session> {
        let mut out: Vec<&Session> = self.sessions.iter().collect();
        let active = self.active.as_deref();
        out.sort_by(|a, b| {
            (Some(b.id.as_str()) == active)
                .cmp(&(Some(a.id.as_str()) == active))
                .then_with(|| b.pinned.cmp(&a.pinned))
                .then_with(|| b.last_active.cmp(&a.last_active))
        });
        out
    }

    /// Next/previous session in switcher order (LB/RB in the overview).
    pub fn cycle(&self, from: &str, forward: bool) -> Option<&Session> {
        let order = self.ordered();
        let at = order.iter().position(|s| s.id == from)?;
        let n = order.len();
        let next = if forward {
            (at + 1) % n
        } else {
            (at + n - 1) % n
        };
        order.get(next).copied()
    }
}
