//! x86 guest on the Windows Hypervisor Platform: one partition, flat guest RAM, one virtual CPU
//! entered in real mode, and a 16550 serial port on COM1. Linux and Windows guests build on
//! this partition; here it boots a flat image and returns when the guest halts.

use std::ffi::c_void;

use windows::Win32::System::{
    Hypervisor::{
        WHV_MAP_GPA_RANGE_FLAGS, WHV_PARTITION_HANDLE, WHV_REGISTER_VALUE, WHV_RUN_VP_EXIT_CONTEXT,
        WHV_X64_SEGMENT_REGISTER, WHV_X64_SEGMENT_REGISTER_0, WHvCreatePartition,
        WHvCreateVirtualProcessor, WHvDeletePartition, WHvMapGpaRange, WHvPartitionPropertyCodeProcessorCount,
        WHvX64RegisterRflags, WHvX64RegisterRip, WHvX64RegisterRax, WHvX64RegisterCs, WHvRunVirtualProcessor,
        WHvRunVpExitReasonX64Halt, WHvRunVpExitReasonX64IoPortAccess, WHvSetPartitionProperty,
        WHvSetVirtualProcessorRegisters, WHvSetupPartition, WHvDeleteVirtualProcessor,
        WHvMapGpaRangeFlagExecute, WHvMapGpaRangeFlagRead, WHvMapGpaRangeFlagWrite,
        WHvGetVirtualProcessorRegisters, WHV_REGISTER_NAME,
    },
    Memory::{MEM_COMMIT, MEM_RELEASE, MEM_RESERVE, PAGE_READWRITE, VirtualAlloc, VirtualFree},
};

use crate::{Machine, Screen, Step};

const COM1: u16 = 0x3f8;
const COM1_LSR: u16 = COM1 + 5;
const ENTRY: u64 = 0x1000;
const EXITS_PER_FRAME: usize = 100_000;

pub struct X86 {
    partition: WHV_PARTITION_HANDLE,
    ram: *mut c_void,
    serial: Vec<u8>,
    halted: bool,
}

fn seg(selector: u16, attributes: u16) -> WHV_REGISTER_VALUE {
    WHV_REGISTER_VALUE {
        Segment: WHV_X64_SEGMENT_REGISTER {
            Base: 0,
            Limit: 0xffff,
            Selector: selector,
            Anonymous: WHV_X64_SEGMENT_REGISTER_0 { Attributes: attributes },
        },
    }
}

impl X86 {
    /// Boots `image` at 0x1000 in real mode with `ram_mib` MiB of guest memory.
    pub fn from_image(image: &[u8], ram_mib: usize) -> Result<Self, String> {
        let size = ram_mib << 20;
        if ENTRY as usize + image.len() > size {
            return Err(format!("the image ({} bytes) does not fit in {ram_mib} MiB of RAM", image.len()));
        }
        let err = |what: &str, e: windows::core::Error| format!("{what}: {e}");
        unsafe {
            let partition = WHvCreatePartition().map_err(|e| err("WHvCreatePartition", e))?;
            let ram = VirtualAlloc(None, size, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
            if ram.is_null() {
                let _ = WHvDeletePartition(partition);
                return Err("VirtualAlloc failed".into());
            }
            let machine = Self { partition, ram, serial: Vec::new(), halted: false };
            std::ptr::copy_nonoverlapping(image.as_ptr(), ram.cast::<u8>().add(ENTRY as usize), image.len());
            let cpus: u32 = 1;
            WHvSetPartitionProperty(
                partition,
                WHvPartitionPropertyCodeProcessorCount,
                (&raw const cpus).cast(),
                size_of::<u32>() as u32,
            )
            .map_err(|e| err("processor count", e))?;
            WHvSetupPartition(partition).map_err(|e| err("WHvSetupPartition", e))?;
            WHvMapGpaRange(
                partition,
                ram,
                0,
                size as u64,
                WHvMapGpaRangeFlagRead | WHvMapGpaRangeFlagWrite | WHvMapGpaRangeFlagExecute,
            )
            .map_err(|e| err("WHvMapGpaRange", e))?;
            WHvCreateVirtualProcessor(partition, 0, 0).map_err(|e| err("WHvCreateVirtualProcessor", e))?;
            let names = [WHvX64RegisterRip, WHvX64RegisterRflags, WHvX64RegisterCs];
            let values = [
                WHV_REGISTER_VALUE { Reg64: ENTRY },
                WHV_REGISTER_VALUE { Reg64: 2 },
                // Present, code, readable: flat 16-bit code segment at 0.
                seg(0, 0x9b),
            ];
            WHvSetVirtualProcessorRegisters(partition, 0, names.as_ptr(), 3, values.as_ptr())
                .map_err(|e| err("registers", e))?;
            Ok(machine)
        }
    }

    fn reg(&self, name: WHV_REGISTER_NAME) -> u64 {
        let mut value = WHV_REGISTER_VALUE::default();
        unsafe {
            let _ = WHvGetVirtualProcessorRegisters(self.partition, 0, &raw const name, 1, &raw mut value);
            value.Reg64
        }
    }

    pub fn rax(&self) -> u64 {
        self.reg(WHvX64RegisterRax)
    }

    pub fn take_serial(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.serial)
    }

    fn set_reg(&self, name: WHV_REGISTER_NAME, value: u64) {
        let v = WHV_REGISTER_VALUE { Reg64: value };
        unsafe {
            let _ = WHvSetVirtualProcessorRegisters(self.partition, 0, &raw const name, 1, &raw const v);
        }
    }
}

impl Drop for X86 {
    fn drop(&mut self) {
        unsafe {
            let _ = WHvDeleteVirtualProcessor(self.partition, 0);
            let _ = WHvDeletePartition(self.partition);
            let _ = VirtualFree(self.ram, 0, MEM_RELEASE);
        }
    }
}

impl Machine for X86 {
    fn name(&self) -> &'static str {
        "x86-whp"
    }

    fn run_frame(&mut self) -> Step {
        if self.halted {
            return Step::Shutdown;
        }
        for _ in 0..EXITS_PER_FRAME {
            let mut exit = WHV_RUN_VP_EXIT_CONTEXT::default();
            let run = unsafe {
                WHvRunVirtualProcessor(
                    self.partition,
                    0,
                    (&raw mut exit).cast(),
                    size_of::<WHV_RUN_VP_EXIT_CONTEXT>() as u32,
                )
            };
            if run.is_err() {
                self.halted = true;
                return Step::Shutdown;
            }
            if exit.ExitReason == WHvRunVpExitReasonX64Halt {
                self.halted = true;
                return Step::Shutdown;
            }
            if exit.ExitReason != WHvRunVpExitReasonX64IoPortAccess {
                self.halted = true;
                return Step::Shutdown;
            }
            let io = unsafe { exit.Anonymous.IoPortAccess };
            let is_write = unsafe { io.AccessInfo.AsUINT32 } & 1 != 0;
            let mut rax = io.Rax;
            if is_write {
                if io.PortNumber == COM1 {
                    self.serial.push(io.Rax as u8);
                }
            } else {
                // LSR: transmitter empty and holding register empty; all other ports float high.
                let v = if io.PortNumber == COM1_LSR { 0x60 } else { 0xff };
                rax = (rax & !0xff) | v;
            }
            let length = u64::from(exit.VpContext._bitfield & 0xf);
            if !is_write {
                self.set_reg(WHvX64RegisterRax, rax);
            }
            self.set_reg(WHvX64RegisterRip, exit.VpContext.Rip + length);
        }
        Step::Frame
    }

    fn screens(&self) -> Vec<Screen> {
        Vec::new()
    }

    fn console(&mut self) -> Vec<u8> {
        self.take_serial()
    }
}
