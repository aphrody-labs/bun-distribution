// SPDX-License-Identifier: Apache-2.0
use aphrody_certificates::IssueOptions;
use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(about = "Native ACME DNS01 certificates for authorized vps.aphrody.com")]
struct Cli {
    #[arg(long, global = true)]
    output: PathBuf,
    #[arg(long, global = true)]
    workspace: PathBuf,
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    /// Create a new certificate; staging unless --production is explicit.
    Issue(Arguments),
    /// Renew through a fresh ACME order, retaining prior certificate generations.
    Renew(Arguments),
    /// Inspect metadata and chain checksum without exposing private keys.
    Inspect,
}
#[derive(clap::Args)]
struct Arguments {
    #[arg(long, default_value = "vps.aphrody.com")]
    hostname: String,
    #[arg(long)]
    production: bool,
    #[arg(long)]
    agree_tos: bool,
    #[arg(long)]
    profile: Option<String>,
    #[arg(long, default_value_t = 60)]
    propagation_seconds: u64,
}
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let metadata = match cli.command {
        Command::Inspect => aphrody_certificates::inspect(&cli.output,&cli.workspace)?,
        Command::Issue(args) | Command::Renew(args) => aphrody_certificates::issue(&IssueOptions {
            output:cli.output, workspace:cli.workspace, hostname:args.hostname,
            production:args.production, agree_tos:args.agree_tos, profile:args.profile,
            propagation_seconds:args.propagation_seconds,
        }).await.map_err(|_| anyhow::anyhow!("issuance failed; inspect protected receipts and native provider status; no secret details printed"))?,
    };
    println!("{}", serde_json::to_string_pretty(&metadata)?);
    Ok(())
}
