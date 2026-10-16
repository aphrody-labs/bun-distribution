// Branch state transitions live in the portable IECODE Wii library.
use crate::gekko::instruction::Instruction;
use crate::system::{System, SystemId};
use aphrody_wii::branch::BranchState;

#[inline(always)]
pub fn branch<const OP: u32, const SYSTEM: SystemId>(ctx: &mut System<SYSTEM>, instr: Instruction) {
    let mut state = BranchState {
        pc: ctx.gekko.cia,
        lr: ctx.gekko.spr.lr,
        ctr: ctx.gekko.spr.ctr,
        cr: ctx.gekko.cr.raw(),
    };
    let result = state.execute(instr.0).expect("validated branch dispatch");
    ctx.scheduler.cycles += crate::gekko::cycles::cycles_for_op(OP) as u64;
    ctx.gekko.spr.lr = state.lr;
    ctx.gekko.spr.ctr = state.ctr;
    if result.taken {
        ctx.gekko.nia = result.next_pc;
    }
}
