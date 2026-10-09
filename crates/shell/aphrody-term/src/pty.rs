// SPDX-License-Identifier: Apache-2.0
//! Cross-platform PTY abstraction with starvation-free FairMutex concurrency.

use parking_lot::Mutex;
use portable_pty::{CommandBuilder, NativePtySystem, PtyPair, PtySize, PtySystem};
use std::io::{Read, Write};
use std::sync::Arc;

/// Mutex whose `lock` first passes through a queue mutex, so a thread re-locking in a loop
/// (the PTY reader) cannot repeatedly barge ahead of waiting threads.
pub struct FairMutex<T> {
    data: Mutex<T>,
    queue: Mutex<()>,
}

impl<T> FairMutex<T> {
    pub fn new(val: T) -> Self {
        Self {
            data: Mutex::new(val),
            queue: Mutex::new(()),
        }
    }

    #[inline(always)]
    pub fn lock(&self) -> parking_lot::MutexGuard<'_, T> {
        let _slot = self.queue.lock();
        self.data.lock()
    }
}

/// Maximum PTY bytes ingested per grid lock.
pub const MAX_LOCKED_READ_BYTES: usize = 256 * 1024; // 256 KB max per PTY lock

pub struct PtyController {
    pair: PtyPair,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

impl PtyController {
    /// Spawns a new native PTY session with the specified command and dimensions.
    pub fn spawn(cmd: &str, args: &[&str], cols: u16, rows: u16) -> Result<(Self, Box<dyn Read + Send>), Box<dyn std::error::Error + Send + Sync>> {
        let pty_system = NativePtySystem::default();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let mut cmd_builder = CommandBuilder::new(cmd);
        cmd_builder.args(args);
        let _child = pair.slave.spawn_command(cmd_builder)?;

        let reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        Ok((
            Self {
                pair,
                writer: Arc::new(Mutex::new(writer)),
            },
            reader,
        ))
    }

    /// Shared handle to the PTY input stream (used to answer terminal queries).
    pub fn writer_handle(&self) -> Arc<Mutex<Box<dyn Write + Send>>> {
        Arc::clone(&self.writer)
    }

    /// Sends input bytes to the PTY.
    pub fn write_all(&self, bytes: &[u8]) -> std::io::Result<()> {
        let mut w = self.writer.lock();
        w.write_all(bytes)?;
        w.flush()
    }

    /// Resizes the PTY dimensions.
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.pair.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }
}
