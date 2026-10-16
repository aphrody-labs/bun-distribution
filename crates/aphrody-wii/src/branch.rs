//! Broadway branch semantics, adapted from Gecko's interpreter/branch.rs.
//! Link updates follow PowerPC Book I, including untaken conditional branches.

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BranchState {
    pub pc: u32,
    pub lr: u32,
    pub ctr: u32,
    /// PowerPC bit zero is the most significant bit.
    pub cr: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BranchError {
    NotBranch,
    /// bcctr cannot decrement/test the register used as its target.
    InvalidCounterOption,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BranchResult {
    pub next_pc: u32,
    pub taken: bool,
}

impl BranchState {
    /// Execute one encoded b, bc, bclr or bcctr instruction.
    ///
    /// Errors leave all state untouched. PC advances to the selected successor;
    /// scheduling and instruction fetch belong to the calling emulator.
    pub fn execute(&mut self, instruction: u32) -> Result<BranchResult, BranchError> {
        let opcode = instruction >> 26;
        let extension = (instruction >> 1) & 0x3ff;
        if opcode != 18 && opcode != 16 && !(opcode == 19 && matches!(extension, 16 | 528)) {
            return Err(BranchError::NotBranch);
        }
        let bo = ((instruction >> 21) & 31) as u8;
        if opcode == 19 && extension == 528 && bo & 4 == 0 {
            return Err(BranchError::InvalidCounterOption);
        }
        let sequential = self.pc.wrapping_add(4);
        let taken = if opcode == 18 {
            true
        } else {
            if bo & 4 == 0 {
                self.ctr = self.ctr.wrapping_sub(1);
            }
            let bit = (instruction >> 16) & 31;
            let condition = self.cr & (1 << (31 - bit)) != 0;
            let condition_ok = bo & 16 != 0 || condition == (bo & 8 != 0);
            let counter_ok = bo & 4 != 0 || (self.ctr != 0) != (bo & 2 != 0);
            condition_ok && counter_ok
        };
        let next_pc = if !taken {
            sequential
        } else if opcode == 19 {
            if extension == 16 {
                self.lr & !3
            } else {
                self.ctr & !3
            }
        } else {
            let displacement = if opcode == 18 {
                // LI is a signed 26-bit displacement with its low two bits zero.
                ((instruction & 0x03ff_fffc) << 6) as i32 >> 6
            } else {
                (instruction & 0xfffc) as i16 as i32
            };
            if instruction & 2 != 0 {
                displacement as u32
            } else {
                self.pc.wrapping_add_signed(displacement)
            }
        };
        if instruction & 1 != 0 {
            self.lr = sequential;
        }
        self.pc = next_pc;
        Ok(BranchResult { next_pc, taken })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bc(bo: u32, bi: u32, displacement: u32) -> u32 {
        (16 << 26) | (bo << 21) | (bi << 16) | (displacement & 0xfffc)
    }

    #[test]
    fn relative_negative_and_absolute_link() {
        let mut state = BranchState {
            pc: 0x8000_0100,
            ..Default::default()
        };
        assert_eq!(state.execute(0x4bff_fffc).unwrap().next_pc, 0x8000_00fc);
        state.execute(0x4800_0103).unwrap();
        assert_eq!(state.pc, 0x100);
        assert_eq!(state.lr, 0x8000_0100);
    }

    #[test]
    fn all_bo_values_match_retained_branch_controls() {
        for bo in 0..32 {
            for initial_ctr in [0_u32, 1, 2, u32::MAX] {
                for condition in [false, true] {
                    let mut state = BranchState {
                        pc: 0x100,
                        ctr: initial_ctr,
                        cr: u32::from(condition) << 31,
                        ..Default::default()
                    };
                    let decrements = bo & 4 == 0;
                    let ctr = if decrements {
                        initial_ctr.wrapping_sub(1)
                    } else {
                        initial_ctr
                    };
                    let expected = match bo & 30 {
                        0 => ctr != 0 && !condition,
                        2 => ctr == 0 && !condition,
                        4 | 6 => !condition,
                        8 => ctr != 0 && condition,
                        10 => ctr == 0 && condition,
                        12 | 14 => condition,
                        16 | 24 => ctr != 0,
                        18 | 26 => ctr == 0,
                        _ => true,
                    };
                    let result = state.execute(bc(bo, 0, 8)).unwrap();
                    assert_eq!(result.taken, expected, "bo={bo} ctr={initial_ctr}");
                    assert_eq!(state.ctr, ctr);
                }
            }
        }
    }

    #[test]
    fn link_target_uses_old_lr_and_clears_low_bits() {
        let mut state = BranchState {
            pc: 0x100,
            lr: 0x203,
            ..Default::default()
        };
        state
            .execute((19 << 26) | (20 << 21) | (16 << 1) | 1)
            .unwrap();
        assert_eq!(state.pc, 0x200);
        assert_eq!(state.lr, 0x104);
    }

    #[test]
    fn invalid_counter_option_is_transactional() {
        let mut state = BranchState {
            pc: 0x100,
            ctr: 0x203,
            ..Default::default()
        };
        let before = state;
        assert_eq!(
            state.execute((19 << 26) | (528 << 1)),
            Err(BranchError::InvalidCounterOption)
        );
        assert_eq!(state, before);
        state.execute((19 << 26) | (20 << 21) | (528 << 1)).unwrap();
        assert_eq!(state.pc, 0x200);
        assert_eq!(state.ctr, 0x203);
    }

    #[test]
    fn untaken_conditional_branches_still_update_lr() {
        for instruction in [
            bc(12, 0, 8) | 1,
            (19 << 26) | (12 << 21) | (16 << 1) | 1,
            (19 << 26) | (12 << 21) | (528 << 1) | 1,
        ] {
            let mut state = BranchState {
                pc: 0x100,
                lr: 0x200,
                ..Default::default()
            };
            assert!(!state.execute(instruction).unwrap().taken);
            assert_eq!(state.pc, 0x104);
            assert_eq!(state.lr, 0x104);
        }
    }
}
