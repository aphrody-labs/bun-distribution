// SPDX-License-Identifier: Apache-2.0
//! Persistent session selection shared by headless resume and fork.

use std::path::Path;

use aphrody_model_client::ChatMessage;
use aphrody_rollout::SessionSummary;
use clap::Args;

#[derive(Debug, Clone, Args)]
pub(crate) struct SessionArgs {
    #[command(flatten)]
    pub options: crate::AgentOptions,
    /// Recorded session id or unambiguous id prefix.
    #[arg(value_name = "SESSION_ID", required_unless_present = "last")]
    pub session_id: Option<String>,
    /// Continue the most recently recorded session.
    #[arg(long)]
    pub last: bool,
    /// New instructions; omit or use `-` to read stdin.
    #[arg(value_name = "PROMPT")]
    pub prompt: Option<String>,
}

impl SessionArgs {
    /// With --last, the first positional is a prompt, matching Codex exec.
    pub(crate) fn effective_prompt(&self) -> Option<&str> {
        self.prompt.as_deref().or_else(|| self.last.then_some(self.session_id.as_deref()).flatten())
    }
}

pub(crate) async fn load(
    root: &Path,
    args: &SessionArgs,
) -> miette::Result<(SessionSummary, Vec<ChatMessage>)> {
    let selected = if args.last {
        aphrody_rollout::latest_session(root).await
    } else if let Some(id) = &args.session_id {
        aphrody_rollout::find_session(root, id).await
    } else {
        return Err(miette::miette!("session: supply SESSION_ID or --last"));
    }
    .map_err(|error| miette::miette!("session: {error}"))?
    .ok_or_else(|| miette::miette!("session: no unique matching session found"))?;
    let contents = tokio::fs::read_to_string(&selected.path)
        .await
        .map_err(|error| miette::miette!("session: {error}"))?;
    let lines = contents
        .lines()
        .enumerate()
        .filter(|(_, line)| !line.trim().is_empty())
        .map(|(index, line)| {
            serde_json::from_str::<aphrody_rollout::RolloutLine>(line).map_err(|error| {
                miette::miette!("session: invalid rollout line {}: {error}", index + 1)
            })
        })
        .collect::<miette::Result<Vec<_>>>()?;
    let restored = aphrody_engine::restore_history(&lines);
    if restored.undecodable > 0 {
        return Err(miette::miette!(
            "session: {} history records are invalid; refusing a partial replay",
            restored.undecodable
        ));
    }
    Ok((selected, restored.messages))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn session_loader_restores_history_and_rejects_corruption() {
        let root = tempfile::tempdir().unwrap();
        let recorder = aphrody_rollout::RolloutRecorder::create(
            root.path(),
            aphrody_rollout::SessionMeta {
                id: "session-for-replay".into(),
                timestamp: String::new(),
                cwd: None,
                originator: "aphrody".into(),
                cli_version: "test".into(),
                model: None,
                model_provider: None,
                instructions: None,
                git: None,
                forked_from: None,
            },
        )
        .await
        .unwrap();
        let mut session = aphrody_engine::Session::new(aphrody_engine::EngineConfig::default());
        session.push_user(vec![aphrody_model_client::Part::Text("original prompt".into())]);
        recorder.record(serde_json::json!({
            "type": "history_item", "message": session.history()[0]
        }));
        let path = recorder.path().to_owned();
        recorder.shutdown().await.unwrap();
        let args = SessionArgs {
            options: crate::AgentOptions::default(),
            session_id: Some("session-for-replay".into()),
            last: false,
            prompt: None,
        };
        let (selected, messages) = load(root.path(), &args).await.unwrap();
        assert_eq!(selected.meta.id, "session-for-replay");
        assert_eq!(messages, session.history());
        let mut file = std::fs::OpenOptions::new().append(true).open(path).unwrap();
        std::io::Write::write_all(&mut file, b"broken json\n").unwrap();
        assert!(
            load(root.path(), &args)
                .await
                .unwrap_err()
                .to_string()
                .contains("invalid rollout line")
        );
    }
}
