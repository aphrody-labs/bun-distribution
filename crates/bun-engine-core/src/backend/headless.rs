//! Deterministic host-independent execution boundary for console cores.
//!
//! No renderer, window, filesystem, network, wall clock or platform SDK belongs here. Input and
//! state types are selected by each console implementation so shared scheduling cannot erase
//! hardware-specific semantics. A host can bridge this boundary to CLI, GUI, FFI or WASM.

use std::num::NonZeroU64;

/// Work completed by one bounded core step; payloads travel through separate host ports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StepOutcome {
    /// Number of virtual ticks consumed by the core.
    pub ticks: NonZeroU64,
    /// Whether at least one complete video frame is available from the core's output port.
    pub frame_ready: bool,
}

/// Console-specific, deterministic execution contract.
///
/// `step` must consume between one and `budget` virtual ticks. It must not consult a host wall
/// clock or perform host I/O. Implementations own their CPU, bus, RAM and device timing; those
/// models are not flattened into shared hardware behavior.
pub trait HeadlessCore {
    /// Console-specific input sampled for this step.
    type Input;
    /// Console-specific state, excluding the session's virtual clock.
    type State;
    /// Error raised by the console implementation.
    type Error;

    /// Advances emulated hardware within a bounded virtual-time budget.
    fn step(&mut self, budget: NonZeroU64, input: &Self::Input)
    -> Result<StepOutcome, Self::Error>;

    /// Captures all mutable console state needed for a deterministic restart.
    fn snapshot(&self) -> Self::State;

    /// Restores a previously captured console state.
    fn restore(&mut self, state: Self::State);
}

/// Complete in-memory save state for a headless session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionState<S> {
    /// Console-owned state.
    pub core: S,
    /// Virtual ticks elapsed since the start or last restored state.
    pub elapsed_ticks: u64,
}

/// Failure to advance a headless session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdvanceError<E> {
    /// The console implementation failed.
    Core(E),
    /// The implementation reported zero ticks or exceeded the requested budget.
    InvalidStep,
    /// The virtual clock would overflow.
    ClockOverflow,
}

/// A core with its virtual clock, independent of any host frontend.
pub struct HeadlessSession<C: HeadlessCore> {
    core: C,
    elapsed_ticks: u64,
}

impl<C: HeadlessCore> HeadlessSession<C> {
    /// Starts a session at virtual tick zero.
    #[must_use]
    pub const fn new(core: C) -> Self {
        Self {
            core,
            elapsed_ticks: 0,
        }
    }

    /// Returns the current virtual tick count.
    #[must_use]
    pub const fn elapsed_ticks(&self) -> u64 {
        self.elapsed_ticks
    }

    /// Advances within `budget`, validating the console's reported progress.
    pub fn advance(
        &mut self,
        budget: NonZeroU64,
        input: &C::Input,
    ) -> Result<StepOutcome, AdvanceError<C::Error>> {
        // Check the full budget before calling the core so overflow never leaves a half-step.
        self.elapsed_ticks
            .checked_add(budget.get())
            .ok_or(AdvanceError::ClockOverflow)?;
        let outcome = self.core.step(budget, input).map_err(AdvanceError::Core)?;
        if outcome.ticks.get() > budget.get() {
            return Err(AdvanceError::InvalidStep);
        }
        self.elapsed_ticks += outcome.ticks.get();
        Ok(outcome)
    }

    /// Captures console state and the virtual clock together.
    #[must_use]
    pub fn snapshot(&self) -> SessionState<C::State> {
        SessionState {
            core: self.core.snapshot(),
            elapsed_ticks: self.elapsed_ticks,
        }
    }

    /// Restores console state and the virtual clock together.
    pub fn restore(&mut self, state: SessionState<C::State>) {
        self.core.restore(state.core);
        self.elapsed_ticks = state.elapsed_ticks;
    }

    /// Returns ownership of the console implementation to its caller.
    #[must_use]
    pub fn into_core(self) -> C {
        self.core
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct CounterCore {
        count: u64,
        overrun: bool,
    }

    impl HeadlessCore for CounterCore {
        type Input = u64;
        type State = u64;
        type Error = ();

        fn step(
            &mut self,
            budget: NonZeroU64,
            input: &Self::Input,
        ) -> Result<StepOutcome, Self::Error> {
            self.count += input;
            Ok(StepOutcome {
                ticks: NonZeroU64::new(if self.overrun { budget.get() + 1 } else { 1 }).unwrap(),
                frame_ready: self.count.is_multiple_of(2),
            })
        }

        fn snapshot(&self) -> Self::State {
            self.count
        }

        fn restore(&mut self, state: Self::State) {
            self.count = state;
        }
    }

    #[test]
    fn synthetic_core_replays_after_restore() {
        let mut session = HeadlessSession::new(CounterCore {
            count: 0,
            overrun: false,
        });
        let budget = NonZeroU64::new(2).unwrap();
        session.advance(budget, &1).unwrap();
        let saved = session.snapshot();
        let first = session.advance(budget, &1).unwrap();
        session.restore(saved);
        let replay = session.advance(budget, &1).unwrap();
        assert_eq!(first, replay);
        assert_eq!(session.elapsed_ticks(), 2);
    }

    #[test]
    fn rejects_core_budget_overrun() {
        let mut session = HeadlessSession::new(CounterCore {
            count: 0,
            overrun: true,
        });
        let result = session.advance(NonZeroU64::new(1).unwrap(), &0);
        assert_eq!(result, Err(AdvanceError::InvalidStep));
        assert_eq!(session.elapsed_ticks(), 0);
    }

    #[test]
    fn rejects_virtual_clock_overflow() {
        let mut session = HeadlessSession::new(CounterCore {
            count: 0,
            overrun: false,
        });
        session.restore(SessionState {
            core: 0,
            elapsed_ticks: u64::MAX,
        });
        let result = session.advance(NonZeroU64::new(1).unwrap(), &0);
        assert_eq!(result, Err(AdvanceError::ClockOverflow));
    }
}
