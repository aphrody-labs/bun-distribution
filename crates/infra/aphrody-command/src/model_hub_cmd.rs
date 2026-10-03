// SPDX-License-Identifier: Apache-2.0
//! Canonical CLI adapter for the existing native Hub and secret-store owners.

use super::OutputOpts;
use aphrody_models::{
    Report,
    hub::{Hub, RepoInfo, RepoTypeAny},
};
use aphrody_secrets::EnvSecretStore;

#[derive(clap::ValueEnum, Debug, Clone, Copy)]
pub(crate) enum Kind {
    Model,
    Dataset,
    Space,
}

impl From<Kind> for RepoTypeAny {
    fn from(kind: Kind) -> Self {
        match kind {
            Kind::Model => Self::Model,
            Kind::Dataset => Self::Dataset,
            Kind::Space => Self::Space,
        }
    }
}

#[derive(clap::Args, Debug, Clone)]
pub(crate) struct AuthOpts {
    /// Existing environment-store key; omit for anonymous public discovery.
    /// Supply the key name only, never a token value. Missing credentials fail.
    #[arg(long, global = true)]
    credential_key: Option<String>,
}

#[derive(clap::Subcommand, Debug, Clone)]
pub(crate) enum HubAction {
    /// Search public or selected-identity repository metadata; no payload download.
    Search {
        #[arg(long, value_enum, default_value = "model")]
        kind: Kind,
        #[arg(long, default_value = "")]
        query: String,
        #[arg(long, default_value_t = 20, value_parser = clap::value_parser!(u16).range(1..=100))]
        limit: u16,
        #[command(flatten)]
        auth: AuthOpts,
        #[command(flatten)]
        output: OutputOpts,
    },
    /// Read repository metadata at a selected revision.
    Info {
        repo: String,
        #[arg(long, value_enum, default_value = "model")]
        kind: Kind,
        #[arg(long, default_value = "main")]
        revision: String,
        #[command(flatten)]
        auth: AuthOpts,
        #[command(flatten)]
        output: OutputOpts,
    },
    /// Read Space runtime status; does not start or provision a Space.
    Runtime {
        repo: String,
        #[command(flatten)]
        auth: AuthOpts,
        #[command(flatten)]
        output: OutputOpts,
    },
    /// Verify an existing credential with the official Hub, without printing identity data.
    Auth {
        #[arg(long, default_value = "HF_TOKEN")]
        credential_key: String,
        #[command(flatten)]
        output: OutputOpts,
    },
}

async fn client(key: Option<&str>) -> miette::Result<Hub> {
    match key {
        Some(key) => Hub::from_secret_store(&EnvSecretStore::new(), key).await,
        None => Hub::anonymous(),
    }
    .map_err(|e| miette::miette!("{e}"))
}

fn emit(output: &OutputOpts, value: &serde_json::Value) -> miette::Result<()> {
    let output = structured_output(output);
    let mut report = Report::new("Hugging Face Hub", &["FIELD", "VALUE"]);
    if let Some(fields) = value.as_object() {
        for (key, value) in fields {
            report.push(vec![key.clone(), value.to_string()]);
        }
    }
    output.emit_report(&report, value)
}

fn structured_output(output: &OutputOpts) -> OutputOpts {
    let mut output = output.clone();
    if output.format.is_none() && !output.json && output.out.is_none() {
        output.json = true;
    }
    output
}

fn repository_json(info: RepoInfo) -> miette::Result<serde_json::Value> {
    match info {
        RepoInfo::Model(info) => serde_json::to_value(info),
        RepoInfo::Dataset(info) => serde_json::to_value(info),
        RepoInfo::Space(info) => serde_json::to_value(info),
        RepoInfo::Kernel(info) => serde_json::to_value(info),
        _ => return Err(miette::miette!("unsupported Hugging Face repository metadata")),
    }
    .map_err(|_| miette::miette!("Hugging Face metadata serialization failed"))
}

pub(crate) async fn run(action: HubAction) -> miette::Result<()> {
    let (output, value) = match action {
        HubAction::Search { kind, query, limit, auth, output } => {
            let hub = client(auth.credential_key.as_deref()).await?;
            let rows = hub
                .search(kind.into(), &query, usize::from(limit))
                .await
                .map_err(|e| miette::miette!("{e}"))?;
            let rows = rows.into_iter().map(repository_json).collect::<miette::Result<Vec<_>>>()?;
            (
                output,
                serde_json::json!({"schemaVersion":1,"repositories":rows,"payloadsDownloaded":false}),
            )
        },
        HubAction::Info { repo, kind, revision, auth, output } => {
            let hub = client(auth.credential_key.as_deref()).await?;
            let info = hub
                .info(kind.into(), &repo, &revision)
                .await
                .map_err(|e| miette::miette!("{e}"))?;
            (
                output,
                serde_json::json!({"schemaVersion":1,"repository":repository_json(info)?,"requestedRevision":revision}),
            )
        },
        HubAction::Runtime { repo, auth, output } => {
            let hub = client(auth.credential_key.as_deref()).await?;
            let status = hub.space_runtime(&repo).await.map_err(|e| miette::miette!("{e}"))?;
            (output, serde_json::json!({"schemaVersion":1,"runtime":status}))
        },
        HubAction::Auth { credential_key, output } => {
            let verified = match client(Some(&credential_key)).await {
                Ok(hub) => hub.verify_identity().await.is_ok(),
                Err(_) => false,
            };
            emit(
                &output,
                &serde_json::json!({"schemaVersion":1,"provider":"huggingface","verified":verified}),
            )?;
            return if verified {
                Ok(())
            } else {
                Err(miette::miette!("Hugging Face identity unavailable or unverified"))
            };
        },
    };
    emit(&output, &value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser as _;

    #[derive(clap::Parser)]
    struct Command {
        #[command(subcommand)]
        action: HubAction,
    }

    #[test]
    fn discovery_is_anonymous_unless_a_key_is_selected() {
        let command = Command::try_parse_from(["hub", "search", "--kind", "dataset", "--json"])
            .expect("parse");
        let HubAction::Search { kind, auth, .. } = command.action else {
            panic!("search");
        };
        assert!(matches!(kind, Kind::Dataset));
        assert!(auth.credential_key.is_none());
        let command =
            Command::try_parse_from(["hub", "info", "owner/repo", "--credential-key", "HF_TOKEN"])
                .expect("parse");
        let HubAction::Info { auth, .. } = command.action else {
            panic!("info");
        };
        assert_eq!(auth.credential_key.as_deref(), Some("HF_TOKEN"));
    }

    #[test]
    fn search_rejects_unbounded_limits_before_dispatch() {
        for limit in ["0", "101", "65536"] {
            assert!(Command::try_parse_from(["hub", "search", "--limit", limit]).is_err());
        }
    }

    #[test]
    fn auth_selects_the_existing_environment_key() {
        let command = Command::try_parse_from(["hub", "auth", "--json"]).expect("parse");
        let HubAction::Auth { credential_key, .. } = command.action else {
            panic!("auth");
        };
        assert_eq!(credential_key, "HF_TOKEN");
    }

    #[test]
    fn hub_defaults_to_json_and_preserves_explicit_output_formats() {
        assert_eq!(
            structured_output(&OutputOpts::default()).format().expect("format"),
            aphrody_models::Format::Json
        );
        let markdown = OutputOpts { format: Some("markdown".into()), ..OutputOpts::default() };
        assert_eq!(
            structured_output(&markdown).format().expect("format"),
            aphrody_models::Format::Markdown
        );
        let file = OutputOpts { out: Some("report.md".into()), ..OutputOpts::default() };
        assert_eq!(
            structured_output(&file).format().expect("format"),
            aphrody_models::Format::Markdown
        );
    }
}
