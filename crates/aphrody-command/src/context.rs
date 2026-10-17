// SPDX-License-Identifier: Apache-2.0
use std::sync::Arc;

use aphrody_backend::base::Vfs;
use async_trait::async_trait;
use miette::Result;

/// GoogleContext : L'état global injecté dans chaque commande (Pattern Starship/Cargo)
pub(crate) struct GoogleContext {
    /// VFS pour les commandes forensics (chromium, mirror) — pas utilisé par
    /// la commande `version` qui passe par env! au compile-time.
    #[allow(dead_code)]
    pub vfs: Arc<Vfs>,
    /// Version exposée pour les commandes qui en ont besoin runtime ;
    /// `version` print direct env!("CARGO_PKG_VERSION") pour la cohérence
    /// avec build.rs et le rich-output.
    #[allow(dead_code)]
    pub version: &'static str,
}

impl GoogleContext {
    pub(crate) fn new() -> Result<Self> {
        let vfs = Arc::new(Vfs::new().map_err(|e| miette::miette!(e.to_string()))?);
        vfs.initialize_physical_layout()
            .map_err(|e| miette::miette!(e.to_string()))?;

        Ok(Self {
            vfs,
            version: "1.0.0-canary",
        })
    }
}

/// TerminalCommand : Trait d'exécution modulaire pour les sous-commandes
#[async_trait]
pub(crate) trait TerminalCommand {
    async fn execute(&self, ctx: &GoogleContext) -> Result<()>;
}
