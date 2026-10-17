use std::{fs, path::PathBuf, process::ExitCode};

use std::io::Write;

use bun_engine::cartridge::dust::rom::raw;
use bun_engine::machine::{Machine, Step, arm::ArmFirmware, nds::Nds};
use serde_json::json;

const USAGE: &str = "usage: bun-engine info <rom.nds> [--json] | bun-engine shell [--session|status|install-session] | bun-engine steam <command> (feature steam) | bun-engine stream <host>|--loopback [options] | bun-engine run <nds|3ds|switch|gba|nes|psx|wii|gc|arm|x86|linux|melonds|dolphin|azahar|kyty> <image> [--headless] [--bios FILE] [--frames N] [--out DIR] [--cmdline ARGS] [--input key@first[-last],...] [--trace FILE.jsonl] [--fsr [--sharpness STOPS]] [--steam [--steam-*]]";

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
        // The console shell is its own Bevy app (crates/bun-os-shell) built next to this binary.
        Some("shell") => {
            args.next();
            let shell = std::env::current_exe()
                .ok()
                .and_then(|exe| Some(exe.parent()?.join(format!("bun-os-shell{}", std::env::consts::EXE_SUFFIX))))
                .filter(|path| path.is_file());
            let Some(shell) = shell else {
                return fail("bun-os-shell is not built next to bun-engine (cargo build -p bun-os-shell)".into());
            };
            return match std::process::Command::new(shell).args(args).status() {
                Ok(status) => ExitCode::from(status.code().unwrap_or(1).clamp(0, 255) as u8),
                Err(e) => fail(e.to_string()),
            };
        }
        #[cfg(feature = "steam")]
        Some("steam") => {
            args.next();
            return match bun_engine::steam::cli::main(args) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => fail(e),
            };
        }
        #[cfg(feature = "stream")]
        Some("stream") => {
            args.next();
            return match bun_engine::stream::main(args) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => fail(e),
            };
        }
        _ => {}
    }
    let (Some(system), Some(path)) = (args.next(), args.next()) else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };
    let (mut frames, mut out, mut headless) = (u64::MAX, None::<PathBuf>, false);
    let mut bios = None::<PathBuf>;
    // Headless replay: scripted pad input and a per-frame screen digest trace (`re replica`).
    let (mut script, mut trace) = (Vec::<(u32, u64, u64)>::new(), None::<PathBuf>);
    let (mut fsr, mut sharpness) = (false, 0.25_f32);
    #[cfg(feature = "steam")]
    let mut steam_args = Vec::<String>::new();
    let mut cmdline = String::from("console=ttyS0 earlyprintk=serial,ttyS0 reboot=k panic=1 pci=off nomodule noapic");
    while let Some(a) = args.next() {
        match a.as_str() {
            "--frames" => frames = args.next().and_then(|v| v.parse().ok()).unwrap_or(frames),
            "--headless" => headless = true,
            "--bios" => bios = args.next().map(PathBuf::from),
            "--out" => out = args.next().map(PathBuf::from),
            "--cmdline" => cmdline = args.next().unwrap_or(cmdline),
            "--input" => match bun_engine::recomp::parse_input(&args.next().unwrap_or_default()) {
                Ok(s) => script = s,
                Err(e) => return fail(e),
            },
            "--trace" => trace = args.next().map(PathBuf::from),
            "--fsr" => fsr = true,
            "--sharpness" => sharpness = args.next().and_then(|v| v.parse().ok()).unwrap_or(sharpness),
            #[cfg(feature = "steam")]
            flag if flag == "--steam" || flag.starts_with("--steam-") => {
                steam_args.push(a.clone());
                if bun_engine::steam::options::takes_value(flag) {
                    steam_args.extend(args.next());
                }
            }
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
        "psx" => {
            let Some(bios) = bios.as_ref().and_then(|p| fs::read(p).ok()) else {
                return fail("psx needs --bios <512 KiB BIOS> (bep add free-firmware openbios)".into());
            };
            match bun_engine::machine::psx::Psx::new(&bios, &rom) {
                Ok(m) => Box::new(m),
                Err(e) => return fail(e),
            }
        }
        "gba" => match bun_engine::machine::gba::Gba::from_rom(&rom, bios.as_ref().and_then(|p| fs::read(p).ok()).as_deref()) {
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
        #[cfg(feature = "ctr")]
        "3ds" => match bun_engine::machine::ctr::Ctr::from_path(std::path::Path::new(&path), &rom) {
            Ok(m) => Box::new(m),
            Err(e) => return fail(e),
        },
        #[cfg(feature = "switch")]
        "switch" => match bun_engine::machine::switch::Switch::from_path(&path) {
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
        #[cfg(feature = "cpp-host")]
        core @ ("melonds" | "dolphin" | "azahar" | "kyty") => {
            match bun_engine::machine::cpp_host::CppHost::open(core, std::path::Path::new(&path), bios.as_deref()) {
                Ok(m) => Box::new(m),
                Err(e) => return fail(e),
            }
        }
        other => return fail(format!("unsupported system `{other}`")),
    };
    if !headless && !machine.screens().is_empty() {
        // One Bevy app: window, input, audio and the machine plugin.
        let options = bun_engine::runtime::run::RunOptions {
            title: format!("Bun Engine - {}", std::path::Path::new(&path).file_stem().map_or_else(Default::default, |s| s.to_string_lossy())),
            frames: (frames != u64::MAX).then_some(frames),
            out,
            fsr,
            sharpness_stops: sharpness,
            ..Default::default()
        };
        // Steam starts before the window and GPU device (overlay hook), so before `machine_app`.
        #[cfg(feature = "steam")]
        let steam = if steam_args.is_empty() {
            None
        } else {
            match bun_engine::steam::options::parse(&steam_args) {
                Ok(steam) => Some(bun_engine::steam::SteamPlugin::new(steam, system.as_str(), path.as_str())),
                Err(e) => return fail(e),
            }
        };
        let (mut app, report) = bun_engine::runtime::run::machine_app(machine, &options);
        #[cfg(feature = "steam")]
        if let Some(steam) = steam {
            app.add_plugins(steam);
        }
        let exit = app.run();
        let report = report.lock().unwrap().clone();
        if let Some(why) = report.diagnostic.as_ref() {
            eprintln!("stopped: {why}");
        }
        return match (report.failure, exit) {
            (Some(e), _) => fail(e),
            (None, bun_engine::bevy::app::AppExit::Error(code)) => fail(format!("exited with code {code}")),
            (None, _) => ExitCode::SUCCESS,
        };
    }
    let mut trace_lines = trace.as_ref().map(|_| String::new());
    let mut done = 0;
    while done < frames {
        let keys = bun_engine::recomp::keys_at(&script, done);
        if !script.is_empty() {
            machine.set_input(bun_engine::machine::Input { keys, touch: None });
        }
        match machine.run_frame() {
            Step::Frame => {
                if let Some(lines) = trace_lines.as_mut() {
                    lines.push_str(&trace_line(done, keys, &machine.screens()));
                }
                done += 1;
            }
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
    if let Some(dir) = out
        && let Err(e) = bun_engine::machine::write_screens(&dir, &machine.screens())
    {
        return fail(format!("{}: {e}", dir.display()));
    }
    if let (Some(path), Some(lines)) = (trace, trace_lines)
        && let Err(e) = fs::write(&path, lines)
    {
        return fail(format!("{}: {e}", path.display()));
    }
    ExitCode::SUCCESS
}

/// One JSON line of a replay trace: frame index, held keys and the FNV-1a 64 digest of every
/// screen (dimensions and RGB bytes), so two runs compare frame by frame without storing images.
fn trace_line(frame: u64, keys: u32, screens: &[bun_engine::machine::Screen]) -> String {
    let digests = screens
        .iter()
        .map(|s| {
            let mut h: u64 = 0xcbf2_9ce4_8422_2325;
            for b in (s.width as u64).to_le_bytes().iter().chain(&(s.height as u64).to_le_bytes()).chain(&s.rgb) {
                h = (h ^ u64::from(*b)).wrapping_mul(0x0100_0000_01b3);
            }
            format!("\"{h:016x}\"")
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("{{\"frame\":{frame},\"keys\":{keys},\"screens\":[{digests}]}}\n")
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
