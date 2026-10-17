mod build;
mod dump;
mod extract;
mod rom_info;
mod rom_validation;

#[path = "decomp_cli/assets.rs"]
mod assets;

#[path = "decomp_cli/analysis/mod.rs"]
mod analysis;
#[path = "decomp_cli/cmd/mod.rs"]
pub mod cmd;
#[path = "decomp_cli/config/mod.rs"]
mod config;
#[path = "decomp_cli/util/mod.rs"]
mod util;

use std::{ffi::OsString, path::PathBuf, process::Command as ProcessCommand};

use anyhow::{Context, Result, bail};
use build::Build;
use clap::{Parser, Subcommand};
use cmd::{
    Apply, CheckArgs, Delink, DiffArgs, Disassemble, DumpArgs, FixArgs, Format, ImportArgs, Init,
    JsonArgs, Lcf, Objdiff, RomArgs, SigArgs,
};
use dump::Dump;
use env_logger::WriteStyle;
use extract::Extract;
use log::LevelFilter;
use rom_info::RomInfo;

/// Unified Nintendo DS ROM, decompilation and Dust debug tool.
#[derive(Parser)]
#[command(version, about, long_about = None)]
struct Cli {
    /// Enables debug logs.
    #[arg(long, short, global = true)]
    debug: bool,
    /// Forces colored output.
    #[arg(long, short, global = true)]
    force_color: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// ROM inspection and editing commands.
    Rom {
        #[command(subcommand)]
        command: RomCommand,
    },
    /// Show a cartridge summary (legacy shorthand for `rom info`).
    Info(RomInfo),
    /// Dump ROM data as a hex view.
    Dump(Dump),
    /// Extract a ROM to editable files and YAML config.
    Extract(Extract),
    /// Build a ROM from extracted files and YAML config.
    Build(Build),
    /// DS binary analysis, decompilation and project utilities.
    Decomp {
        #[command(subcommand)]
        command: DecompCommand,
    },
    /// Dust emulator debug commands from the dust-cli skill.
    Debug {
        #[arg(allow_hyphen_values = true, trailing_var_arg = true)]
        args: Vec<OsString>,
    },
    /// Pass a skill command directly, e.g. `dust launch game.nds`.
    #[command(external_subcommand)]
    Skill(Vec<OsString>),
}

#[derive(Subcommand)]
enum RomCommand {
    Info(RomInfo),
    Dump(Dump),
    Extract(Extract),
    Build(Build),
}

#[derive(Subcommand)]
enum DecompCommand {
    #[command(name = "dis")]
    Disassemble(Disassemble),
    Delink(Delink),
    Init(Init),
    Rom(RomArgs),
    Lcf(Lcf),
    Import(ImportArgs),
    Check(CheckArgs),
    Objdiff(Objdiff),
    Fix(FixArgs),
    Apply(Apply),
    Dump(DumpArgs),
    Json(JsonArgs),
    Sig(SigArgs),
    Format(Format),
    Diff(DiffArgs),
}

fn run_decomp(command: &DecompCommand) -> Result<()> {
    match command {
        DecompCommand::Disassemble(v) => v.run(),
        DecompCommand::Delink(v) => v.run(),
        DecompCommand::Init(v) => v.run(),
        DecompCommand::Rom(v) => v.run(),
        DecompCommand::Lcf(v) => v.run(),
        DecompCommand::Import(v) => v.run(),
        DecompCommand::Check(v) => v.run(),
        DecompCommand::Objdiff(v) => v.run(),
        DecompCommand::Fix(v) => v.run(),
        DecompCommand::Apply(v) => v.run(),
        DecompCommand::Dump(v) => v.run(),
        DecompCommand::Json(v) => v.run(),
        DecompCommand::Sig(v) => v.run(),
        DecompCommand::Format(v) => v.run(),
        DecompCommand::Diff(v) => v.run(),
    }
}

fn launch_skill(args: &[OsString]) -> Result<()> {
    if args.is_empty() {
        bail!("expected a dust-cli skill command; see `dust --help`");
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let script = manifest.join("dust-cli");
    if !script.is_file() {
        bail!(
            "could not find the canonical Dust Python client at {}",
            script.display()
        );
    }
    let python = std::env::var_os("PYTHON").unwrap_or_else(|| OsString::from("python3"));
    let status = ProcessCommand::new(python)
        .arg(script)
        .args(args)
        .status()
        .context("failed to start the Python debug bridge")?;
    if !status.success() {
        bail!("Dust debug bridge exited with {status}");
    }
    Ok(())
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let level = if cli.debug {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    };
    let style = if cli.force_color {
        WriteStyle::Always
    } else {
        WriteStyle::Auto
    };
    let mut logger = env_logger::builder();
    logger.filter_level(level).write_style(style);
    if let Command::Decomp {
        command: DecompCommand::Diff(diff),
    } = &cli.command
    {
        diff.configure_logger(&mut logger)?;
    }
    logger.init();
    match cli.command {
        Command::Rom { command } => match command {
            RomCommand::Info(v) => v.run(),
            RomCommand::Dump(v) => v.run(),
            RomCommand::Extract(v) => v.run(),
            RomCommand::Build(v) => v.run(),
        },
        Command::Info(v) => v.run(),
        Command::Dump(v) => v.run(),
        Command::Extract(v) => v.run(),
        Command::Build(v) => v.run(),
        Command::Decomp { command } => run_decomp(&command),
        Command::Debug { args } | Command::Skill(args) => launch_skill(&args),
    }
}

/// Print bytes as a hexdump or write the exact byte sequence to stdout.
pub fn print_hex(data: &[u8], raw: bool, base: u32) -> Result<()> {
    use std::io::Write;

    if raw {
        std::io::stdout().write_all(data)?;
    } else {
        for (offset, chunk) in data.chunks(16).enumerate() {
            print!("{:08x} ", base as usize + offset * 16);
            for byte in chunk {
                print!(" {byte:02x}");
            }
            for _ in chunk.len()..16 {
                print!("   ");
            }
            print!("  ");
            for &byte in chunk {
                let ch = char::from(byte);
                print!("{}", if ch.is_ascii_graphic() { ch } else { '.' });
            }
            println!();
        }
    }
    Ok(())
}
