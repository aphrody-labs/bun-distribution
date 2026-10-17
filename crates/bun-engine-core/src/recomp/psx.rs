//! PlayStation runtime of recompiled MIPS R3000A code (StarPSX device models).
//!
//! Translated instructions follow the StarPSX interpreter step: reads from the committed register
//! file, writes to the delayed file committed after the instruction, loads through the load delay
//! slot and branches through the delayed branch. The core runs instructions in batches of 20
//! between scheduler updates; a block runs at most the rest of its batch and stops after a store
//! that reaches an I/O port (the interrupt state may have changed). Interrupts, exceptions, COP0
//! and GTE operations are always taken by the interpreter.

use starpsx_core::System as Core;
use starpsx_core::cpu::Cpu;

/// The system type the dispatcher receives.
pub type System = Core;

/// Dispatcher signature installed in the core.
pub type Runner = starpsx_core::Runner;

/// Translated block.
pub type Block = for<'a> fn(&mut Rt<'a>);

/// Block table of a generated crate.
pub type Lookup = fn(u32) -> Option<Block>;

thread_local! {
    /// Last validated (RAM write generation, code hash) per guarded block.
    static GUARDS: std::cell::RefCell<std::collections::HashMap<u32, (u64, u32)>> = std::cell::RefCell::new(std::collections::HashMap::new());
}

/// Handle passed to translated blocks.
pub struct Rt<'a> {
    sys: &'a mut Core,
    budget: u32,
    executed: u32,
    stop: bool,
    fallback: bool,
    next_pc: u32,
    /// Registers whose delayed copy differs from the committed file (the rest are equal).
    dirty: u32,
}

/// Run translated code for up to `budget` instructions; 0 lets the interpreter step.
///
/// Blocks are chained within the budget while no delayed branch or interrupt is pending and the
/// program counter stays on translated code away from the BIOS call vectors (where the core checks
/// TTY output).
pub fn run(sys: &mut Core, budget: u32, lookup: Lookup) -> u32 {
    let cpu = sys.cpu();
    if cpu.delayed_branch.is_some() || Cpu::interrupt_pending(sys) {
        super::count_interpreted(1);
        return 0;
    }
    let Some(block) = lookup(sys.cpu().pc) else {
        super::count_interpreted(1);
        return 0;
    };
    // An interpreter step that raised an exception leaves its delayed writes uncommitted; carry
    // them into the first commit like the interpreter's full copy would.
    let cpu = sys.cpu();
    let dirty = (1..32)
        .filter(|&r| cpu.regs[r] != cpu.regd[r])
        .fold(0u32, |m, r| m | (1 << r));
    let mut rt = Rt {
        sys,
        budget,
        executed: 1,
        stop: false,
        fallback: false,
        next_pc: 0,
        dirty,
    };
    let mut entries = 1u64;
    block(&mut rt);
    while !rt.stop && !rt.fallback && rt.executed < budget {
        let cpu = rt.sys.cpu();
        let pc = cpu.pc;
        if cpu.delayed_branch.is_some()
            || matches!(pc & 0x1FFF_FFFF, 0xA0 | 0xB0)
            || Cpu::interrupt_pending(rt.sys)
        {
            break;
        }
        let Some(next) = lookup(pc) else { break };
        entries += 1;
        rt.executed += 1;
        next(&mut rt);
    }
    super::count_entries(
        u64::from(rt.executed - u32::from(rt.fallback)),
        entries,
        rt.fallback,
    );
    rt.executed
}

impl Rt<'_> {
    /// GPR (committed file), 32 = hi, 33 = lo.
    #[inline(always)]
    pub fn r(&self, r: usize) -> u32 {
        let cpu = self.sys.cpu();
        match r {
            32 => cpu.hi,
            33 => cpu.lo,
            _ => cpu.regs[r],
        }
    }

    /// GPR write (delayed file), 32 = hi, 33 = lo (immediate).
    #[inline(always)]
    pub fn set_r(&mut self, r: usize, v: u32) {
        let cpu = self.sys.cpu_mut();
        match r {
            32 => cpu.hi = v,
            33 => cpu.lo = v,
            _ => {
                cpu.regd[r] = v;
                self.dirty |= 1 << r;
            }
        }
    }

    /// Delayed-file read (`lwl`/`lwr` load forwarding).
    #[inline(always)]
    pub fn rd(&mut self, r: u32) -> u32 {
        self.sys.cpu().regd[r as usize]
    }

    /// No flags on MIPS.
    #[inline(always)]
    pub fn flag(&self, _f: usize) -> u32 {
        0
    }

    /// No flags on MIPS.
    #[inline(always)]
    pub fn set_flag(&mut self, _f: usize, _v: u32) {}

    /// Stop before the next instruction at the end of the batch or after an I/O store.
    #[inline(always)]
    pub fn yield_now(&mut self) -> bool {
        if self.stop || self.executed >= self.budget {
            return true;
        }
        self.executed += 1;
        false
    }

    /// Start of an instruction at `addr`: apply the pending load and take the delayed branch.
    #[inline(always)]
    pub fn begin(&mut self, addr: u32) {
        let cpu = self.sys.cpu_mut();
        debug_assert_eq!(cpu.pc, addr);
        if let Some((reg, val)) = cpu.load.take()
            && reg != 0
        {
            cpu.regd[reg] = val;
            self.dirty |= 1 << reg;
        }
        self.next_pc = cpu.delayed_branch.take().unwrap_or(addr.wrapping_add(4));
    }

    /// End of an instruction: commit the delayed register file and move to the next pc. Only
    /// the registers written since the last commit differ, so only those are copied.
    #[inline(always)]
    pub fn end(&mut self) {
        let cpu = self.sys.cpu_mut();
        let mut d = self.dirty;
        while d != 0 {
            let r = d.trailing_zeros() as usize;
            cpu.regs[r] = cpu.regd[r];
            d &= d - 1;
        }
        cpu.regs[0] = 0;
        cpu.pc = self.next_pc;
        self.dirty = 0;
    }

    /// Committed program counter.
    #[inline(always)]
    pub fn pc(&mut self) -> u32 {
        self.sys.cpu().pc
    }

    /// Set the delayed branch.
    #[inline(always)]
    pub fn branch(&mut self, target: u32) {
        self.sys.cpu_mut().delayed_branch = Some(target);
    }

    #[inline(always)]
    fn read<const W: usize>(&mut self, addr: u32) -> u32 {
        // Alignment was checked by the lifted guard; a fault here would be a lifter bug.
        self.sys.read::<W>(addr).unwrap_or(0)
    }

    #[inline(always)]
    fn delayed(&mut self, rt: u32, v: u32) {
        self.sys.cpu_mut().take_delayed_load(rt as usize, v);
        self.dirty |= 1 << rt;
    }

    /// `lb`.
    pub fn lb(&mut self, rt: u32, addr: u32) {
        let v = self.read::<1>(addr) as u8 as i8 as i32 as u32;
        self.delayed(rt, v);
    }

    /// `lbu`.
    pub fn lbu(&mut self, rt: u32, addr: u32) {
        let v = self.read::<1>(addr);
        self.delayed(rt, v);
    }

    /// `lh`.
    pub fn lh(&mut self, rt: u32, addr: u32) {
        let v = self.read::<2>(addr) as u16 as i16 as i32 as u32;
        self.delayed(rt, v);
    }

    /// `lhu`.
    pub fn lhu(&mut self, rt: u32, addr: u32) {
        let v = self.read::<2>(addr);
        self.delayed(rt, v);
    }

    /// `lw` (ignored while the cache is isolated).
    pub fn lw(&mut self, rt: u32, addr: u32) {
        if self.sys.cpu().cache_isolated() {
            return;
        }
        let v = self.read::<4>(addr);
        self.delayed(rt, v);
    }

    /// `lwl` (merges with the delayed file).
    pub fn lwl(&mut self, rt: u32, addr: u32) {
        let val = self.sys.cpu().regd[rt as usize];
        let word = self.read::<4>(addr & !3);
        let data = match addr & 3 {
            0 => (val & 0x00FF_FFFF) | (word << 24),
            1 => (val & 0x0000_FFFF) | (word << 16),
            2 => (val & 0x0000_00FF) | (word << 8),
            _ => word,
        };
        self.delayed(rt, data);
    }

    /// `lwr` (merges with the delayed file).
    pub fn lwr(&mut self, rt: u32, addr: u32) {
        let val = self.sys.cpu().regd[rt as usize];
        let word = self.read::<4>(addr & !3);
        let data = match addr & 3 {
            0 => word,
            1 => (val & 0xFF00_0000) | (word >> 8),
            2 => (val & 0xFFFF_0000) | (word >> 16),
            _ => (val & 0xFFFF_FF00) | (word >> 24),
        };
        self.delayed(rt, data);
    }

    #[inline(always)]
    fn note_store(&mut self, addr: u32) {
        // Anything outside RAM and the scratchpad is I/O (interrupt controller, DMA, timers).
        let phys = addr & 0x1FFF_FFFF;
        if !(phys < 0x0080_0000 || (0x1F80_0000..0x1F80_0400).contains(&phys)) {
            self.stop = true;
        }
    }

    fn write<const W: usize>(&mut self, addr: u32, v: u32) {
        let _ = self.sys.write::<W>(addr, v);
        self.note_store(addr);
    }

    /// `sb` (ignored while the cache is isolated).
    pub fn sb(&mut self, addr: u32, v: u32) {
        if !self.sys.cpu().cache_isolated() {
            self.write::<1>(addr, v);
        }
    }

    /// `sh` (ignored while the cache is isolated).
    pub fn sh(&mut self, addr: u32, v: u32) {
        if !self.sys.cpu().cache_isolated() {
            self.write::<2>(addr, v);
        }
    }

    /// `sw` (ignored while the cache is isolated).
    pub fn sw(&mut self, addr: u32, v: u32) {
        if !self.sys.cpu().cache_isolated() {
            self.write::<4>(addr, v);
        }
    }

    /// `swl`.
    pub fn swl(&mut self, addr: u32, v: u32) {
        let a = addr & !3;
        let word = self.read::<4>(a);
        let data = match addr & 3 {
            0 => (word & 0xFFFF_FF00) | (v >> 24),
            1 => (word & 0xFFFF_0000) | (v >> 16),
            2 => (word & 0xFF00_0000) | (v >> 8),
            _ => v,
        };
        self.write::<4>(a, data);
    }

    /// `swr`.
    pub fn swr(&mut self, addr: u32, v: u32) {
        let a = addr & !3;
        let word = self.read::<4>(a);
        let data = match addr & 3 {
            0 => v,
            1 => (word & 0x0000_00FF) | (v << 8),
            2 => (word & 0x0000_FFFF) | (v << 16),
            _ => (word & 0x00FF_FFFF) | (v << 24),
        };
        self.write::<4>(a, data);
    }

    /// FNV-1a of `words` instruction words at `addr` (entry guard for code in RAM). The hash is
    /// recomputed only when a write touched the RAM pages of the block since the last check.
    pub fn code_hash(&mut self, addr: u32, words: u32) -> u32 {
        let generation = self.sys.ram_generation(addr, words * 4);
        if let Some(g) = generation
            && let Some(h) = GUARDS.with(|c| {
                c.borrow()
                    .get(&addr)
                    .filter(|(cg, _)| *cg == g)
                    .map(|(_, h)| *h)
            })
        {
            return h;
        }
        let mut h: u32 = 0x811c_9dc5;
        for i in 0..words {
            for b in self
                .sys
                .fetch_instruction(addr.wrapping_add(i * 4))
                .to_le_bytes()
            {
                h ^= u32::from(b);
                h = h.wrapping_mul(0x0100_0193);
            }
        }
        if let Some(g) = generation {
            GUARDS.with(|c| c.borrow_mut().insert(addr, (g, h)));
        }
        h
    }

    /// Execute the current instruction in the interpreter.
    #[inline(never)]
    pub fn fallback(&mut self) {
        self.fallback = true;
        Cpu::run_next_instruction(self.sys);
    }

    /// Unused on MIPS (no generic loads are emitted).
    pub fn load32(&mut self, addr: u32, _kind: u32) -> u32 {
        self.read::<4>(addr)
    }
}
