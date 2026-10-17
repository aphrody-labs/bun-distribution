//! x86 guests on the Windows Hypervisor Platform: one partition with an emulated local APIC,
//! flat guest RAM, one virtual CPU and a 16550 serial port on COM1.
//!
//! Two entry paths share the partition: a flat real-mode image, and a Linux `vmlinux` ELF booted
//! with the 64-bit boot protocol (identity-mapped long mode, zero page with an e820 map, command
//! line) so no BIOS is involved.

use std::ffi::c_void;

use windows::Win32::System::{
    Hypervisor::{
        WHV_PARTITION_HANDLE, WHV_REGISTER_NAME, WHV_REGISTER_VALUE,
        WHV_RUN_VP_EXIT_CONTEXT, WHV_X64_SEGMENT_REGISTER, WHV_X64_SEGMENT_REGISTER_0,
        WHV_X64_TABLE_REGISTER, WHvCreatePartition, WHvCreateVirtualProcessor, WHvDeletePartition,
        WHvDeleteVirtualProcessor, WHvGetVirtualProcessorRegisters, WHvMapGpaRange,
        WHvMapGpaRangeFlagExecute, WHvMapGpaRangeFlagRead, WHvMapGpaRangeFlagWrite,
        WHvPartitionPropertyCodeLocalApicEmulationMode, WHvPartitionPropertyCodeProcessorCount,
        WHvRunVirtualProcessor, WHvRunVpExitReasonX64Halt, WHvRunVpExitReasonX64IoPortAccess,
        WHvRunVpExitReasonX64MsrAccess, WHvSetPartitionProperty, WHvSetVirtualProcessorRegisters,
        WHvSetupPartition, WHvX64RegisterCr0, WHvX64RegisterCr3, WHvX64RegisterCr4,
        WHvX64RegisterCs, WHvX64RegisterDs, WHvX64RegisterEfer, WHvX64RegisterEs,
        WHvX64RegisterFs, WHvX64RegisterGdtr, WHvX64RegisterGs, WHvX64RegisterIdtr,
        WHvX64RegisterRax, WHvX64RegisterRdx, WHvX64RegisterRflags, WHvX64RegisterRip,
        WHvX64RegisterRsi, WHvX64RegisterRsp, WHvX64RegisterSs, WHvX64RegisterTr, WHvX64RegisterLdtr,
    },
    Memory::{MEM_COMMIT, MEM_RELEASE, MEM_RESERVE, PAGE_READWRITE, VirtualAlloc, VirtualFree},
};

use super::{Machine, Screen, Step};

const COM1: u16 = 0x3f8;
const ENTRY: u64 = 0x1000;
const EXITS_PER_FRAME: usize = 200_000;

const GDT: u64 = 0x500;
const BOOT_PARAMS: u64 = 0x7000;
const PML4: u64 = 0x9000;
const CMDLINE: u64 = 0x2_0000;
const STACK: u64 = 0x8ff0;

/// A 16550 as far as Linux's probing looks: scratch and loopback work, the transmitter is
/// always empty, and bytes written to the data register are collected.
#[derive(Default)]
struct Uart {
    ier: u8,
    lcr: u8,
    mcr: u8,
    scr: u8,
    dll: u8,
    dlm: u8,
    out: Vec<u8>,
}

impl Uart {
    fn read(&self, reg: u16) -> u8 {
        let dlab = self.lcr & 0x80 != 0;
        match reg {
            0 if dlab => self.dll,
            1 if dlab => self.dlm,
            1 => self.ier,
            2 => 0x01,
            3 => self.lcr,
            4 => self.mcr,
            5 => 0x60,
            6 => {
                if self.mcr & 0x10 != 0 {
                    ((self.mcr & 0x0c) << 4) | ((self.mcr & 0x02) << 3) | ((self.mcr & 0x01) << 5)
                } else {
                    0xb0
                }
            }
            7 => self.scr,
            _ => 0,
        }
    }

    fn write(&mut self, reg: u16, value: u8) {
        let dlab = self.lcr & 0x80 != 0;
        match reg {
            0 if dlab => self.dll = value,
            0 => self.out.push(value),
            1 if dlab => self.dlm = value,
            1 => self.ier = value,
            3 => self.lcr = value,
            4 => self.mcr = value,
            7 => self.scr = value,
            _ => {}
        }
    }
}

pub struct X86 {
    partition: WHV_PARTITION_HANDLE,
    ram: *mut c_void,
    size: usize,
    uart: Uart,
    halted: bool,
    pub diagnostic: Option<String>,
}

fn seg(selector: u16, attributes: u16) -> WHV_REGISTER_VALUE {
    WHV_REGISTER_VALUE {
        Segment: WHV_X64_SEGMENT_REGISTER {
            Base: 0,
            Limit: 0xffff_ffff,
            Selector: selector,
            Anonymous: WHV_X64_SEGMENT_REGISTER_0 { Attributes: attributes },
        },
    }
}

fn table(base: u64, limit: u16) -> WHV_REGISTER_VALUE {
    WHV_REGISTER_VALUE { Table: WHV_X64_TABLE_REGISTER { Pad: [0; 3], Limit: limit, Base: base } }
}

fn gpr(value: u64) -> WHV_REGISTER_VALUE {
    WHV_REGISTER_VALUE { Reg64: value }
}

fn err(what: &str, e: windows::core::Error) -> String {
    format!("{what}: {e}")
}

impl X86 {
    fn create(ram_mib: usize, apic: bool) -> Result<Self, String> {
        let size = ram_mib << 20;
        unsafe {
            let partition = WHvCreatePartition().map_err(|e| err("WHvCreatePartition", e))?;
            let ram = VirtualAlloc(None, size, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
            if ram.is_null() {
                let _ = WHvDeletePartition(partition);
                return Err("VirtualAlloc failed".into());
            }
            let machine =
                Self { partition, ram, size, uart: Uart::default(), halted: false, diagnostic: None };
            let cpus: u32 = 1;
            WHvSetPartitionProperty(
                partition,
                WHvPartitionPropertyCodeProcessorCount,
                (&raw const cpus).cast(),
                size_of::<u32>() as u32,
            )
            .map_err(|e| err("processor count", e))?;
            // xAPIC for OS guests: the hypervisor emulates the local APIC and its timer, and then
            // services HLT itself. Flat images keep HLT as an exit so the host sees the halt.
            if apic {
                let mode: u32 = 1;
                WHvSetPartitionProperty(
                    partition,
                    WHvPartitionPropertyCodeLocalApicEmulationMode,
                    (&raw const mode).cast(),
                    size_of::<u32>() as u32,
                )
                .map_err(|e| err("local APIC mode", e))?;
            }
            WHvSetupPartition(partition).map_err(|e| err("WHvSetupPartition", e))?;
            WHvMapGpaRange(
                partition,
                ram,
                0,
                size as u64,
                WHvMapGpaRangeFlagRead | WHvMapGpaRangeFlagWrite | WHvMapGpaRangeFlagExecute,
            )
            .map_err(|e| err("WHvMapGpaRange", e))?;
            WHvCreateVirtualProcessor(partition, 0, 0)
                .map_err(|e| err("WHvCreateVirtualProcessor", e))?;
            Ok(machine)
        }
    }

    fn ram_mut(&mut self, gpa: u64, len: usize) -> Result<&mut [u8], String> {
        if gpa as usize + len > self.size {
            return Err(format!("guest write at {gpa:#x}+{len:#x} is outside {} MiB of RAM", self.size >> 20));
        }
        Ok(unsafe { std::slice::from_raw_parts_mut(self.ram.cast::<u8>().add(gpa as usize), len) })
    }

    fn set_regs(&self, regs: &[(WHV_REGISTER_NAME, WHV_REGISTER_VALUE)]) -> Result<(), String> {
        let names: Vec<_> = regs.iter().map(|r| r.0).collect();
        let values: Vec<_> = regs.iter().map(|r| r.1).collect();
        unsafe {
            WHvSetVirtualProcessorRegisters(
                self.partition,
                0,
                names.as_ptr(),
                names.len() as u32,
                values.as_ptr(),
            )
        }
        .map_err(|e| err("registers", e))
    }

    /// Boots `image` at 0x1000 in real mode with `ram_mib` MiB of guest memory.
    pub fn from_image(image: &[u8], ram_mib: usize) -> Result<Self, String> {
        let mut m = Self::create(ram_mib, false)?;
        m.ram_mut(ENTRY, image.len())?.copy_from_slice(image);
        // Flat 16-bit code segment at 0: present, code, readable.
        m.set_regs(&[
            (WHvX64RegisterRip, gpr(ENTRY)),
            (WHvX64RegisterRflags, gpr(2)),
            (WHvX64RegisterCs, WHV_REGISTER_VALUE {
                Segment: WHV_X64_SEGMENT_REGISTER {
                    Base: 0,
                    Limit: 0xffff,
                    Selector: 0,
                    Anonymous: WHV_X64_SEGMENT_REGISTER_0 { Attributes: 0x9b },
                },
            }),
        ])?;
        Ok(m)
    }

    /// Boots an uncompressed Linux `vmlinux` ELF directly into 64-bit mode.
    pub fn from_linux(vmlinux: &[u8], cmdline: &str, ram_mib: usize) -> Result<Self, String> {
        let mut m = Self::create(ram_mib, true)?;
        let u16at = |o: usize| u16::from_le_bytes(vmlinux[o..o + 2].try_into().unwrap());
        let u64at = |o: usize| u64::from_le_bytes(vmlinux[o..o + 8].try_into().unwrap());
        if vmlinux.len() < 64 || &vmlinux[..4] != b"\x7fELF" || vmlinux[4] != 2 {
            return Err("not a 64-bit ELF kernel (expected an uncompressed vmlinux)".into());
        }
        let entry = u64at(24);
        let (phoff, phentsize, phnum) = (u64at(32) as usize, u16at(54) as usize, u16at(56) as usize);
        for i in 0..phnum {
            let ph = phoff + i * phentsize;
            let kind = u32::from_le_bytes(vmlinux[ph..ph + 4].try_into().unwrap());
            if kind != 1 {
                continue;
            }
            let (offset, paddr, filesz, memsz) =
                (u64at(ph + 8) as usize, u64at(ph + 24), u64at(ph + 32) as usize, u64at(ph + 40) as usize);
            let dst = m.ram_mut(paddr, memsz)?;
            dst[..filesz].copy_from_slice(&vmlinux[offset..offset + filesz]);
            dst[filesz..].fill(0);
        }

        // GDT: null, null, 64-bit code (0x10), data (0x18).
        let gdt: [u64; 4] = [0, 0, 0x00af_9b00_0000_ffff, 0x00cf_9300_0000_ffff];
        for (i, e) in gdt.iter().enumerate() {
            m.ram_mut(GDT + 8 * i as u64, 8)?.copy_from_slice(&e.to_le_bytes());
        }
        // Identity map the first GiB with 2 MiB pages.
        m.ram_mut(PML4, 8)?.copy_from_slice(&(PML4 + 0x1000 | 3).to_le_bytes());
        m.ram_mut(PML4 + 0x1000, 8)?.copy_from_slice(&(PML4 + 0x2000 | 3).to_le_bytes());
        let pd = m.ram_mut(PML4 + 0x2000, 4096)?;
        for i in 0..512_u64 {
            let e = (i << 21) | 0x83;
            pd[8 * i as usize..8 * i as usize + 8].copy_from_slice(&e.to_le_bytes());
        }

        let mut cmd = cmdline.as_bytes().to_vec();
        cmd.push(0);
        m.ram_mut(CMDLINE, cmd.len())?.copy_from_slice(&cmd);

        let size = (ram_mib as u64) << 20;
        let bp = m.ram_mut(BOOT_PARAMS, 4096)?;
        bp.fill(0);
        bp[0x1fe..0x200].copy_from_slice(&0xaa55_u16.to_le_bytes());
        bp[0x202..0x206].copy_from_slice(&0x5372_6448_u32.to_le_bytes()); // "HdrS"
        bp[0x206..0x208].copy_from_slice(&0x020f_u16.to_le_bytes());
        bp[0x210] = 0xff; // type_of_loader: undefined
        bp[0x211] = 0x01; // LOADED_HIGH
        bp[0x228..0x22c].copy_from_slice(&(CMDLINE as u32).to_le_bytes());
        bp[0x230..0x234].copy_from_slice(&0x0100_0000_u32.to_le_bytes()); // kernel_alignment
        bp[0x238..0x23c].copy_from_slice(&(cmd.len() as u32 - 1).max(1).to_le_bytes()); // cmdline_size
        // e820: conventional memory below 640 KiB, then everything above 1 MiB.
        let map: [(u64, u64); 2] = [(0, 0x9_fc00), (0x10_0000, size - 0x10_0000)];
        bp[0x1e8] = map.len() as u8;
        for (i, (addr, len)) in map.iter().enumerate() {
            let o = 0x2d0 + 20 * i;
            bp[o..o + 8].copy_from_slice(&addr.to_le_bytes());
            bp[o + 8..o + 16].copy_from_slice(&len.to_le_bytes());
            bp[o + 16..o + 20].copy_from_slice(&1_u32.to_le_bytes());
        }

        // 64-bit code: type 0xb, S, P, L. Data: type 3, S, P, D/B, G.
        let code = 0x209b;
        let data = 0xc093;
        m.set_regs(&[
            (WHvX64RegisterCr0, gpr(0x8000_0011)),
            (WHvX64RegisterCr3, gpr(PML4)),
            (WHvX64RegisterCr4, gpr(0x20)),
            (WHvX64RegisterEfer, gpr(0x500)),
            (WHvX64RegisterGdtr, table(GDT, 31)),
            (WHvX64RegisterIdtr, table(0, 0)),
            (WHvX64RegisterCs, seg(0x10, code)),
            (WHvX64RegisterDs, seg(0x18, data)),
            (WHvX64RegisterEs, seg(0x18, data)),
            (WHvX64RegisterFs, seg(0x18, data)),
            (WHvX64RegisterGs, seg(0x18, data)),
            (WHvX64RegisterSs, seg(0x18, data)),
            // Hyper-V requires a valid busy TSS and LDT even if the guest never uses them.
            (WHvX64RegisterTr, seg(0x20, 0x8b)),
            (WHvX64RegisterLdtr, seg(0, 0x82)),
            (WHvX64RegisterRflags, gpr(2)),
            (WHvX64RegisterRsp, gpr(STACK)),
            (WHvX64RegisterRsi, gpr(BOOT_PARAMS)),
            (WHvX64RegisterRip, gpr(entry)),
        ])?;
        Ok(m)
    }

    fn reg(&self, name: WHV_REGISTER_NAME) -> u64 {
        let mut value = WHV_REGISTER_VALUE::default();
        unsafe {
            let _ = WHvGetVirtualProcessorRegisters(self.partition, 0, &raw const name, 1, &raw mut value);
            value.Reg64
        }
    }

    pub fn take_serial(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.uart.out)
    }

    fn set_reg(&self, name: WHV_REGISTER_NAME, value: u64) {
        let v = gpr(value);
        unsafe {
            let _ = WHvSetVirtualProcessorRegisters(self.partition, 0, &raw const name, 1, &raw const v);
        }
    }

    fn stop(&mut self, why: String) -> Step {
        self.halted = true;
        self.diagnostic = Some(why);
        Step::Shutdown
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
            if let Err(e) = run {
                return self.stop(format!("WHvRunVirtualProcessor: {e}"));
            }
            let rip = exit.VpContext.Rip;
            let length = u64::from(exit.VpContext._bitfield & 0xf);
            match exit.ExitReason {
                r if r == WHvRunVpExitReasonX64Halt => {
                    // Halting with interrupts enabled waits for the emulated APIC timer.
                    if self.reg(WHvX64RegisterRflags) & 0x200 == 0 {
                        return self.stop(format!("halted with interrupts off at {rip:#x}"));
                    }
                    self.set_reg(WHvX64RegisterRip, rip + length);
                }
                r if r == WHvRunVpExitReasonX64IoPortAccess => {
                    let io = unsafe { exit.Anonymous.IoPortAccess };
                    let is_write = unsafe { io.AccessInfo.AsUINT32 } & 1 != 0;
                    let port = io.PortNumber;
                    let uart_reg = port.wrapping_sub(COM1);
                    if is_write {
                        if uart_reg < 8 {
                            self.uart.write(uart_reg, io.Rax as u8);
                        }
                    } else {
                        let v = if uart_reg < 8 { self.uart.read(uart_reg) } else { 0xff };
                        self.set_reg(WHvX64RegisterRax, (io.Rax & !0xff) | u64::from(v));
                    }
                    self.set_reg(WHvX64RegisterRip, rip + length);
                }
                r if r == WHvRunVpExitReasonX64MsrAccess => {
                    let msr = unsafe { exit.Anonymous.MsrAccess };
                    if unsafe { msr.AccessInfo.AsUINT32 } & 1 == 0 {
                        self.set_reg(WHvX64RegisterRax, 0);
                        self.set_reg(WHvX64RegisterRdx, 0);
                    }
                    self.set_reg(WHvX64RegisterRip, rip + length);
                }
                r => {
                    let gpa = unsafe { exit.Anonymous.MemoryAccess.Gpa };
                    return self.stop(format!("exit reason {:#x} at rip {rip:#x} (gpa {gpa:#x})", r.0));
                }
            }
        }
        Step::Frame
    }

    fn screens(&self) -> Vec<Screen> {
        Vec::new()
    }

    fn console(&mut self) -> Vec<u8> {
        self.take_serial()
    }

    fn diagnostic(&self) -> Option<String> {
        self.diagnostic.clone()
    }
}
