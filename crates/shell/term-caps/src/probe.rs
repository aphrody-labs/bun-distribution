// SPDX-License-Identifier: Apache-2.0
//! Queries the controlling terminal: kitty graphics, XTVERSION, then DA1.
//! Every terminal answers DA1, so its reply ends the exchange; the timeout
//! only matters for terminals that do not answer at all.

use std::io;
use std::time::{Duration, Instant};

use crate::detect::ProbeReplies;
use crate::seq::{QUERY_DA1, QUERY_KITTY_GRAPHICS, QUERY_XTVERSION};

/// Sends the capability queries and collects replies until DA1 arrives or
/// `timeout` elapses. The terminal is put in raw mode for the exchange and
/// restored on return.
///
/// # Errors
/// [`io::ErrorKind::Unsupported`] without a controlling terminal, or the
/// I/O error of the terminal read/write.
pub fn probe(timeout: Duration) -> io::Result<ProbeReplies> {
    let mut query = String::with_capacity(96);
    query.push_str(QUERY_KITTY_GRAPHICS);
    query.push_str(QUERY_XTVERSION);
    query.push_str(QUERY_DA1);
    let deadline = Instant::now() + timeout;
    let mut raw = Vec::with_capacity(256);
    platform::exchange(query.as_bytes(), deadline, |bytes| {
        raw.extend_from_slice(bytes);
        ProbeReplies::parse(&raw).complete()
    })?;
    Ok(ProbeReplies::parse(&raw))
}

#[cfg(unix)]
mod platform {
    use std::fs::OpenOptions;
    use std::io::{self, Read, Write};
    use std::os::fd::AsRawFd;
    use std::time::Instant;

    pub(super) fn exchange(
        query: &[u8],
        deadline: Instant,
        mut push: impl FnMut(&[u8]) -> bool,
    ) -> io::Result<()> {
        let mut tty = OpenOptions::new()
            .read(true)
            .write(true)
            .open("/dev/tty")
            .map_err(|e| io::Error::new(io::ErrorKind::Unsupported, e))?;
        let fd = tty.as_raw_fd();
        // SAFETY: `termios` is plain old data; tcgetattr fully initializes it on success.
        let mut original: libc::termios = unsafe { std::mem::zeroed() };
        // SAFETY: `fd` is the open tty; `original` is a valid out pointer.
        if unsafe { libc::tcgetattr(fd, &mut original) } != 0 {
            return Err(io::Error::last_os_error());
        }
        let mut raw = original;
        raw.c_lflag &= !(libc::ICANON | libc::ECHO);
        raw.c_cc[libc::VMIN] = 0;
        raw.c_cc[libc::VTIME] = 0;
        // SAFETY: `raw` is a valid termios derived from the current settings.
        if unsafe { libc::tcsetattr(fd, libc::TCSANOW, &raw) } != 0 {
            return Err(io::Error::last_os_error());
        }
        struct Restore(i32, libc::termios);
        impl Drop for Restore {
            fn drop(&mut self) {
                // SAFETY: restores the settings read from the same open fd.
                unsafe { libc::tcsetattr(self.0, libc::TCSANOW, &self.1) };
            }
        }
        let _restore = Restore(fd, original);

        tty.write_all(query)?;
        tty.flush()?;
        let mut buf = [0_u8; 256];
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Ok(());
            }
            let mut pfd = libc::pollfd { fd, events: libc::POLLIN, revents: 0 };
            let ms = i32::try_from(left.as_millis()).unwrap_or(i32::MAX).max(1);
            // SAFETY: one valid pollfd for the open tty.
            let ready = unsafe { libc::poll(&mut pfd, 1, ms) };
            if ready < 0 {
                let err = io::Error::last_os_error();
                if err.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(err);
            }
            if ready == 0 {
                return Ok(());
            }
            let n = tty.read(&mut buf)?;
            if n > 0 && push(&buf[..n]) {
                return Ok(());
            }
        }
    }
}

#[cfg(windows)]
mod platform {
    use std::io::{self, Write};
    use std::time::Instant;

    use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Console::{
        ENABLE_ECHO_INPUT, ENABLE_LINE_INPUT, ENABLE_PROCESSED_INPUT,
        ENABLE_VIRTUAL_TERMINAL_INPUT, GetConsoleMode, GetNumberOfConsoleInputEvents,
        GetStdHandle, INPUT_RECORD, KEY_EVENT, ReadConsoleInputW, STD_INPUT_HANDLE,
        SetConsoleMode,
    };
    use windows_sys::Win32::System::Threading::WaitForSingleObject;

    struct Restore(HANDLE, u32);
    impl Drop for Restore {
        fn drop(&mut self) {
            // SAFETY: restores the mode read from the same console input handle.
            unsafe { SetConsoleMode(self.0, self.1) };
        }
    }

    pub(super) fn exchange(
        query: &[u8],
        deadline: Instant,
        mut push: impl FnMut(&[u8]) -> bool,
    ) -> io::Result<()> {
        // SAFETY: GetStdHandle has no preconditions.
        let input = unsafe { GetStdHandle(STD_INPUT_HANDLE) };
        let mut original = 0_u32;
        // SAFETY: `input` comes from GetStdHandle; `original` is a valid out pointer.
        if input.is_null() || input == INVALID_HANDLE_VALUE || unsafe { GetConsoleMode(input, &mut original) } == 0 {
            return Err(io::Error::new(io::ErrorKind::Unsupported, "stdin is not a console"));
        }
        let raw = (original & !(ENABLE_LINE_INPUT | ENABLE_ECHO_INPUT | ENABLE_PROCESSED_INPUT))
            | ENABLE_VIRTUAL_TERMINAL_INPUT;
        // SAFETY: `input` is a console input handle (GetConsoleMode succeeded).
        if unsafe { SetConsoleMode(input, raw) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let _restore = Restore(input, original);

        let mut stdout = io::stdout().lock();
        stdout.write_all(query)?;
        stdout.flush()?;

        // SAFETY: INPUT_RECORD is plain old data; zero is a valid bit pattern.
        let mut records: [INPUT_RECORD; 64] = unsafe { std::mem::zeroed() };
        let mut bytes = Vec::with_capacity(64);
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Ok(());
            }
            let ms = u32::try_from(left.as_millis()).unwrap_or(u32::MAX).max(1);
            // SAFETY: waiting on a valid console input handle.
            if unsafe { WaitForSingleObject(input, ms) } != WAIT_OBJECT_0 {
                return Ok(());
            }
            let mut pending = 0_u32;
            // SAFETY: valid handle and out pointer.
            if unsafe { GetNumberOfConsoleInputEvents(input, &mut pending) } == 0 || pending == 0 {
                continue;
            }
            let mut read = 0_u32;
            // SAFETY: `records` holds 64 entries; ReadConsoleInputW writes at most that many.
            if unsafe { ReadConsoleInputW(input, records.as_mut_ptr(), records.len() as u32, &mut read) } == 0 {
                return Err(io::Error::last_os_error());
            }
            bytes.clear();
            for record in &records[..read as usize] {
                if u32::from(record.EventType) != KEY_EVENT {
                    continue;
                }
                // SAFETY: EventType == KEY_EVENT selects the KeyEvent union member.
                let key = unsafe { record.Event.KeyEvent };
                if key.bKeyDown == 0 {
                    continue;
                }
                // SAFETY: both union members are u16-sized; UnicodeChar is the one VT input fills.
                let unit = unsafe { key.uChar.UnicodeChar };
                if let Some(c) = char::from_u32(u32::from(unit)) {
                    let mut utf8 = [0_u8; 4];
                    for _ in 0..key.wRepeatCount.max(1) {
                        bytes.extend_from_slice(c.encode_utf8(&mut utf8).as_bytes());
                    }
                }
            }
            if !bytes.is_empty() && push(&bytes) {
                return Ok(());
            }
        }
    }
}

#[cfg(not(any(unix, windows)))]
mod platform {
    use std::io;
    use std::time::Instant;

    pub(super) fn exchange(_: &[u8], _: Instant, _: impl FnMut(&[u8]) -> bool) -> io::Result<()> {
        Err(io::Error::new(io::ErrorKind::Unsupported, "no terminal probing on this target"))
    }
}
