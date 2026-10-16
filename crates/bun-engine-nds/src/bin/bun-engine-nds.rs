use std::{env, error::Error, path::PathBuf};

use bun_engine_nds::dust::rom::raw;
use serde_json::json;

fn usage() -> ! {
    eprintln!("usage: bun-engine-nds info <rom.nds> [--json]");
    std::process::exit(2);
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("info")) {
        usage();
    }
    let path = args.next().map(PathBuf::from).unwrap_or_else(|| usage());
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
    Ok(())
}
