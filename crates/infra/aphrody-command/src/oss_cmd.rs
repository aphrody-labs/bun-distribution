// SPDX-License-Identifier: Apache-2.0
//! CLI adapter for shared managed open-weight provider preparation.

use std::path::{Path, PathBuf};

use aphrody_agent_runtime::ProviderLease;
use aphrody_config::Config;
use aphrody_llama_server::{Role, StateDirs};
use miette::IntoDiagnostic as _;

pub(crate) async fn prepare(config: &mut Config, cwd: &Path) -> miette::Result<ProviderLease> {
    aphrody_agent_runtime::prepare_managed_provider(config, cwd)
        .await
        .map_err(|error| miette::miette!(error))
}

/// Daemons use one OS thread so Linux parent-death signals bind to its lifetime.
pub(crate) async fn run_daemon(state_root: PathBuf, role: String) -> miette::Result<()> {
    let role =
        Role::parse(&role).ok_or_else(|| miette::miette!("unknown llama daemon role: {role}"))?;
    tokio::task::spawn_blocking(move || {
        let runtime =
            tokio::runtime::Builder::new_current_thread().enable_all().build().into_diagnostic()?;
        runtime
            .block_on(aphrody_llama_server::daemon::run(&StateDirs::new(state_root), role))
            .map(|_| ())
            .map_err(|error| miette::miette!("llama daemon: {error}"))
    })
    .await
    .into_diagnostic()?
}
