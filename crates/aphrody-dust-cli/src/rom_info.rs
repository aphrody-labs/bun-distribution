use std::path::PathBuf;

use anyhow::Result;
use aphrody_dust_core::rom::raw;
use clap::Args;
use serde::Serialize;

#[derive(Args)]
pub struct RomInfo {
    /// ROM image to inspect.
    pub path: PathBuf,
    /// Print machine-readable JSON.
    #[arg(long)]
    pub json: bool,
}

#[derive(Serialize)]
struct RomReport {
    title: String,
    game_code: String,
    maker_code: String,
    platform: &'static str,
    unit_code: u8,
    file_size: u64,
    ds_region_size: u64,
    dsi_region_size: u64,
    has_arm9i: bool,
    has_arm7i: bool,
    header_crc_valid: bool,
    logo_crc_valid: bool,
    valid: bool,
    invalid_regions: Vec<String>,
    dsi_encryption_supported: bool,
}

impl RomInfo {
    pub fn run(&self) -> Result<()> {
        let image = raw::Rom::from_file(&self.path)?;
        let inspection = image.inspect()?;
        let invalid_regions = inspection
            .invalid_regions()
            .map(|region| format!("{:?}: {:#x}+{:#x}", region.kind, region.offset, region.size))
            .collect::<Vec<_>>();
        let report = RomReport {
            title: inspection.title.clone(),
            game_code: inspection.game_code.clone(),
            maker_code: inspection.maker_code.clone(),
            platform: if inspection.is_dsi {
                "DSi enhanced"
            } else {
                "Nintendo DS"
            },
            unit_code: inspection.unit_code,
            file_size: inspection.file_size,
            ds_region_size: inspection.ds_region_size,
            dsi_region_size: inspection.dsi_region_size,
            has_arm9i: inspection
                .regions
                .iter()
                .any(|region| region.kind == raw::RomRegionKind::Arm9i && region.present),
            has_arm7i: inspection
                .regions
                .iter()
                .any(|region| region.kind == raw::RomRegionKind::Arm7i && region.present),
            header_crc_valid: inspection.header_crc_valid,
            logo_crc_valid: inspection.logo_crc_valid,
            valid: inspection.is_valid(),
            invalid_regions: invalid_regions.clone(),
            dsi_encryption_supported: false,
        };

        if self.json {
            println!("{}", serde_json::to_string_pretty(&report)?);
        } else {
            println!("Title: {}", report.title);
            println!("Game code: {} ({})", report.game_code, report.maker_code);
            println!(
                "Platform: {} (unit code {})",
                report.platform, report.unit_code
            );
            println!("File size: {} bytes", report.file_size);
            println!("DS region: {} bytes", report.ds_region_size);
            println!("DSi region: {} bytes", report.dsi_region_size);
            println!("ARM9i: {}; ARM7i: {}", report.has_arm9i, report.has_arm7i);
            println!(
                "Header CRC: {}",
                if inspection.header_crc_valid {
                    "valid"
                } else {
                    "invalid"
                }
            );
            println!(
                "Logo CRC: {}",
                if inspection.logo_crc_valid {
                    "valid"
                } else {
                    "invalid"
                }
            );
            println!(
                "ROM validation: {}",
                if report.valid {
                    "passed"
                } else {
                    "issues found"
                }
            );
            if invalid_regions.is_empty() {
                println!("Declared regions: valid");
            } else {
                println!("Invalid declared regions: {}", invalid_regions.join(", "));
            }
            println!("DSi decryption: unsupported");
        }
        Ok(())
    }
}
