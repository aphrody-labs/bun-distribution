// SPDX-License-Identifier: Apache-2.0
//! Live memory inspection for Windows processes running under Wine / Proton / Linux.
//!
//! Provides process discovery, memory map inspection (`/proc/[pid]/maps`),
//! arbitrary virtual memory reading (`/proc/[pid]/mem`), and AOB pattern scanning.

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use super::aob::AobPattern;
use crate::game::error::{ReError, Result};

/// A mapped virtual memory region of a target process.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemoryRegion {
    pub start: u64,
    pub end: u64,
    pub is_readable: bool,
    pub is_writable: bool,
    pub is_executable: bool,
    pub offset: u64,
    pub pathname: String,
}

impl MemoryRegion {
    pub fn size(&self) -> u64 {
        self.end.saturating_sub(self.start)
    }
}

/// Live telemetry for an in-combat DBXV2 battle character.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LiveBattleCharacter {
    pub address: u64,
    pub character_id: u32,
    pub costume_id: u32,
    pub current_hp: f32,
    pub max_hp: f32,
    pub current_ki: f32,
    pub max_ki: f32,
    pub current_stamina: f32,
    pub max_stamina: f32,
    pub transform_state: u32,
}

/// Inspector for a running process under Wine / Linux.
#[derive(Debug)]
pub struct WineProcessMemory {
    pub pid: u32,
    pub process_name: String,
    pub base_address: u64,
    pub regions: Vec<MemoryRegion>,
}

impl WineProcessMemory {
    /// Discovers a running process by executable name (e.g. "DBXV2.exe" or "DBXV2").
    pub fn find_by_name(target_name: &str) -> Result<Option<u32>> {
        let proc_dir = Path::new("/proc");
        if !proc_dir.exists() {
            return Ok(None);
        }

        let target_lower = target_name.to_lowercase();
        let target_stem = target_lower.strip_suffix(".exe").unwrap_or(&target_lower);

        for entry in fs::read_dir(proc_dir)? {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };

            let file_name = entry.file_name();
            let pid_str = file_name.to_string_lossy();
            let pid: u32 = match pid_str.parse() {
                Ok(p) => p,
                Err(_) => continue,
            };

            let cmdline_path = entry.path().join("cmdline");
            if let Ok(cmdline_bytes) = fs::read(&cmdline_path) {
                let cmdline = String::from_utf8_lossy(&cmdline_bytes).to_lowercase();
                if cmdline.contains(&target_lower) || cmdline.contains(target_stem) {
                    return Ok(Some(pid));
                }
            }

            let comm_path = entry.path().join("comm");
            if let Ok(comm_str) = fs::read_to_string(&comm_path) {
                let comm_lower = comm_str.trim().to_lowercase();
                if comm_lower.contains(&target_lower) || comm_lower.contains(target_stem) {
                    return Ok(Some(pid));
                }
            }
        }

        Ok(None)
    }

    /// Attaches to a process PID and parses its virtual memory mapping.
    pub fn attach(pid: u32, process_name: &str) -> Result<Self> {
        let maps_path = format!("/proc/{pid}/maps");
        let content = fs::read_to_string(&maps_path).map_err(|e| ReError::ParseError {
            context: "process_attach",
            details: format!("Failed to read {maps_path}: {e}"),
        })?;

        let mut regions = Vec::new();
        let mut base_address = 0u64;

        for line in content.lines() {
            if let Some(region) = parse_maps_line(line) {
                if base_address == 0
                    && region
                        .pathname
                        .to_lowercase()
                        .contains(&process_name.to_lowercase())
                    && region.is_executable
                {
                    base_address = region.start;
                }
                regions.push(region);
            }
        }

        if base_address == 0 && !regions.is_empty() {
            // Default 64-bit PE image base in Wine
            base_address = regions[0].start;
        }

        Ok(Self {
            pid,
            process_name: process_name.to_string(),
            base_address,
            regions,
        })
    }

    /// Reads `len` bytes from virtual memory at `address`.
    pub fn read_bytes(&self, address: u64, len: usize) -> Result<Vec<u8>> {
        let mem_path = format!("/proc/{}/mem", self.pid);
        let mut file = File::open(&mem_path).map_err(|e| ReError::ParseError {
            context: "read_memory",
            details: format!("Cannot open {mem_path}: {e}"),
        })?;

        file.seek(SeekFrom::Start(address))
            .map_err(|e| ReError::ParseError {
                context: "seek_memory",
                details: format!("Cannot seek to 0x{address:x}: {e}"),
            })?;

        let mut buffer = vec![0u8; len];
        file.read_exact(&mut buffer)
            .map_err(|e| ReError::ParseError {
                context: "read_exact_memory",
                details: format!("Cannot read {len} bytes at 0x{address:x}: {e}"),
            })?;

        Ok(buffer)
    }

    /// Reads a 32-bit floating point value at `address`.
    pub fn read_f32(&self, address: u64) -> Result<f32> {
        let bytes = self.read_bytes(address, 4)?;
        Ok(f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    /// Reads a 32-bit unsigned integer at `address`.
    pub fn read_u32(&self, address: u64) -> Result<u32> {
        let bytes = self.read_bytes(address, 4)?;
        Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    /// Scans readable memory regions for an AOB pattern.
    pub fn scan_aob(&self, pattern: &AobPattern, limit: usize) -> Vec<u64> {
        let mut results = Vec::new();
        for region in &self.regions {
            if !region.is_readable || region.size() > 128 * 1024 * 1024 {
                // Skip non-readable or huge memory pages
                continue;
            }

            if let Ok(data) = self.read_bytes(region.start, region.size() as usize) {
                let matches = pattern.scan_all(&data, limit.saturating_sub(results.len()));
                for offset in matches {
                    results.push(region.start + offset as u64);
                    if results.len() >= limit {
                        return results;
                    }
                }
            }
        }
        results
    }

    /// Reads live battle character stats if address is valid.
    pub fn inspect_battle_character(&self, address: u64) -> Result<LiveBattleCharacter> {
        // Standard DBXV2 battle struct layout offsets
        let current_hp = self.read_f32(address + 0x0E8).unwrap_or(0.0);
        let max_hp = self.read_f32(address + 0x0EC).unwrap_or(current_hp);
        let current_ki = self.read_f32(address + 0x0F0).unwrap_or(0.0);
        let max_ki = self.read_f32(address + 0x0F4).unwrap_or(current_ki);
        let current_stamina = self.read_f32(address + 0x0F8).unwrap_or(0.0);
        let max_stamina = self.read_f32(address + 0x0FC).unwrap_or(current_stamina);
        let character_id = self.read_u32(address + 0x040).unwrap_or(0);
        let costume_id = self.read_u32(address + 0x044).unwrap_or(0);
        let transform_state = self.read_u32(address + 0x110).unwrap_or(0);

        Ok(LiveBattleCharacter {
            address,
            character_id,
            costume_id,
            current_hp,
            max_hp,
            current_ki,
            max_ki,
            current_stamina,
            max_stamina,
            transform_state,
        })
    }
}

fn parse_maps_line(line: &str) -> Option<MemoryRegion> {
    let mut parts = line.split_whitespace();
    let addr_range = parts.next()?;
    let perms = parts.next()?;
    let offset_str = parts.next()?;
    let _dev = parts.next();
    let _inode = parts.next();
    let pathname = parts.next().unwrap_or("").to_string();

    let mut addrs = addr_range.split('-');
    let start = u64::from_str_radix(addrs.next()?, 16).ok()?;
    let end = u64::from_str_radix(addrs.next()?, 16).ok()?;
    let offset = u64::from_str_radix(offset_str, 16).unwrap_or(0);

    let is_readable = perms.contains('r');
    let is_writable = perms.contains('w');
    let is_executable = perms.contains('x');

    Some(MemoryRegion {
        start,
        end,
        is_readable,
        is_writable,
        is_executable,
        offset,
        pathname,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_maps_line() {
        let line = "140000000-1416bd000 r-xp 00000000 08:01 1234567 /games/dbxv2/bin/DBXV2.exe";
        let region = parse_maps_line(line).expect("Should parse valid line");
        assert_eq!(region.start, 0x140000000);
        assert_eq!(region.end, 0x1416bd000);
        assert!(region.is_readable);
        assert!(!region.is_writable);
        assert!(region.is_executable);
        assert_eq!(region.pathname, "/games/dbxv2/bin/DBXV2.exe");
    }
}
