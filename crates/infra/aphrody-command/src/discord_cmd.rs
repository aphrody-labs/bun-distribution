// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//! `aphrody discord …` — Sovereign Discord compilation, bot verification, and runtime tools.

use std::path::PathBuf;

use aphrody_discord_compiler::{BotTarget, CompilerOptions, DiscordCompiler};
use clap::Subcommand;
use colored::Colorize;
use miette::Result;

/// Subcommands for `aphrody discord`.
#[derive(Debug, Subcommand)]
pub(crate) enum DiscordAction {
    /// Compile one or all Discord bots into a native standalone binary via Bun + Oxc.
    Compile {
        /// Target bot: shenron, rg, achillea, all, or custom path
        #[arg(default_value = "all")]
        target: String,
        /// Run smoke check after compilation
        #[arg(long, default_value_t = true)]
        smoke: bool,
        /// Disable code minification
        #[arg(long)]
        no_minify: bool,
        /// Disable sourcemaps
        #[arg(long)]
        no_sourcemap: bool,
        /// Cross-compilation target (e.g. bun-linux-x64, bun-windows-x64, bun-linux-arm64)
        #[arg(long)]
        target_triple: Option<String>,
        /// Skip pre-build hooks (e.g. Tailwind CSS)
        #[arg(long)]
        no_pre_build: bool,
    },
    /// Inspect a Discord bot configuration, TypeScript decorators, and Oxc AST syntax.
    Inspect {
        /// Target bot: shenron, rg, achillea, or custom path
        #[arg(default_value = "shenron")]
        target: String,
        /// Output inspection as JSON
        #[arg(long)]
        json: bool,
    },
    /// Run the comprehensive Discord monorepo verification gate (catalog, kit, messaging, bots, compile).
    Verify,
}

pub(crate) async fn run_discord(action: DiscordAction) -> Result<()> {
    let compiler = DiscordCompiler::new()?;
    match action {
        DiscordAction::Compile {
            target,
            smoke,
            no_minify,
            no_sourcemap,
            target_triple,
            no_pre_build,
        } => {
            let options = CompilerOptions {
                minify: !no_minify,
                sourcemap: !no_sourcemap,
                smoke_check: smoke,
                target_triple,
                pre_build: !no_pre_build,
            };
            if target == "all" {
                compiler.compile_all(&options)?;
            } else if let Some(bot_target) = BotTarget::parse(&target) {
                compiler.compile(&bot_target, &options)?;
            } else {
                compiler.compile(&BotTarget::Custom(PathBuf::from(&target)), &options)?;
            }
            Ok(())
        },
        DiscordAction::Inspect { target, json } => {
            let bot_target =
                BotTarget::parse(&target).unwrap_or(BotTarget::Custom(PathBuf::from(&target)));
            let inspection = compiler.inspect(&bot_target)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&inspection).unwrap());
            } else {
                println!("\n🔍 {}", format!("Bot Inspection: {}", inspection.bot_name).bold());
                println!("   Directory:                {}", inspection.dir.display());
                println!("   package.json:             {}", inspection.package_json_exists);
                println!("   tsconfig.json:            {}", inspection.tsconfig_json_exists);
                println!("   Standalone entry:         {}", inspection.has_standalone_entry);
                println!("   Uses @aphrody/discord-kit: {}", inspection.uses_discord_kit);
                println!("   Command files scanned:    {}", inspection.commands_count);
                println!("   Oxc diagnostics errors:   {}", inspection.oxc_diagnostics_errors);
            }
            Ok(())
        },
        DiscordAction::Verify => compiler.verify_monorepo(),
    }
}
