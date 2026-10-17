use std::{fs, path::PathBuf, process::ExitCode};

use std::io::Write;

use bun_emu::{Machine, Step, arm::ArmFirmware, nds::Nds};

const USAGE: &str = "usage: bun-emu <nds|arm> <image> [--frames N] [--out DIR]";

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let (Some(system), Some(path)) = (args.next(), args.next()) else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };
    let (mut frames, mut out) = (60_u64, None::<PathBuf>);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--frames" => frames = args.next().and_then(|v| v.parse().ok()).unwrap_or(frames),
            "--out" => out = args.next().map(PathBuf::from),
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
        "arm" => match ArmFirmware::from_image(&rom, 128) {
            Ok(m) => Box::new(m),
            Err(e) => return fail(e),
        },
        other => return fail(format!("unsupported system `{other}`")),
    };
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
    println!("{}: {done} frames", machine.name());
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
    eprintln!("bun-emu: {msg}");
    ExitCode::FAILURE
}
