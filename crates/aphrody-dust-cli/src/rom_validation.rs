use anyhow::{Result, bail};
use aphrody_dust_core::rom::raw;

/// Checks declared cartridge ranges before commands invoke deeper ROM parsers.
pub fn validate_regions(rom: &raw::Rom<'_>) -> Result<()> {
    let inspection = rom.inspect()?;
    if let Err(regions) = inspection.validate_regions() {
        let details = regions
            .iter()
            .map(|region| {
                format!(
                    "{:?} ({:#x}+{:#x})",
                    region.kind, region.offset, region.size
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        bail!("ROM header declares invalid regions: {details}");
    }
    Ok(())
}
