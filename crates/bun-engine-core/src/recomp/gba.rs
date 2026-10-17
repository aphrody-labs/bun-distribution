//! Game Boy Advance runtime of recompiled ARM7TDMI code (RustBoyAdvance-NG device models).
//!
//! The translated code keeps the CPU in exactly the state the interpreter would: the program
//! counter runs two fetches ahead, the prefetch pipeline holds the next two opcodes and every bus
//! access (instruction fetches included) goes through `SysBus` with the same access kind, so the
//! scheduler, DMA, timers and interrupts see identical cycle counts. Blocks stop before the next
//! instruction once the scheduler deadline passes or after a store that may change the bus master
//! or the interrupt state (I/O, cartridge backup), and the core resumes its loop.

use rustboyadvance_core::SysBus;
use rustboyadvance_core::arm7tdmi::memory::{MemoryAccess, MemoryInterface};
use rustboyadvance_core::arm7tdmi::{Arm7tdmiCore, CpuState};

/// The CPU type the dispatcher receives.
pub type Cpu = Arm7tdmiCore<SysBus>;

/// Translated block.
pub type Block = for<'a> fn(&mut Rt<'a>);

/// Block table of a generated crate (`key = address | thumb`).
pub type Lookup = fn(u32) -> Option<Block>;

/// Handle passed to translated blocks.
pub struct Rt<'a> {
    cpu: &'a mut Cpu,
    deadline: usize,
    stop: bool,
    executed: u64,
    fallback: bool,
}

#[inline(always)]
fn access(kind: u32) -> MemoryAccess {
    if kind == 0 {
        MemoryAccess::NonSeq
    } else {
        MemoryAccess::Seq
    }
}

/// Dispatcher installed as the core's CPU runner: run the translated block of the next
/// instruction, or return false so the interpreter executes it.
///
/// Blocks are chained without returning to the core loop while the scheduler deadline is ahead:
/// between two instructions the core only re-checks DMA, HALT and pending interrupts, which change
/// solely through scheduler events and the I/O stores that end a chain.
pub fn run(cpu: &mut Cpu, deadline: usize, lookup: Lookup) -> bool {
    let mut rt = Rt {
        cpu,
        deadline,
        stop: false,
        executed: 0,
        fallback: false,
    };
    let mut entries = 0u64;
    loop {
        let thumb = rt.cpu.cpsr.state() == CpuState::THUMB;
        let pc = rt.cpu.get_next_pc();
        let Some(block) = lookup(pc | u32::from(thumb)) else {
            break;
        };
        entries += 1;
        rt.executed += 1;
        block(&mut rt);
        if rt.stop || rt.fallback || rt.cpu.bus.timestamp() > deadline {
            break;
        }
    }
    if entries == 0 {
        super::count_interpreted(1);
        return false;
    }
    super::count_entries(rt.executed - u64::from(rt.fallback), entries, rt.fallback);
    true
}

impl Rt<'_> {
    /// Register `r0`..`r14`.
    #[inline(always)]
    pub fn r(&self, r: usize) -> u32 {
        self.cpu.gpr[r]
    }

    /// Write register `r0`..`r14`.
    #[inline(always)]
    pub fn set_r(&mut self, r: usize, v: u32) {
        self.cpu.gpr[r] = v;
    }

    /// Flag `n z c v` as 0 or 1.
    #[inline(always)]
    pub fn flag(&self, f: usize) -> u32 {
        u32::from(match f {
            0 => self.cpu.cpsr.N(),
            1 => self.cpu.cpsr.Z(),
            2 => self.cpu.cpsr.C(),
            _ => self.cpu.cpsr.V(),
        })
    }

    /// Write flag `n z c v`.
    #[inline(always)]
    pub fn set_flag(&mut self, f: usize, v: u32) {
        let v = v & 1 == 1;
        match f {
            0 => self.cpu.cpsr.set_N(v),
            1 => self.cpu.cpsr.set_Z(v),
            2 => self.cpu.cpsr.set_C(v),
            _ => self.cpu.cpsr.set_V(v),
        }
    }

    /// Stop before the next instruction when the scheduler has a due event or a store changed
    /// state the core loop must observe.
    #[inline(always)]
    pub fn yield_now(&mut self) -> bool {
        if self.stop || self.cpu.bus.timestamp() > self.deadline {
            return true;
        }
        self.executed += 1;
        false
    }

    #[inline(always)]
    fn note_store(&mut self, addr: u32) {
        // I/O (DMA, HALTCNT, IE/IF/IME, timers) and cartridge backup/GPIO writes can change the
        // bus master, the interrupt state or the event list.
        let region = addr >> 24;
        if region == 4 || region >= 8 {
            self.stop = true;
        }
    }

    /// 8-bit load.
    #[inline(always)]
    pub fn load8(&mut self, addr: u32, kind: u32) -> u32 {
        u32::from(self.cpu.load_8(addr, access(kind)))
    }

    /// 16-bit load (address forced to half-word alignment by the core).
    #[inline(always)]
    pub fn load16(&mut self, addr: u32, kind: u32) -> u32 {
        u32::from(self.cpu.load_16(addr, access(kind)))
    }

    /// 32-bit load (address forced to word alignment by the core).
    #[inline(always)]
    pub fn load32(&mut self, addr: u32, kind: u32) -> u32 {
        self.cpu.load_32(addr, access(kind))
    }

    /// 8-bit store.
    #[inline(always)]
    pub fn store8(&mut self, addr: u32, v: u32, kind: u32) {
        self.cpu.store_8(addr, v as u8, access(kind));
        self.note_store(addr);
    }

    /// 16-bit store.
    #[inline(always)]
    pub fn store16(&mut self, addr: u32, v: u32, kind: u32) {
        self.cpu.store_16(addr, v as u16, access(kind));
        self.note_store(addr);
    }

    /// 32-bit store.
    #[inline(always)]
    pub fn store32(&mut self, addr: u32, v: u32, kind: u32) {
        self.cpu.store_32(addr, v, access(kind));
        self.note_store(addr);
    }

    /// Fetch stage of an ARM instruction at `addr` (the pipeline runs two words ahead).
    #[inline(always)]
    pub fn arm_begin(&mut self, addr: u32) {
        debug_assert_eq!(self.cpu.pc & !3, addr.wrapping_add(8));
        let pc = self.cpu.pc & !3;
        let fetched = self.cpu.load_32(pc, self.cpu.next_fetch_access());
        let p = self.cpu.pipeline_mut();
        p[0] = p[1];
        p[1] = fetched;
    }

    /// Advance past a non-branching ARM instruction.
    #[inline(always)]
    pub fn arm_next(&mut self, kind: u32) {
        self.cpu.set_next_fetch_access(access(kind));
        self.cpu.pc = self.cpu.pc.wrapping_add(4);
    }

    /// Fetch stage of a Thumb instruction at `addr`.
    #[inline(always)]
    pub fn thumb_begin(&mut self, addr: u32) {
        debug_assert_eq!(self.cpu.pc & !1, addr.wrapping_add(4));
        let pc = self.cpu.pc & !1;
        let fetched = u32::from(self.cpu.load_16(pc, self.cpu.next_fetch_access()));
        let p = self.cpu.pipeline_mut();
        p[0] = p[1];
        p[1] = fetched;
    }

    /// Advance past a non-branching Thumb instruction.
    #[inline(always)]
    pub fn thumb_next(&mut self, kind: u32) {
        self.cpu.pc = self.cpu.pc.wrapping_add(2);
        self.cpu.set_next_fetch_access(access(kind));
    }

    /// One internal cycle.
    #[inline(always)]
    pub fn idle(&mut self) {
        self.cpu.idle_cycle();
    }

    /// Internal cycles of the multiplier array for operand `rs`.
    #[inline(always)]
    pub fn mul_idle(&mut self, rs: u32) {
        for _ in 0..self.cpu.get_required_multipiler_array_cycles(rs) {
            self.cpu.idle_cycle();
        }
    }

    /// `ldr` word load with the core's misaligned rotation.
    #[inline(always)]
    pub fn ldr_word(&mut self, addr: u32, kind: u32) -> u32 {
        self.cpu.ldr_word(addr, access(kind))
    }

    /// `ldrh` with the core's misaligned rotation.
    #[inline(always)]
    pub fn ldr_half(&mut self, addr: u32, kind: u32) -> u32 {
        self.cpu.ldr_half(addr, access(kind))
    }

    /// `ldrsh` with the core's misaligned behaviour.
    #[inline(always)]
    pub fn ldr_sign_half(&mut self, addr: u32, kind: u32) -> u32 {
        self.cpu.ldr_sign_half(addr, access(kind))
    }

    /// Branch to an ARM address (pipeline refill).
    #[inline(always)]
    pub fn reload32(&mut self, pc: u32) {
        self.cpu.pc = pc;
        self.cpu.reload_pipeline32();
    }

    /// Branch to a Thumb address (pipeline refill).
    #[inline(always)]
    pub fn reload16(&mut self, pc: u32) {
        self.cpu.pc = pc;
        self.cpu.reload_pipeline16();
    }

    /// `bx`: branch and select the state from bit 0.
    #[inline(always)]
    pub fn branch_exchange(&mut self, target: u32) {
        self.cpu.branch_exchange(target);
    }

    /// Execute the current instruction in the interpreter.
    #[inline(never)]
    pub fn fallback(&mut self) {
        self.fallback = true;
        self.cpu.step();
    }
}
