// SPDX-License-Identifier: Apache-2.0
//! CLI access to Koharu-owned model choices and persisted preferences.

use std::{io::Read, path::PathBuf};

use aphrody_manga::koharu::{
    PipelineConfig, ProvidersConfig,
    renderer::TypesettingConfig,
    secrets,
    translator::{Provider, ProviderConfig, Translator},
};
use clap::Subcommand;
use miette::Result;
use serde::de::DeserializeOwned;

#[derive(Debug, Subcommand)]
pub(crate) enum PreferencesAction {
    /// Show Koharu's persisted settings, with only credential presence flags.
    Show,
    /// Replace the pipeline settings from a Koharu PipelineConfig JSON file.
    SetPipeline { file: PathBuf },
    /// Replace provider settings from a JSON array of Koharu ProviderConfig entries.
    SetProviders { file: PathBuf },
    /// Replace typesetting settings from a Koharu TypesettingConfig JSON file.
    SetTypesetting { file: PathBuf },
    /// Set a provider credential from stdin, or clear it from the native store.
    Credential {
        provider: String,
        #[arg(long, conflicts_with = "clear", required_unless_present = "clear")]
        stdin: bool,
        #[arg(long, conflicts_with = "stdin", required_unless_present = "stdin")]
        clear: bool,
    },
}

pub(crate) async fn models(translation: bool) -> Result<()> {
    let pipeline = PipelineConfig::model_catalog();
    let document = if translation {
        let translation = Translator::models().await.map_err(|error| miette::miette!("{error}"))?;
        serde_json::json!({ "pipeline": pipeline, "translation": translation })
    } else {
        serde_json::json!({ "pipeline": pipeline })
    };
    emit(&document)
}

pub(crate) fn preferences(action: PreferencesAction) -> Result<()> {
    match action {
        PreferencesAction::Show => {
            let pipeline = PipelineConfig::load()
                .map_err(|error| miette::miette!("{error}"))?
                .read()
                .map_err(|error| miette::miette!("{error}"))?
                .clone();
            let providers = ProvidersConfig::load()
                .map_err(|error| miette::miette!("{error}"))?
                .read()
                .map_err(|error| miette::miette!("{error}"))?
                .clone();
            let typesetting = TypesettingConfig::load()
                .map_err(|error| miette::miette!("{error}"))?
                .read()
                .map_err(|error| miette::miette!("{error}"))?
                .clone();
            let entries = providers
                .entries()
                .into_iter()
                .map(|config| {
                    let provider = config.provider();
                    let configured = credential_present(provider)?;
                    Ok(serde_json::json!({
                        "config": config,
                        "credential_configured": configured,
                    }))
                })
                .collect::<Result<Vec<_>>>()?;
            emit(&serde_json::json!({
                "pipeline": pipeline,
                "providers": entries,
                "typesetting": typesetting,
            }))
        },
        PreferencesAction::SetPipeline { file } => {
            let mut pipeline: PipelineConfig = read_json(&file)?;
            pipeline.remember_selected_profiles();
            pipeline.validate().map_err(|error| miette::miette!("{error}"))?;
            let config = PipelineConfig::load().map_err(|error| miette::miette!("{error}"))?;
            let mut current = config.write().map_err(|error| miette::miette!("{error}"))?;
            *current = pipeline;
            current.save().map_err(|error| miette::miette!("{error}"))?;
            emit(
                &serde_json::json!({ "pipeline": config.read().map_err(|error| miette::miette!("{error}"))?.clone() }),
            )
        },
        PreferencesAction::SetProviders { file } => {
            let entries: Vec<ProviderConfig> = read_json(&file)?;
            let providers = ProvidersConfig::from_entries(entries)
                .map_err(|error| miette::miette!("{error}"))?;
            let config = ProvidersConfig::load().map_err(|error| miette::miette!("{error}"))?;
            let mut current = config.write().map_err(|error| miette::miette!("{error}"))?;
            *current = providers;
            current.save().map_err(|error| miette::miette!("{error}"))?;
            emit(
                &serde_json::json!({ "providers": config.read().map_err(|error| miette::miette!("{error}"))?.entries() }),
            )
        },
        PreferencesAction::SetTypesetting { file } => {
            let typesetting: TypesettingConfig = read_json(&file)?;
            let config = TypesettingConfig::load().map_err(|error| miette::miette!("{error}"))?;
            let mut current = config.write().map_err(|error| miette::miette!("{error}"))?;
            *current = typesetting;
            current.save().map_err(|error| miette::miette!("{error}"))?;
            emit(
                &serde_json::json!({ "typesetting": config.read().map_err(|error| miette::miette!("{error}"))?.clone() }),
            )
        },
        PreferencesAction::Credential { provider, stdin, clear } => {
            let provider: Provider =
                provider.parse().map_err(|error| miette::miette!("{error}"))?;
            if provider == Provider::Local {
                return Err(miette::miette!("local translation does not accept credentials"));
            }
            let key: &'static str = provider.into();
            if clear {
                secrets::delete(key).map_err(|error| miette::miette!("{error}"))?;
            } else if stdin {
                let mut value = String::new();
                std::io::stdin()
                    .read_to_string(&mut value)
                    .map_err(|error| miette::miette!("{error}"))?;
                let value = value.trim_end_matches(['\r', '\n']);
                if value.is_empty() {
                    return Err(miette::miette!("credential stdin was empty"));
                }
                secrets::set(key, &value.into()).map_err(|error| miette::miette!("{error}"))?;
            }
            emit(&serde_json::json!({ "credential_configured": credential_present(provider)? }))
        },
    }
}

fn credential_present(provider: Provider) -> Result<bool> {
    if provider == Provider::Local {
        return Ok(false);
    }
    let key: &'static str = provider.into();
    Ok(secrets::get(key).map_err(|error| miette::miette!("{error}"))?.is_some())
}

fn read_json<T: DeserializeOwned>(path: &PathBuf) -> Result<T> {
    let data = std::fs::read(path).map_err(|error| miette::miette!("{error}"))?;
    serde_json::from_slice(&data).map_err(|error| miette::miette!("{error}"))
}

fn emit(value: &serde_json::Value) -> Result<()> {
    println!(
        "{}",
        serde_json::to_string_pretty(value).map_err(|error| miette::miette!("{error}"))?
    );
    Ok(())
}
