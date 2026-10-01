// SPDX-License-Identifier: Apache-2.0
use clap::Parser;
#[derive(Parser)]
#[command(version,about="Aphrody WSL source build and distribution workbench")]
struct Args {
    #[arg(long,env="APHRODY_WSL_BUILD_CONFIG",default_value="config/os/wsl-build.json")]
    config:std::path::PathBuf,
    #[command(subcommand)]
    action:aphrody_wsl::cli::Action,
}
fn main()->Result<(),aphrody_wsl::Error>{let args=Args::parse();aphrody_wsl::cli::run(args.action,args.config)}
