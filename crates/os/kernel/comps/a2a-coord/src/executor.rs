// SPDX-License-Identifier: Apache-2.0
//! A2A 1.0 [`AgentExecutor`] — routes `SendMessage` to native coding peers and web search.

use std::{collections::HashMap, sync::Arc};

use aphrody_a2a::{
    A2AError, Artifact, Message, Part, Role, StreamResponse, Task, TaskState, TaskStatus,
};
use aphrody_a2a_server::{AgentExecutor, ExecutorContext};
use futures::StreamExt;
use futures::stream::{self, BoxStream};
use serde_json::Value;

use crate::{
    envelope::{Envelope, EnvelopeKind},
    mailbox::Mailbox,
    manifest::AiManifest,
    peer::{PeerError, PeerId, PeerInvokeResult, PeerInvoker},
};

pub(crate) fn failed_task(mut task: Task, reason: &'static str) -> Task {
    task.status = TaskStatus {
        state: TaskState::Failed,
        message: Some(Message::new(
            Role::Agent,
            vec![Part::text(format!("Native peer execution failed ({reason})."))],
        )),
        timestamp: Some(chrono::Utc::now()),
    };
    task
}

fn invocation_result(
    result: Result<Result<PeerInvokeResult, PeerError>, tokio::task::JoinError>,
) -> Result<PeerInvokeResult, &'static str> {
    match result {
        Ok(Ok(result)) => Ok(result),
        Err(_) => Err("launcher task failed"),
        Ok(Err(PeerError::UnknownPeer(_))) => Err("unsupported peer"),
        Ok(Err(PeerError::InvalidDomain(_))) => Err("invalid domain configuration"),
        Ok(Err(PeerError::BinaryNotFound(_))) => Err("peer executable unavailable"),
        Ok(Err(PeerError::Io(_))) => Err("launcher I/O failure"),
        Ok(Err(PeerError::BranchMismatch { .. })) => Err("shared checkout branch mismatch"),
        Ok(Err(PeerError::Utf8(_))) => Err("invalid peer output encoding"),
    }
}

pub(crate) fn configured_default_peer(value: Option<&str>) -> Result<PeerId, PeerError> {
    match value {
        None => Ok(PeerId::Grok),
        Some(value) => {
            PeerId::parse(value.trim()).ok_or_else(|| PeerError::UnknownPeer(value.to_owned()))
        },
    }
}

pub(crate) fn default_peer_from_env() -> Result<PeerId, PeerError> {
    configured_default_peer(std::env::var("APHRODY_A2A_DEFAULT_PEER").ok().as_deref())
}

/// Routes inbound A2A messages to [`PeerInvoker`] and mirrors activity into JSONL mailboxes.
pub struct CoordPeerExecutor {
    manifest: Arc<AiManifest>,
    invoker: PeerInvoker,
    mailbox: Mailbox,
    default_peer: PeerId,
}

impl CoordPeerExecutor {
    pub fn new(manifest: AiManifest, repo_root: std::path::PathBuf, dry_run: bool) -> Self {
        let coord_dir = manifest.coord_dir(&repo_root);
        Self::new_with_mailbox(manifest, repo_root, Mailbox::new(coord_dir), dry_run)
    }

    /// Build an executor whose A2A audit mailbox is isolated to one profile.
    #[must_use]
    pub fn for_profile(
        manifest: AiManifest,
        repo_root: std::path::PathBuf,
        profile_root: &std::path::Path,
        dry_run: bool,
    ) -> Self {
        Self::new_with_mailbox(
            manifest,
            repo_root,
            Mailbox::for_profile_root(profile_root),
            dry_run,
        )
    }

    pub(crate) fn new_with_mailbox(
        manifest: AiManifest,
        repo_root: std::path::PathBuf,
        mailbox: Mailbox,
        dry_run: bool,
    ) -> Self {
        let invoker = PeerInvoker::new(&repo_root).with_dry_run(dry_run);
        Self { manifest: Arc::new(manifest), invoker, mailbox, default_peer: PeerId::Grok }
    }

    #[must_use]
    pub fn with_default_peer(mut self, peer: PeerId) -> Self {
        self.default_peer = peer;
        self
    }

    fn resolve_peer(&self, ctx: &ExecutorContext) -> PeerId {
        if let Some(meta) = &ctx.metadata
            && let Some(p) = meta.get("aphrody_peer").or(meta.get("peer"))
            && let Some(s) = p.as_str()
            && let Some(id) = PeerId::parse(s)
        {
            return id;
        }
        if let Some(msg) = &ctx.message
            && let Some(text) = msg.text()
            && let Some(peer) = parse_peer_prefix(text)
        {
            return peer;
        }
        self.default_peer
    }

    fn prompt_from_message(&self, ctx: &ExecutorContext) -> String {
        let Some(msg) = &ctx.message else {
            return String::new();
        };
        let text = msg.text().unwrap_or("").to_owned();
        let t = text.trim();
        if parse_peer_prefix(t).is_none() {
            return text;
        }
        if let Some(rest) = t.strip_prefix('@') {
            let after = rest.trim_start();
            if let Some((_, body)) = after.split_once(':') {
                return body.trim().to_owned();
            }
            if let Some(idx) = after.find(char::is_whitespace) {
                return after[idx..].trim().to_owned();
            }
            return String::new();
        }
        if let Some(rest) = t.strip_prefix("/peer ")
            && let Some((_, body)) = rest.split_once(' ')
        {
            return body.trim().to_owned();
        }
        text
    }
}

fn parse_peer_prefix(text: &str) -> Option<PeerId> {
    let t = text.trim();
    if let Some(rest) = t.strip_prefix('@') {
        let word = rest.split_whitespace().next()?;
        return PeerId::parse(word.trim_end_matches(':'));
    }
    if let Some(rest) = t.strip_prefix("/peer ") {
        let word = rest.split_whitespace().next()?;
        return PeerId::parse(word);
    }
    None
}

#[async_trait::async_trait]
impl AgentExecutor for CoordPeerExecutor {
    fn execute(
        &self,
        ctx: ExecutorContext,
    ) -> BoxStream<'static, Result<StreamResponse, A2AError>> {
        let peer = self.resolve_peer(&ctx);
        let prompt = self.prompt_from_message(&ctx);
        let invoker = self.invoker.clone();
        let manifest_id = self.manifest.id.clone();
        let coord_dir = self.mailbox.coord_dir.clone();
        let task_id = ctx.task_id.clone();
        let context_id = ctx.context_id.clone();
        let user_message = ctx.message.clone();

        // Acknowledge before invoking the CLI: returnImmediately callers can retain
        // the durable task id and disconnect while the server continues execution.
        let working = Task {
            id: task_id.clone(),
            context_id: context_id.clone(),
            status: TaskStatus { state: TaskState::Working, message: None, timestamp: None },
            artifacts: None,
            history: user_message.clone().map(|message| vec![message]),
            metadata: Some(HashMap::from([(
                "aphrody_peer".to_owned(),
                Value::String(peer.short().to_owned()),
            )])),
        };
        let failure_snapshot = working.clone();

        Box::pin(stream::once(async move { Ok(StreamResponse::Task(working)) }).chain(
            stream::once(async move {
                let result = match invocation_result(
                    tokio::task::spawn_blocking(move || invoker.invoke_prompt(peer, &prompt)).await,
                ) {
                    Ok(result) => result,
                    Err(reason) => {
                        return Ok(StreamResponse::Task(failed_task(failure_snapshot, reason)));
                    },
                };

                let summary = format!(
                    "peer={} exit={:?} stdout_bytes={}",
                    result.peer.short(),
                    result.exit_code,
                    result.stdout.len()
                );
                let mailbox = Mailbox::new(coord_dir);
                let _ = mailbox.append(
                    peer.short(),
                    &Envelope::new(
                        manifest_id,
                        format!("{}@aphrody-code/{}", peer.short(), peer.short()),
                        EnvelopeKind::Fact,
                        format!("a2a task {task_id} done"),
                        summary.clone(),
                    ),
                );

                let artifact = Artifact {
                    artifact_id: aphrody_a2a::new_artifact_id(),
                    name: Some(format!("{}-output", peer.short())),
                    description: Some("Native peer CLI stdout".to_owned()),
                    parts: vec![Part::text(&result.stdout).with_media_type("text/plain")],
                    metadata: Some(HashMap::from([
                        ("stderr".to_owned(), Value::String(result.stderr)),
                        ("exit_code".to_owned(), Value::from(result.exit_code)),
                    ])),
                    extensions: None,
                };

                let state = if result.exit_code == Some(0) {
                    TaskState::Completed
                } else {
                    TaskState::Failed
                };

                let agent_note = Message::new(
                    Role::Agent,
                    vec![Part::text(format!(
                        "Invoked {} (exit {:?}). See artifact for stdout.",
                        peer.short(),
                        result.exit_code
                    ))],
                );

                let task = Task {
                    id: task_id,
                    context_id,
                    status: TaskStatus { state, message: Some(agent_note), timestamp: None },
                    artifacts: Some(vec![artifact]),
                    history: user_message.map(|m| vec![m]),
                    metadata: Some(HashMap::from([(
                        "aphrody_peer".to_owned(),
                        Value::String(peer.short().to_owned()),
                    )])),
                };

                Ok(StreamResponse::Task(task))
            }),
        ))
    }

    fn cancel(&self, ctx: ExecutorContext) -> BoxStream<'static, Result<StreamResponse, A2AError>> {
        // A blocking native launcher has no process cancellation contract yet.
        // Refuse rather than persisting Canceled while the peer keeps editing.
        Box::pin(stream::once(async move { Err(A2AError::task_not_cancelable(&ctx.task_id)) }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn first_event_acknowledges_before_invoking_the_peer() {
        let root = tempfile::tempdir().unwrap();
        let manifest = serde_json::from_value(serde_json::json!({
            "version":"1", "spec":"a2a/v1.0", "id":"ack-test",
            "schema_version":"1", "kind":"agent", "coord":{"mailbox_dir":".coord"}
        }))
        .unwrap();
        let executor = CoordPeerExecutor::new(manifest, root.path().to_path_buf(), true)
            .with_default_peer(PeerId::Codex);
        let mut events = executor.execute(ExecutorContext {
            message: Some(Message::new(Role::User, vec![Part::text("acknowledge probe")])),
            task_id: "ack-task".to_owned(),
            stored_task: None,
            context_id: "ack-context".to_owned(),
            metadata: None,
            user: None,
            service_params: Default::default(),
            tenant: None,
        });
        let StreamResponse::Task(task) = events.next().await.unwrap().unwrap() else {
            panic!("first event must acknowledge the task");
        };
        assert_eq!(task.id, "ack-task");
        assert_eq!(task.status.state, TaskState::Working);
        assert!(task.artifacts.is_none());
        assert!(!root.path().join(".coord").exists());
    }

    #[test]
    fn configured_provider_is_explicit_and_invalid_names_fail() {
        assert_eq!(configured_default_peer(None).unwrap(), PeerId::Grok);
        assert_eq!(configured_default_peer(Some("codex")).unwrap(), PeerId::Codex);
        assert_eq!(configured_default_peer(Some(" claude-code ")).unwrap(), PeerId::Claude);
        assert_eq!(configured_default_peer(Some("antigravity")).unwrap(), PeerId::Agy);
        assert!(configured_default_peer(Some("")).is_err());
        assert!(configured_default_peer(Some("absent-provider")).is_err());
    }

    #[tokio::test]
    async fn launcher_join_failure_does_not_expose_the_panic_payload() {
        let result = tokio::task::spawn_blocking(|| -> Result<PeerInvokeResult, PeerError> {
            panic!("private-launcher-detail");
        })
        .await;
        assert_eq!(invocation_result(result).unwrap_err(), "launcher task failed");
        let error = PeerError::InvalidDomain("private-domain-detail".to_owned());
        assert_eq!(invocation_result(Ok(Err(error))).unwrap_err(), "invalid domain configuration");
    }
}
