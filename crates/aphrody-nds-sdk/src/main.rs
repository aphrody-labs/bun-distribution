//! `nds-sdk`: headless runner for DS and 3DS images.
//!
//! ```text
//! nds-sdk info <image>
//! nds-sdk run <image> [--frames N] [--every N] [--tap BUTTON@FRAME]... [--data DIR] [--no-save] [--save-type T] [--dump DIR]
//! ```
//!
//! `run` prints the FNV-1a hash of both screens every `--every` frames (default 60) and a final
//! status line. Exit code 0 when the requested frames ran, 1 on a crash or boot failure.
//! Pictures are written only with `--dump DIR` (local inspection; never commit them).

use std::{path::PathBuf, process::ExitCode};

use aphrody_nds_sdk::{Format, Input, Options, SaveType, ScreenId, Step, button, frame_hash, open};

fn usage() -> ExitCode {
    eprintln!(
        "usage: nds-sdk info <image> | run <image> [--frames N] [--every N] [--tap BUTTON@FRAME]... [--data DIR] [--no-save] [--dump DIR]"
    );
    ExitCode::from(2)
}

fn button_bit(name: &str) -> Option<u32> {
    Some(match name.to_ascii_lowercase().as_str() {
        "a" => button::A,
        "b" => button::B,
        "x" => button::X,
        "y" => button::Y,
        "l" => button::L,
        "r" => button::R,
        "start" => button::START,
        "select" => button::SELECT,
        "up" => button::UP,
        "down" => button::DOWN,
        "left" => button::LEFT,
        "right" => button::RIGHT,
        _ => return None,
    })
}

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let (Some(command), Some(path)) = (args.next(), args.next()) else {
        return usage();
    };
    if command == "info" {
        return match std::fs::read(&path) {
            Ok(image) => {
                match Format::detect(&image) {
                    Some(format) => println!("{path}: {format:?} ({:?})", format.platform()),
                    None => println!("{path}: unknown format"),
                }
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("{path}: {e}");
                ExitCode::FAILURE
            }
        };
    }
    if command != "run" {
        return usage();
    }
    let (mut frames, mut every, mut taps, mut options, mut save, mut dump) = (
        600_u64,
        60_u64,
        Vec::<(u64, u32)>::new(),
        Options::default(),
        true,
        None::<PathBuf>,
    );
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--frames" => frames = args.next().and_then(|v| v.parse().ok()).unwrap_or(frames),
            "--every" => {
                every = args
                    .next()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(every)
                    .max(1)
            }
            "--data" => options.data_dir = args.next().map(PathBuf::from),
            "--no-save" => save = false,
            "--save-type" => {
                options.save_type = match args.next().as_deref() {
                    Some("none") => SaveType::None,
                    Some("eeprom512") => SaveType::Eeprom512B,
                    Some("eeprom8k") => SaveType::Eeprom8K,
                    Some("eeprom64k") => SaveType::Eeprom64K,
                    Some("eeprom128k") => SaveType::Eeprom128K,
                    Some("flash256k") => SaveType::Flash256K,
                    Some("flash512k") => SaveType::Flash512K,
                    Some("flash1m") => SaveType::Flash1M,
                    _ => return usage(),
                }
            }
            "--dump" => dump = args.next().map(PathBuf::from),
            "--tap" => {
                let spec = args.next().unwrap_or_default();
                match spec
                    .split_once('@')
                    .and_then(|(b, f)| Some((f.parse().ok()?, button_bit(b)?)))
                {
                    Some(tap) => taps.push(tap),
                    None => return usage(),
                }
            }
            _ => return usage(),
        }
    }
    if !save {
        // A throwaway backup so a test run never touches the image directory.
        options.save_path = Some(std::env::temp_dir().join("nds-sdk-run.sav"));
        let _ = std::fs::remove_file(options.save_path.as_ref().unwrap());
    }
    let mut machine = match open(&path, &options) {
        Ok(machine) => machine,
        Err(e) => {
            eprintln!("boot failed: {e}");
            return ExitCode::FAILURE;
        }
    };
    println!(
        "{} \"{}\" {:.2} Hz",
        format!("{:?}", machine.platform()),
        machine.title(),
        machine.refresh_rate()
    );
    for frame in 0..frames {
        // A tap holds the button for 6 frames.
        let buttons = taps
            .iter()
            .filter(|(at, _)| (*at..*at + 6).contains(&frame))
            .fold(0, |acc, (_, bit)| acc | bit);
        machine.set_input(&Input {
            buttons,
            ..Input::default()
        });
        match machine.run_frame() {
            Step::Frame => {}
            Step::Shutdown => {
                println!("shutdown at frame {frame}");
                break;
            }
            Step::Fault(why) => {
                println!("fault at frame {frame}: {why}");
                println!("{}", machine.status());
                return ExitCode::FAILURE;
            }
        }
        if (frame + 1) % every == 0 {
            let lit = |id| {
                machine
                    .image(id)
                    .rgba
                    .chunks_exact(4)
                    .filter(|p| p[..3] != [0, 0, 0])
                    .count()
            };
            println!(
                "frame {:>6} hash {:016x} lit px top {} bottom {}",
                frame + 1,
                frame_hash(&*machine),
                lit(ScreenId::Top),
                lit(ScreenId::Bottom)
            );
        }
    }
    if let Some(dir) = dump {
        // Local inspection only: P6 files, never committed.
        let _ = std::fs::create_dir_all(&dir);
        for (name, id) in [("top", ScreenId::Top), ("bottom", ScreenId::Bottom)] {
            let image = machine.image(id);
            let mut ppm = format!(
                "P6
{} {}
255
",
                image.width, image.height
            )
            .into_bytes();
            ppm.extend(image.rgba.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]));
            let _ = std::fs::write(dir.join(format!("{name}.ppm")), ppm);
        }
    }
    let console = machine.take_console();
    if !console.trim().is_empty() {
        println!("console: {}", console.trim().lines().last().unwrap_or(""));
    }
    println!("{}", machine.status());
    ExitCode::SUCCESS
}
