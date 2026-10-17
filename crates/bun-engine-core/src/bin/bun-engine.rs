use std::{fs, path::PathBuf, process::ExitCode};

use std::io::Write;

use bun_engine::cartridge::dust::rom::raw;
use bun_engine::machine::{Machine, Step, arm::ArmFirmware, nds::Nds};
use serde_json::json;

const USAGE: &str = "usage: bun-engine info <rom.nds> [--json] | bun-engine run <nds|gba|nes|wii|gc|arm|x86|linux> <image> [--headless] [--frames N] [--out DIR] [--cmdline ARGS]";

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1).peekable();
    match args.peek().map(String::as_str) {
        Some("info") => {
            args.next();
            return info(args).unwrap_or_else(|e| fail(e.to_string()));
        }
        Some("run") => {
            args.next();
        }
        _ => {}
    }
    let (Some(system), Some(path)) = (args.next(), args.next()) else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };
    let (mut frames, mut out, mut headless) = (u64::MAX, None::<PathBuf>, false);
    let mut cmdline = String::from("console=ttyS0 earlyprintk=serial,ttyS0 reboot=k panic=1 pci=off nomodule noapic");
    while let Some(a) = args.next() {
        match a.as_str() {
            "--frames" => frames = args.next().and_then(|v| v.parse().ok()).unwrap_or(frames),
            "--headless" => headless = true,
            "--out" => out = args.next().map(PathBuf::from),
            "--cmdline" => cmdline = args.next().unwrap_or(cmdline),
            _ => {
                eprintln!("{USAGE}");
                return ExitCode::from(2);
            }
        }
    }
    let rom = match fs::read(&path) {
        Ok(rom) => rom,
        Err(e) => return fail(format!("{path}: {e}")),
    };
    let mut machine: Box<dyn Machine> = match system.as_str() {
        "nds" => match Nds::from_rom(&rom) {
            Ok(m) => Box::new(m),
            Err(e) => return fail(e),
        },
        "gba" => match bun_engine::machine::gba::Gba::from_rom(&rom, None) {
            Ok(m) => Box::new(m),
            Err(e) => return fail(e),
        },
        "nes" => match bun_engine::machine::nes::Nes::from_rom(&path, &rom) {
            Ok(m) => Box::new(m),
            Err(e) => return fail(e),
        },
        "wii" => match bun_engine::machine::wii::WiiMachine::wii_dol(&rom) {
            Ok(m) => Box::new(m),
            Err(e) => return fail(e),
        },
        "gc" => match bun_engine::machine::wii::WiiMachine::gamecube_dol(&rom) {
            Ok(m) => Box::new(m),
            Err(e) => return fail(e),
        },
        "arm" => match ArmFirmware::from_image(&rom, 128) {
            Ok(m) => Box::new(m),
            Err(e) => return fail(e),
        },
        #[cfg(all(windows, feature = "x86"))]
        "x86" => match bun_engine::machine::x86::X86::from_image(&rom, 128) {
            Ok(m) => Box::new(m),
            Err(e) => return fail(e),
        },
        #[cfg(all(windows, feature = "x86"))]
        "linux" => match bun_engine::machine::x86::X86::from_linux(&rom, &cmdline, 256) {
            Ok(m) => Box::new(m),
            Err(e) => return fail(e),
        },
        other => return fail(format!("unsupported system `{other}`")),
    };
    if !headless && !machine.screens().is_empty() {
        return match bun_engine::window::run(machine, "Bun Engine") {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => fail(e),
        };
    }
    let mut done = 0;
    while done < frames {
        match machine.run_frame() {
            Step::Frame => done += 1,
            Step::Shutdown => {
                flush(&mut *machine);
                break;
            }
            Step::Stopped => {}
        }
        flush(&mut *machine);
    }
    println!("
{}: {done} frames", machine.name());
    if let Some(why) = machine.diagnostic() {
        eprintln!("stopped: {why}");
    }
    if let Some(dir) = out {
        if let Err(e) = fs::create_dir_all(&dir) {
            return fail(format!("{}: {e}", dir.display()));
        }
        for (i, s) in machine.screens().iter().enumerate() {
            let mut ppm = format!("P6\n{} {}\n255\n", s.width, s.height).into_bytes();
            ppm.extend_from_slice(&s.rgb);
            if let Err(e) = fs::write(dir.join(format!("screen{i}.ppm")), ppm) {
                return fail(e.to_string());
            }
        }
    }
    ExitCode::SUCCESS
}

fn flush(machine: &mut dyn Machine) {
    let out = machine.console();
    if !out.is_empty() {
        let _ = std::io::stdout().write_all(&out);
    }
}

fn fail(msg: String) -> ExitCode {
    eprintln!("bun-engine: {msg}");
    ExitCode::FAILURE
}

/// `bun-engine info <rom.nds> [--json]`: read-only cartridge header inspection.
fn info(mut args: impl Iterator<Item = String>) -> Result<ExitCode, Box<dyn std::error::Error>> {
    let Some(path) = args.next().map(PathBuf::from) else {
        eprintln!("usage: bun-engine info <rom.nds> [--json]");
        return Ok(ExitCode::from(2));
    };
    let json_output = args.any(|argument| argument == "--json");
    let image = raw::Rom::from_file(&path)?;
    let inspection = image.inspect()?;
    let invalid_regions = inspection
        .invalid_regions()
        .map(|region| format!("{:?}: {:#x}+{:#x}", region.kind, region.offset, region.size))
        .collect::<Vec<_>>();
    let report = json!({
        "path": path,
        "title": inspection.title,
        "gameCode": inspection.game_code,
        "makerCode": inspection.maker_code,
        "platform": if inspection.is_dsi { "Nintendo DSi" } else { "Nintendo DS" },
        "unitCode": inspection.unit_code,
        "fileSize": inspection.file_size,
        "dsRegionSize": inspection.ds_region_size,
        "dsiRegionSize": inspection.dsi_region_size,
        "headerCrcValid": inspection.header_crc_valid,
        "logoCrcValid": inspection.logo_crc_valid,
        "valid": inspection.is_valid(),
        "invalidRegions": invalid_regions,
    });
    if json_output {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        println!(
            "{} ({})",
            report["title"].as_str().unwrap_or(""),
            report["gameCode"].as_str().unwrap_or("")
        );
        println!("{} bytes", inspection.file_size);
        println!(
            "header CRC: {}; logo CRC: {}",
            inspection.header_crc_valid, inspection.logo_crc_valid
        );
        println!(
            "validation: {}",
            if inspection.is_valid() {
                "passed"
            } else {
                "failed"
            }
        );
    }
    if !inspection.is_valid() {
        std::process::exit(1);
    }
    Ok(ExitCode::SUCCESS)
}
