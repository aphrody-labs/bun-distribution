//! NES runtime of recompiled 6502 code (TetaNES device models).
//!
//! Every bus access of a translated instruction goes through the core (`Bus::read`, `Bus::write`
//! and the core's addressing functions with their dummy reads), so the PPU, APU and mapper are
//! clocked exactly as by the interpreter; each instruction ends with the core's interrupt poll.
//! Blocks stop at the end of a video frame, where the core's frame loop checks.

use tetanes_core::bus::Bus as Core;
use tetanes_core::cpu::Status;
use tetanes_core::cpu::instr::AddrMode;

/// The bus type the dispatcher receives.
pub type Bus = Core;

/// Translated block.
pub type Block = for<'a> fn(&mut Rt<'a>);

/// Block table of a generated crate.
pub type Lookup = fn(u32) -> Option<Block>;

/// Handle passed to translated blocks.
pub struct Rt<'a> {
    bus: &'a mut Core,
    frame: u32,
    executed: u64,
    fallback: bool,
}

/// Run the translated block at the program counter; false lets the interpreter step.
///
/// Blocks are chained until the frame completes, an instruction is handed to the interpreter or
/// the program counter leaves the translated code.
pub fn run(bus: &mut Core, lookup: Lookup) -> bool {
    if !bus.recomp_ready() || bus.cpu.corrupted {
        return false;
    }
    let frame = bus.ppu.frame_number();
    let mut rt = Rt {
        bus,
        frame,
        executed: 0,
        fallback: false,
    };
    let mut entries = 0u64;
    loop {
        let Some(block) = lookup(u32::from(rt.bus.cpu.pc)) else {
            break;
        };
        entries += 1;
        rt.executed += 1;
        block(&mut rt);
        if rt.fallback || rt.bus.cpu.corrupted || rt.bus.ppu.frame_number() != frame {
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

const MODES: [AddrMode; 17] = [
    AddrMode::ACC,
    AddrMode::IMP,
    AddrMode::IMM,
    AddrMode::REL,
    AddrMode::ZP0,
    AddrMode::ABS,
    AddrMode::ZPX,
    AddrMode::ZPY,
    AddrMode::IND,
    AddrMode::IDX,
    AddrMode::IDY,
    AddrMode::IDYW,
    AddrMode::ABX,
    AddrMode::ABXW,
    AddrMode::ABY,
    AddrMode::ABYW,
    AddrMode::OTH,
];

const FLAGS: [Status; 6] = [
    Status::N,
    Status::V,
    Status::D,
    Status::I,
    Status::Z,
    Status::C,
];

impl Rt<'_> {
    /// Register `a x y s`.
    #[inline(always)]
    pub fn r(&self, r: usize) -> u32 {
        let c = &self.bus.cpu;
        u32::from(match r {
            0 => c.acc,
            1 => c.x,
            2 => c.y,
            _ => c.sp,
        })
    }

    /// Write register `a x y s`.
    #[inline(always)]
    pub fn set_r(&mut self, r: usize, v: u32) {
        let c = &mut self.bus.cpu;
        let v = v as u8;
        match r {
            0 => c.acc = v,
            1 => c.x = v,
            2 => c.y = v,
            _ => c.sp = v,
        }
    }

    /// Flag `n v d i z c` as 0 or 1.
    #[inline(always)]
    pub fn flag(&self, f: usize) -> u32 {
        u32::from(self.bus.cpu.status.contains(FLAGS[f]))
    }

    /// Write flag `n v d i z c`.
    #[inline(always)]
    pub fn set_flag(&mut self, f: usize, v: u32) {
        self.bus.cpu.status.set(FLAGS[f], v & 1 == 1);
    }

    /// Stop before the next instruction once the frame is complete.
    #[inline(always)]
    pub fn yield_now(&mut self) -> bool {
        if self.bus.ppu.frame_number() != self.frame || self.bus.cpu.corrupted {
            return true;
        }
        self.executed += 1;
        false
    }

    /// Opcode fetch of the instruction at `addr`.
    #[inline(always)]
    pub fn begin(&mut self, addr: u32) {
        debug_assert_eq!(u32::from(self.bus.cpu.pc), addr);
        let _ = self.bus.fetch_byte();
    }

    /// Addressing-mode fetches (with the core's dummy reads); returns the operand.
    #[inline(always)]
    pub fn operand(&mut self, mode: u32) -> u32 {
        let m = MODES[mode as usize];
        self.bus.cpu.addr_mode = m;
        let v = match m {
            AddrMode::ACC | AddrMode::IMP => self.bus.acc_imp(),
            AddrMode::IMM | AddrMode::REL | AddrMode::ZP0 => self.bus.imm_rel_zp(),
            AddrMode::ZPX => self.bus.zpx(),
            AddrMode::ZPY => self.bus.zpy(),
            AddrMode::IND => self.bus.ind(),
            AddrMode::IDX => self.bus.idx(),
            AddrMode::IDY => self.bus.idy(false),
            AddrMode::IDYW => self.bus.idy(true),
            AddrMode::ABS => self.bus.abs(),
            AddrMode::ABX => self.bus.abx(false),
            AddrMode::ABXW => self.bus.abx(true),
            AddrMode::ABY => self.bus.aby(false),
            AddrMode::ABYW => self.bus.aby(true),
            AddrMode::OTH => 0,
        };
        self.bus.cpu.operand = v;
        u32::from(v)
    }

    /// Bus read (one CPU cycle).
    #[inline(always)]
    pub fn load8(&mut self, addr: u32, _kind: u32) -> u32 {
        u32::from(self.bus.read(addr as u16))
    }

    /// Bus write (one CPU cycle).
    #[inline(always)]
    pub fn store8(&mut self, addr: u32, v: u32, _kind: u32) {
        self.bus.write(addr as u16, v as u8);
    }

    /// Jump.
    #[inline(always)]
    pub fn set_pc(&mut self, pc: u32) {
        self.bus.cpu.pc = pc as u16;
    }

    /// Relative branch with the core's timing and interrupt-delay rules.
    #[inline(always)]
    pub fn branch(&mut self, taken: u32) {
        self.bus.branch(taken != 0);
    }

    /// Stack, subroutine and system opcodes run by the core: 0 jsr, 1 rts, 2 rti, 3 brk, 4 php,
    /// 5 plp, 6 pha, 7 pla, 8 jmp (indirect).
    pub fn op(&mut self, id: u32) {
        match id {
            0 => self.bus.jsr(),
            1 => self.bus.rts(),
            2 => self.bus.rti(),
            3 => self.bus.brk(),
            4 => self.bus.php(),
            5 => self.bus.plp(),
            6 => self.bus.pha(),
            7 => self.bus.pla(),
            _ => self.bus.jmpi(),
        }
    }

    /// End of an instruction: interrupt poll. Returns 1 when execution continues at `next`.
    #[inline(always)]
    pub fn end(&mut self, next: u32) -> u32 {
        self.bus.poll_interrupts();
        u32::from(u32::from(self.bus.cpu.pc) == next)
    }

    /// FNV-1a of `len` code bytes at `addr`, read without side effects (bank guard).
    pub fn code_hash(&mut self, addr: u32, len: u32) -> u32 {
        let mut h: u32 = 0x811c_9dc5;
        for i in 0..len {
            h ^= u32::from(self.bus.peek((addr + i) as u16));
            h = h.wrapping_mul(0x0100_0193);
        }
        h
    }

    /// Execute the current instruction in the interpreter.
    #[inline(never)]
    pub fn fallback(&mut self) {
        self.fallback = true;
        self.bus.clock_instr();
    }
}
