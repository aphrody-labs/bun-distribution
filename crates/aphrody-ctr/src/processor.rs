//! Bounded PICA register execution, independent of rendering and guest memory.
//! Peripheral side effects are delivered in order to the caller; storing a
//! register value alone does not implement shader uploads, drawing or IRQs.
use crate::gpu::{CommandError, RegisterWrite, RegisterWrites};

/// PICA's 0x000..0x2ff internal register address space.
pub const REGISTER_COUNT: usize = 0x300;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecutionError {
    Command(CommandError),
    InvalidRegister(u16),
}

/// A completed masked write, including values needed to implement side effects.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RegisterEffect {
    pub write: RegisterWrite,
    pub previous: u32,
    pub current: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecutionStatus {
    /// The budget was exhausted; call run again to continue the same stream.
    BudgetExhausted,
    Complete,
    /// GPUREG_FINALIZE ended execution; all remaining buffer words are ignored.
    Finalized,
    Failed(ExecutionError),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExecutionReport {
    pub writes: usize,
    pub status: ExecutionStatus,
}

/// Raw register storage. Zero initialization is not a hardware reset model.
pub struct RegisterBank {
    words: [u32; REGISTER_COUNT],
}

impl Default for RegisterBank {
    fn default() -> Self {
        Self::new()
    }
}

impl RegisterBank {
    pub const fn new() -> Self {
        Self {
            words: [0; REGISTER_COUNT],
        }
    }

    pub fn read(&self, register: u16) -> Option<u32> {
        self.words.get(usize::from(register)).copied()
    }
}

/// Keeps decoder position between scheduler quanta, including inside a packet.
/// Bad packets fail before their first write. Earlier valid packets stay applied.
pub struct CommandProcessor<'a> {
    writes: RegisterWrites<'a>,
    terminal: Option<ExecutionStatus>,
}

impl<'a> CommandProcessor<'a> {
    pub const fn new(words: &'a [u32]) -> Self {
        Self {
            writes: RegisterWrites::new(words),
            terminal: None,
        }
    }

    /// Execute at most budget register writes. The callback receives every write,
    /// including repeated values and zero byte masks, so strobes are not lost.
    /// The first GPUREG_FINALIZE write is forwarded and ends execution, as
    /// documented by 3DBrew GPU/Internal_Registers#GPUREG_FINALIZE. Additional
    /// SDK alignment commands remain transport data and are never executed.
    pub fn run(
        &mut self,
        registers: &mut RegisterBank,
        budget: usize,
        mut effect: impl FnMut(RegisterEffect),
    ) -> ExecutionReport {
        if let Some(status) = self.terminal {
            return ExecutionReport { writes: 0, status };
        }
        let mut count = 0;
        while count < budget {
            let status = match self.writes.next() {
                None => Some(ExecutionStatus::Complete),
                Some(Err(error)) => Some(ExecutionStatus::Failed(ExecutionError::Command(error))),
                Some(Ok(write)) => {
                    if let Some(word) = registers.words.get_mut(usize::from(write.register)) {
                        let previous = *word;
                        *word = write.apply(previous);
                        effect(RegisterEffect {
                            write,
                            previous,
                            current: *word,
                        });
                        count += 1;
                        if write.register == 0x10 {
                            Some(ExecutionStatus::Finalized)
                        } else {
                            None
                        }
                    } else {
                        Some(ExecutionStatus::Failed(ExecutionError::InvalidRegister(
                            write.register,
                        )))
                    }
                }
            };
            if let Some(status) = status {
                self.terminal = Some(status);
                return ExecutionReport {
                    writes: count,
                    status,
                };
            }
        }
        ExecutionReport {
            writes: count,
            status: ExecutionStatus::BudgetExhausted,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gpu::{command_header, finalize_commands};

    #[test]
    fn resumes_inside_packet_and_delivers_masked_side_effects() {
        let words = [
            0xaabbccdd,
            command_header(0x100, 5, false) | (2 << 20),
            0x11223344,
            0x55667788,
        ];
        let mut processor = CommandProcessor::new(&words);
        let mut bank = RegisterBank::new();
        let mut events = [None; 3];
        for event in &mut events {
            assert_eq!(
                processor
                    .run(&mut bank, 1, |value| *event = Some(value))
                    .status,
                ExecutionStatus::BudgetExhausted
            );
        }
        assert_eq!(bank.read(0x100), Some(0x00660088));
        assert_eq!(events[1].unwrap().previous, 0x00bb00dd);
        assert_eq!(events[1].unwrap().current, 0x00220044);
        assert_eq!(
            processor.run(&mut bank, 1, |_| panic!()).status,
            ExecutionStatus::Complete
        );
        assert_eq!(processor.run(&mut bank, 1, |_| panic!()).writes, 0);
    }

    #[test]
    fn finalization_aligns_transport_but_executes_only_first_strobe() {
        let mut words = [0; 4];
        assert_eq!(finalize_commands(&mut words, 0), Ok(4));
        let mut bank = RegisterBank::new();
        let mut strobes = 0;
        let result = CommandProcessor::new(&words).run(&mut bank, 10, |event| {
            assert_eq!(event.write.register, 0x10);
            assert_eq!(event.current, 0x12345678);
            strobes += 1;
        });
        assert_eq!(result.status, ExecutionStatus::Finalized);
        assert_eq!(strobes, 1);
        assert_eq!(crate::gpu::RegisterWrites::new(&words).count(), 2);
        assert_eq!(
            finalize_commands(&mut words[..3], 0),
            Err(CommandError::BufferTooSmall)
        );
        assert_eq!(
            finalize_commands(&mut words, 1),
            Err(CommandError::UnalignedCommandOffset)
        );
        assert_eq!(finalize_commands(&mut words, 2), Ok(4));
    }

    #[test]
    fn finalization_is_terminal_at_budget_boundary_and_ignores_trailing_data() {
        let words = [
            7,
            command_header(0x10, 15, false),
            42,
            command_header(0x100, 15, false),
            0xdeadbeef,
        ];
        let mut bank = RegisterBank::new();
        let mut processor = CommandProcessor::new(&words);
        let result = processor.run(&mut bank, 1, |event| {
            assert_eq!(event.write.register, 0x10);
        });
        assert_eq!(
            result,
            ExecutionReport {
                writes: 1,
                status: ExecutionStatus::Finalized
            }
        );
        assert_eq!(bank.read(0x100), Some(0));
        for budget in [0, 1, 100] {
            assert_eq!(
                processor.run(&mut bank, budget, |_| panic!()),
                ExecutionReport {
                    writes: 0,
                    status: ExecutionStatus::Finalized
                }
            );
        }
    }

    #[test]
    fn rejects_invalid_address_without_wrapping() {
        let words = [7, command_header(0x2ff, 15, true) | (1 << 20), 8, 0];
        let mut bank = RegisterBank::new();
        let mut processor = CommandProcessor::new(&words);
        let result = processor.run(&mut bank, 10, |_| {});
        assert_eq!(result.writes, 1);
        assert_eq!(bank.read(0x2ff), Some(7));
        assert_eq!(
            result.status,
            ExecutionStatus::Failed(ExecutionError::InvalidRegister(0x300))
        );
        assert_eq!(processor.run(&mut bank, 10, |_| panic!()).writes, 0);
    }

    #[test]
    fn zero_budget_and_truncated_packet_do_not_mutate() {
        let words = [9, command_header(1, 15, false), 8];
        let mut bank = RegisterBank::new();
        let mut processor = CommandProcessor::new(&words);
        assert_eq!(processor.run(&mut bank, 0, |_| panic!()).writes, 0);
        let result = processor.run(&mut bank, 10, |_| {});
        assert_eq!(result.writes, 1);
        assert_eq!(bank.read(1), Some(9));
        assert_eq!(
            result.status,
            ExecutionStatus::Failed(ExecutionError::Command(CommandError::TruncatedCommand))
        );
    }
}
