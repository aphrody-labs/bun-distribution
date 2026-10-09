// SPDX-License-Identifier: Apache-2.0
//! Capability `process.supervise` and `http.probe`: spawn a child in its own process group,
//! observe it without blocking, stop it gracefully (SIGTERM, then SIGKILL after a grace period)
//! and probe an HTTP endpoint for readiness. Everything a consumer needs to supervise a local
//! server without writing its own spawn/poll/kill code.

use aphrody_proc::NoWindow as _;
use super::*;
use std::ffi::{CStr, c_char};
use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::process::{Command, Stdio};
#[cfg(not(windows))]
use std::process::Child;
#[cfg(windows)]
use aphrody_proc::GroupChild as Child;
use std::time::Instant;

/// Grace period used when a runtime is destroyed with processes still running.
pub(crate) const DESTROY_GRACE_MS: u32 = 500;
/// Grace period used by `yolo_process_release`.
const RELEASE_GRACE_MS: u32 = 2000;
/// `YoloSpawnInfo.flags`: connect the child's stdin/stdout/stderr to the null device.
pub const YOLO_SPAWN_NULL_STDIO: u32 = 1;
/// `YoloSpawnInfo.flags`: stdin is the null device, stdout and stderr are captured (the last
/// `CAPTURE_LIMIT` bytes of each are kept) and read with `yolo_process_read`.
pub const YOLO_SPAWN_CAPTURE: u32 = 2;
/// ABI 1.4: retain all captured bytes up to the explicit per-stream budget; never truncate.
pub const YOLO_SPAWN_CAPTURE_LOSSLESS: u32 = 4;
/// Default and maximum per-stream budget for lossless capture.
pub const YOLO_CAPTURE_MAX_BYTES: usize = 64 * 1024 * 1024;
/// `yolo_process_read` streams.
pub const YOLO_STREAM_STDOUT: u32 = 1;
pub const YOLO_STREAM_STDERR: u32 = 2;
/// `yolo_process_read` modes: `DRAIN` returns and clears, `PEEK` returns without clearing.
pub const YOLO_READ_DRAIN: u32 = 0;
pub const YOLO_READ_PEEK: u32 = 1;
/// Bytes kept per captured stream; older bytes are dropped.
const CAPTURE_LIMIT: usize = 64 * 1024;

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct YoloSpawnInfo {
  pub struct_size: u32,
  pub flags: u32,
  /// UTF-8, NUL-terminated.
  pub program: *const c_char,
  /// NULL-terminated array of NUL-terminated UTF-8 arguments (not including the program), or NULL.
  pub args: *const *const c_char,
  /// NULL-terminated array of `KEY=VALUE` entries added to the inherited environment (`KEY` alone
  /// removes the variable), or NULL.
  pub env: *const *const c_char,
  /// Working directory, or NULL.
  pub cwd: *const c_char,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct YoloProcessStatus {
  pub struct_size: u32,
  /// 0 = running, 1 = exited.
  pub state: u32,
  /// Exit code, or -1 when the process was terminated by a signal.
  pub exit_code: i32,
  /// Terminating signal on Unix, 0 otherwise.
  pub signal: i32,
  pub pid: u32,
}

#[derive(Clone, Copy)]
struct ExitInfo {
  code: Option<i32>,
  signal: Option<i32>,
}

// Only this worker accesses the read end. Poll before read so teardown can always join it.
trait CapturePipe: Read + Send + 'static {
  fn prepare(&self) -> io::Result<()>;
  fn read_available(&mut self, buffer: &mut [u8]) -> io::Result<usize>;
}

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
  fn PeekNamedPipe(
    pipe: *mut std::ffi::c_void,
    buffer: *mut std::ffi::c_void,
    buffer_size: u32,
    bytes_read: *mut u32,
    bytes_available: *mut u32,
    bytes_left: *mut u32,
  ) -> i32;
}

macro_rules! capture_pipe {
  ($pipe:ty) => {
    impl CapturePipe for $pipe {
      fn prepare(&self) -> io::Result<()> {
        #[cfg(unix)]
        {
          use std::os::fd::AsRawFd;
          let fd = self.as_raw_fd();
          // SAFETY: fd is borrowed from this owned pipe; no ownership is transferred.
          let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
          if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
            return Err(io::Error::last_os_error());
          }
        }
        Ok(())
      }

      fn read_available(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        #[cfg(windows)]
        {
          use std::os::windows::io::AsRawHandle;
          let mut available = 0;
          // SAFETY: the handle belongs to this pipe, the optional buffers are null and
          // available is writable. This is the sole reader of this synchronous handle.
          let ready = unsafe {
            PeekNamedPipe(
              self.as_raw_handle(),
              ptr::null_mut(),
              0,
              ptr::null_mut(),
              &mut available,
              ptr::null_mut(),
            )
          };
          if ready == 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(109) {
              // ERROR_BROKEN_PIPE: every writer closed.
              return Ok(0);
            }
            return Err(error);
          }
          if available == 0 {
            return Err(io::Error::from(io::ErrorKind::WouldBlock));
          }
          let bytes = buffer.len().min(available as usize);
          return self.read(&mut buffer[..bytes]);
        }
        #[cfg(not(windows))]
        self.read(buffer)
      }
    }
  };
}
capture_pipe!(std::process::ChildStdout);
capture_pipe!(std::process::ChildStderr);

#[derive(Default)]
struct CaptureData {
  bytes: Vec<u8>,
  total: usize,
  error: Option<(YoloStatus, String)>,
}

struct Capture {
  data: Mutex<CaptureData>,
  limit: Option<usize>,
  cancel: AtomicBool,
  finished: AtomicBool,
}

impl Capture {
  fn new(limit: Option<usize>) -> Self {
    Self {
      data: Mutex::new(CaptureData::default()),
      limit,
      cancel: AtomicBool::new(false),
      finished: AtomicBool::new(false),
    }
  }

  fn fail(&self, status: YoloStatus, message: String) {
    let mut data = lock(&self.data);
    if data.error.is_none() {
      data.error = Some((status, message));
    }
  }

  fn pump(
    self: Arc<Self>,
    mut source: impl CapturePipe,
    name: &'static str,
  ) -> io::Result<JoinHandle<()>> {
    source.prepare()?;
    std::thread::Builder::new()
      .name(format!("yolo-{name}"))
      .spawn(move || {
        let mut chunk = [0u8; 4096];
        let mut cancelled_at = None;
        loop {
          if self.cancel.load(Ordering::Acquire) {
            let deadline = cancelled_at.get_or_insert_with(Instant::now);
            if deadline.elapsed() > Duration::from_millis(100) {
              self.fail(
                YoloStatus::Internal,
                format!("{name} did not reach EOF during shutdown"),
              );
              break;
            }
          }
          match source.read_available(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
              let mut data = lock(&self.data);
              data.total = data.total.saturating_add(n);
              if let Some(limit) = self.limit
                && data.total > limit
              {
                if data.error.is_none() {
                  data.error = Some((
                    YoloStatus::OutputLimit,
                    format!("{name} exceeded its {limit} byte capture budget"),
                  ));
                }
                // Continue draining the pipe so the child cannot deadlock on its output.
                continue;
              }
              data.bytes.extend_from_slice(&chunk[..n]);
              if self.limit.is_none() && data.bytes.len() > CAPTURE_LIMIT {
                let excess = data.bytes.len() - CAPTURE_LIMIT;
                data.bytes.drain(..excess);
              }
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
              if self.cancel.load(Ordering::Acquire) && self.limit.is_none() {
                break;
              }
              // A killed descendant may still be closing its pipe. Lossless mode waits for
              // EOF within the cancellation deadline rather than reporting a transient gap.
              std::thread::sleep(Duration::from_millis(5));
            }
            Err(error) => {
              self.fail(YoloStatus::Internal, format!("cannot read {name}: {error}"));
              break;
            }
          }
        }
        self.finished.store(true, Ordering::Release);
      })
  }
}

pub(crate) struct ProcState {
  pid: u32,
  child: Mutex<Child>,
  exit: Mutex<Option<ExitInfo>>,
  stdout: Arc<Capture>,
  stderr: Arc<Capture>,
  readers: Mutex<Vec<JoinHandle<()>>>,
  stopped: Mutex<bool>,
}

impl ProcState {
  fn poll(&self) -> Option<ExitInfo> {
    if let Some(info) = *lock(&self.exit) {
      return Some(info);
    }
    let status = lock(&self.child).try_wait().ok().flatten()?;
    #[cfg(unix)]
    let signal = std::os::unix::process::ExitStatusExt::signal(&status);
    #[cfg(not(unix))]
    let signal = None;
    let info = ExitInfo {
      code: status.code(),
      signal,
    };
    *lock(&self.exit) = Some(info);
    Some(info)
  }

  #[cfg(unix)]
  fn group_alive(&self) -> bool {
    // SAFETY: signal 0 only queries the process group we created at spawn.
    unsafe { libc::kill(-(self.pid as i32), 0) == 0 }
  }

  /// Stops the owned group even when its leader already exited, then joins every pipe reader.
  pub(crate) fn stop(&self, grace_ms: u32) {
    let mut stopped = lock(&self.stopped);
    if *stopped {
      return;
    }
    #[cfg(unix)]
    {
      if self.group_alive() {
        // SAFETY: this process group was created with process_group(0).
        unsafe { libc::kill(-(self.pid as i32), libc::SIGTERM) };
        let deadline = Instant::now() + Duration::from_millis(u64::from(grace_ms));
        while Instant::now() < deadline {
          self.poll(); // Reap the leader before querying whether its group is empty.
          if !self.group_alive() {
            break;
          }
          std::thread::sleep(Duration::from_millis(10));
        }
        if self.group_alive() {
          // SAFETY: same owned group; descendants must die even if the leader exited first.
          unsafe { libc::kill(-(self.pid as i32), libc::SIGKILL) };
        }
      }
    }
    #[cfg(windows)]
    {
      let _ = grace_ms;
      // The proc owner keeps the Job Object alive even after its leader exits.
      let _ = lock(&self.child).kill_tree();
    }
    #[cfg(not(any(unix, windows)))]
    {
      let _ = grace_ms;
      if self.poll().is_none() {
        let _ = lock(&self.child).kill();
      }
    }
    if self.poll().is_none() {
      let _ = lock(&self.child).wait();
    }
    self.poll();
    // A child may have passed its pipe to an escaped descendant. Cancellation prevents that
    // pipe from retaining a native worker forever; lossless readers report incomplete output.
    self.stdout.cancel.store(true, Ordering::Release);
    self.stderr.cancel.store(true, Ordering::Release);
    for reader in lock(&self.readers).drain(..) {
      if reader.join().is_err() {
        self
          .stdout
          .fail(YoloStatus::Panic, "capture worker panicked".to_string());
        self
          .stderr
          .fail(YoloStatus::Panic, "capture worker panicked".to_string());
      }
    }
    *stopped = true;
  }
}

fn read_c_string(ptr: *const c_char, what: &str) -> Result<String, YoloStatus> {
  if ptr.is_null() {
    return Err(set_error(
      YoloStatus::InvalidArgument,
      format!("{what} is null"),
    ));
  }
  // SAFETY: the caller guarantees NUL-terminated strings.
  unsafe { CStr::from_ptr(ptr) }
    .to_str()
    .map(str::to_owned)
    .map_err(|_| {
      set_error(
        YoloStatus::InvalidArgument,
        format!("{what} is not valid UTF-8"),
      )
    })
}

fn read_c_array(mut array: *const *const c_char, what: &str) -> Result<Vec<String>, YoloStatus> {
  let mut out = Vec::new();
  if array.is_null() {
    return Ok(out);
  }
  loop {
    // SAFETY: the array is NULL-terminated per the contract.
    let item = unsafe { *array };
    if item.is_null() {
      return Ok(out);
    }
    out.push(read_c_string(item, what)?);
    // SAFETY: the previous element was not the terminator.
    array = unsafe { array.add(1) };
  }
}

/// Spawns a process owned by the runtime. The child runs in its own process group so that stopping
/// it also stops its descendants. Counts against `max_operations` like an operation.
///
/// # Safety
/// `info` must point to a readable `YoloSpawnInfo` with valid strings, `out` to a writable handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_process_spawn(
  runtime: YoloHandle,
  info: *const YoloSpawnInfo,
  out: *mut YoloHandle,
) -> YoloStatus {
  guard(|| {
    if info.is_null() || out.is_null() {
      return set_error(YoloStatus::InvalidArgument, "null argument");
    }
    // SAFETY: readable per the contract; the first field is read before trusting the size.
    let struct_size = unsafe { ptr::addr_of!((*info).struct_size).read_unaligned() };
    if (struct_size as usize) < size_of::<YoloSpawnInfo>() {
      return set_error(YoloStatus::InvalidArgument, "struct_size too small");
    }
    // SAFETY: the structure is fully readable.
    // ABI 1.0-1.3 callers supply the original 40-byte structure. ABI 1.4 may append a
    // per-stream lossless budget; zero selects the default.
    let capture_limit = if struct_size as usize >= size_of::<YoloSpawnInfo>() + size_of::<u64>() {
      // SAFETY: struct_size includes this appended u64, and the caller promises readable storage.
      unsafe {
        info
          .cast::<u8>()
          .add(size_of::<YoloSpawnInfo>())
          .cast::<u64>()
          .read_unaligned()
      }
    } else {
      0
    };
    let info = unsafe { info.read_unaligned() };
    if info.flags & !(YOLO_SPAWN_NULL_STDIO | YOLO_SPAWN_CAPTURE | YOLO_SPAWN_CAPTURE_LOSSLESS) != 0
    {
      return set_error(YoloStatus::InvalidArgument, "unknown spawn flags");
    }
    if capture_limit > YOLO_CAPTURE_MAX_BYTES as u64 {
      return set_error(YoloStatus::InvalidArgument, "capture budget exceeds 64 MiB");
    }
    let lossless = info.flags & YOLO_SPAWN_CAPTURE_LOSSLESS != 0;
    if lossless && info.flags & (YOLO_SPAWN_NULL_STDIO | YOLO_SPAWN_CAPTURE) != 0 {
      return set_error(
        YoloStatus::InvalidArgument,
        "LOSSLESS, CAPTURE and NULL_STDIO are exclusive",
      );
    }
    if !lossless && capture_limit != 0 {
      return set_error(
        YoloStatus::InvalidArgument,
        "capture budget requires lossless capture",
      );
    }
    let program = match read_c_string(info.program, "program") {
      Ok(p) => p,
      Err(status) => return status,
    };
    let args = match read_c_array(info.args, "argument") {
      Ok(a) => a,
      Err(status) => return status,
    };
    let env = match read_c_array(info.env, "environment entry") {
      Ok(e) => e,
      Err(status) => return status,
    };
    let cwd = if info.cwd.is_null() {
      None
    } else {
      match read_c_string(info.cwd, "cwd") {
        Ok(c) => Some(c),
        Err(status) => return status,
      }
    };

    let mut command = Command::new(&program).no_window();
    command.args(&args);
    for entry in &env {
      match entry.split_once('=') {
        Some((key, value)) if !key.is_empty() => command.env(key, value),
        // `KEY` alone removes the variable from the inherited environment.
        None if !entry.is_empty() => command.env_remove(entry),
        _ => {
          return set_error(
            YoloStatus::InvalidArgument,
            "environment entries are KEY=VALUE, or KEY to remove the variable",
          );
        }
      };
    }
    if let Some(cwd) = &cwd {
      command.current_dir(cwd);
    }
    let null_stdio = info.flags & YOLO_SPAWN_NULL_STDIO != 0;
    let capture = info.flags & (YOLO_SPAWN_CAPTURE | YOLO_SPAWN_CAPTURE_LOSSLESS) != 0;
    if null_stdio && capture {
      return set_error(
        YoloStatus::InvalidArgument,
        "NULL_STDIO and CAPTURE are exclusive",
      );
    }
    if null_stdio {
      command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    } else if capture {
      command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    }
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut command, 0);

    let mut reg = lock(registry());
    let limit = match runtime_limit(&reg, runtime) {
      Ok(limit) => limit,
      Err(status) => return status,
    };
    if reg.operations_of(runtime).len() as u32 >= limit {
      return set_error(
        YoloStatus::Busy,
        format!("{limit} operations already running"),
      );
    }
    #[cfg(windows)]
    let spawned = aphrody_proc::spawn_group(&mut command, aphrody_proc::SpawnOptions {
      hide_window: true,
      ..Default::default()
    });
    #[cfg(not(windows))]
    let spawned = command.spawn();
    let mut child = match spawned {
      Ok(child) => child,
      Err(error) => {
        return set_error(
          YoloStatus::Internal,
          format!("cannot spawn `{program}`: {error}"),
        );
      }
    };
    let limit = lossless.then_some(if capture_limit == 0 {
      YOLO_CAPTURE_MAX_BYTES
    } else {
      capture_limit as usize
    });
    let stdout = Arc::new(Capture::new(limit));
    let stderr = Arc::new(Capture::new(limit));
    #[cfg(windows)]
    let (stdout_pipe, stderr_pipe) = (child.take_stdout(), child.take_stderr());
    #[cfg(not(windows))]
    let (stdout_pipe, stderr_pipe) = (child.stdout.take(), child.stderr.take());
    let state = Arc::new(ProcState {
      pid: child.id(),
      child: Mutex::new(child),
      exit: Mutex::new(None),
      stdout,
      stderr,
      readers: Mutex::new(Vec::new()),
      stopped: Mutex::new(false),
    });
    let started = (|| -> io::Result<()> {
      if let Some(pipe) = stdout_pipe {
        lock(&state.readers).push(Arc::clone(&state.stdout).pump(pipe, "stdout")?);
      } else {
        state.stdout.finished.store(true, Ordering::Release);
      }
      if let Some(pipe) = stderr_pipe {
        lock(&state.readers).push(Arc::clone(&state.stderr).pump(pipe, "stderr")?);
      } else {
        state.stderr.finished.store(true, Ordering::Release);
      }
      Ok(())
    })();
    if let Err(error) = started {
      // No reader accesses the registry, but drop its lock before potentially waiting on workers.
      drop(reg);
      state.stop(0);
      return set_error(
        YoloStatus::Internal,
        format!("cannot start capture worker: {error}"),
      );
    }
    let handle = reg.insert(Entry::Process {
      owner: runtime,
      state,
    });
    drop(reg);
    // SAFETY: `out` is writable per the contract.
    unsafe { out.write(handle) };
    YoloStatus::Ok
  })
}

fn process_state(process: YoloHandle) -> Result<Arc<ProcState>, YoloStatus> {
  match lock(registry()).get(process) {
    Some(Entry::Process { state, .. }) => Ok(Arc::clone(state)),
    _ => Err(set_error(
      YoloStatus::InvalidHandle,
      "invalid process handle",
    )),
  }
}

/// Non-blocking status of the process.
///
/// # Safety
/// `out` must point to a writable `YoloProcessStatus` whose `struct_size` is set by the caller.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_process_status(
  process: YoloHandle,
  out: *mut YoloProcessStatus,
) -> YoloStatus {
  guard(|| {
    if out.is_null() {
      return set_error(YoloStatus::InvalidArgument, "null output");
    }
    let state = match process_state(process) {
      Ok(state) => state,
      Err(status) => return status,
    };
    let exit = state.poll();
    let status = YoloProcessStatus {
      struct_size: size_of::<YoloProcessStatus>() as u32,
      state: u32::from(exit.is_some()),
      exit_code: exit.map_or(0, |e| e.code.unwrap_or(-1)),
      signal: exit.and_then(|e| e.signal).unwrap_or(0),
      pid: state.pid,
    };
    // SAFETY: `out` is writable per the contract.
    unsafe { out.write(status) };
    YoloStatus::Ok
  })
}

/// Reads the captured output of a process spawned with `YOLO_SPAWN_CAPTURE`: `stream` is
/// `YOLO_STREAM_STDOUT` or `YOLO_STREAM_STDERR`, `mode` is `YOLO_READ_DRAIN` or `YOLO_READ_PEEK`.
/// The bytes are returned in a library-owned buffer (possibly empty).
///
/// # Safety
/// `out` must point to a writable `YoloBuffer`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_process_read(
  process: YoloHandle,
  stream: u32,
  mode: u32,
  out: *mut YoloBuffer,
) -> YoloStatus {
  guard(|| {
    if out.is_null() {
      return set_error(YoloStatus::InvalidArgument, "null output buffer");
    }
    let state = match process_state(process) {
      Ok(state) => state,
      Err(status) => return status,
    };
    let capture = match stream {
      YOLO_STREAM_STDOUT => &state.stdout,
      YOLO_STREAM_STDERR => &state.stderr,
      _ => return set_error(YoloStatus::InvalidArgument, "unknown stream"),
    };
    let bytes = {
      let mut data = lock(&capture.data);
      if let Some((status, message)) = &data.error {
        return set_error(*status, message);
      }
      match mode {
        YOLO_READ_DRAIN => std::mem::take(&mut data.bytes),
        YOLO_READ_PEEK => data.bytes.clone(),
        _ => return set_error(YoloStatus::InvalidArgument, "unknown read mode"),
      }
    };
    write_buffer(out, bytes)
  })
}

/// ABI 1.4: returns 1 after both capture readers finish, 0 while either can still produce bytes.
/// Completion does not imply success; yolo_process_read reports output limits and I/O failures.
///
/// # Safety
/// out must point to a writable u32.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_process_output_complete(
  process: YoloHandle,
  out: *mut u32,
) -> YoloStatus {
  guard(|| {
    if out.is_null() {
      return set_error(YoloStatus::InvalidArgument, "null output");
    }
    let state = match process_state(process) {
      Ok(state) => state,
      Err(status) => return status,
    };
    let complete = state.stdout.finished.load(Ordering::Acquire)
      && state.stderr.finished.load(Ordering::Acquire);
    // SAFETY: out is writable per the contract.
    unsafe { out.write(u32::from(complete)) };
    YoloStatus::Ok
  })
}

/// Stops the process (SIGTERM to its group, SIGKILL after `grace_ms`) and waits for it. The handle
/// stays valid so the exit status can still be read.
#[unsafe(no_mangle)]
pub extern "C" fn yolo_process_stop(process: YoloHandle, grace_ms: u32) -> YoloStatus {
  guard(|| match process_state(process) {
    Ok(state) => {
      state.stop(grace_ms);
      YoloStatus::Ok
    }
    Err(status) => status,
  })
}

/// Asynchronous `yolo_process_stop`: the SIGTERM/grace/SIGKILL sequence runs on a worker thread and
/// the operation (not counted against `max_operations`) yields `{"exit_code": n, "signal": n}`.
///
/// # Safety
/// `out_operation` must point to a writable `YoloHandle`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_process_stop_start(
  process: YoloHandle,
  grace_ms: u32,
  out_operation: *mut YoloHandle,
) -> YoloStatus {
  guard(|| {
    if out_operation.is_null() {
      return set_error(YoloStatus::InvalidArgument, "null output handle");
    }
    let (owner, state) = match lock(registry()).get(process) {
      Some(Entry::Process { owner, state }) => (*owner, Arc::clone(state)),
      _ => return set_error(YoloStatus::InvalidHandle, "invalid process handle"),
    };
    let started = start_operation(owner, "stop", false, move |_| {
      state.stop(grace_ms);
      let exit = state.poll();
      OpResult::Done(
        serde_json::json!({
          "exit_code": exit.map_or(0, |e| e.code.unwrap_or(-1)),
          "signal": exit.and_then(|e| e.signal).unwrap_or(0),
        })
        .to_string(),
      )
    });
    match started {
      Ok(handle) => {
        // SAFETY: `out_operation` is writable per the contract.
        unsafe { out_operation.write(handle) };
        YoloStatus::Ok
      }
      Err(status) => status,
    }
  })
}

/// Stops the process if it is still running (2 s grace) and invalidates the handle.
#[unsafe(no_mangle)]
pub extern "C" fn yolo_process_release(process: YoloHandle) -> YoloStatus {
  guard(|| {
    let entry = {
      let mut reg = lock(registry());
      match reg.get(process) {
        Some(Entry::Process { .. }) => reg.remove(process),
        _ => None,
      }
    };
    match entry {
      Some(Entry::Process { state, .. }) => {
        state.stop(RELEASE_GRACE_MS);
        YoloStatus::Ok
      }
      _ => set_error(YoloStatus::InvalidHandle, "invalid process handle"),
    }
  })
}

/// One HTTP/1.0 `GET` with connect/read timeouts. `Ok(status)` when the server answers, `Err(why)`
/// when it is not reachable (yet).
fn probe_blocking(host: &str, port: u16, path: &str, timeout: Duration) -> Result<i32, String> {
  let addrs = (host, port)
    .to_socket_addrs()
    .map_err(|error| format!("cannot resolve {host}: {error}"))?;
  let mut last = "no address".to_string();
  for addr in addrs {
    let mut stream = match TcpStream::connect_timeout(&addr, timeout) {
      Ok(stream) => stream,
      Err(error) => {
        last = error.to_string();
        continue;
      }
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let request = format!(
      "GET {path} HTTP/1.0\r\nHost: {host}:{port}\r\nUser-Agent: yolo-runtime/{}\r\nAccept: */*\r\nConnection: close\r\n\r\n",
      env!("CARGO_PKG_VERSION")
    );
    if let Err(error) = stream.write_all(request.as_bytes()) {
      last = error.to_string();
      continue;
    }
    let mut head = [0u8; 32];
    let mut filled = 0;
    let mut read_failure = None;
    while filled < head.len() {
      match stream.read(&mut head[filled..]) {
        Ok(0) => break,
        Ok(n) => filled += n,
        Err(error) => {
          read_failure = Some(error.to_string());
          break;
        }
      }
      if head[..filled].contains(&b'\r') || head[..filled].contains(&b'\n') {
        break;
      }
    }
    let line = String::from_utf8_lossy(&head[..filled]);
    let code = line
      .strip_prefix("HTTP/1.")
      .and_then(|rest| rest.get(2..5))
      .and_then(|code| code.parse::<i32>().ok());
    match code {
      Some(code) => return Ok(code),
      None => {
        last = read_failure.unwrap_or_else(|| format!("not an HTTP response: {line:?}"));
      }
    }
  }
  Err(last)
}

/// `http.probe`: starts one HTTP/1.0 `GET` on a worker thread and returns an operation handle, so
/// the caller never blocks. `yolo_operation_wait` yields the JSON `{"status": <code>}` when the
/// server answered and `{"status": null, "error": "<why>"}` when it is not reachable (yet).
///
/// # Safety
/// `host` and `path` must be NUL-terminated UTF-8; `out_operation` must be writable.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_http_probe_start(
  runtime: YoloHandle,
  host: *const c_char,
  port: u16,
  path: *const c_char,
  timeout_ms: u32,
  out_operation: *mut YoloHandle,
) -> YoloStatus {
  guard(|| {
    if out_operation.is_null() {
      return set_error(YoloStatus::InvalidArgument, "null output handle");
    }
    let host = match read_c_string(host, "host") {
      Ok(h) if !h.contains(['\r', '\n', ' ']) => h,
      Ok(_) => return set_error(YoloStatus::InvalidArgument, "invalid host"),
      Err(status) => return status,
    };
    let path = match read_c_string(path, "path") {
      Ok(p) if p.starts_with('/') && !p.contains(['\r', '\n', ' ']) => p,
      Ok(_) => {
        return set_error(
          YoloStatus::InvalidArgument,
          "path must start with / and contain no whitespace",
        );
      }
      Err(status) => return status,
    };
    let timeout = Duration::from_millis(u64::from(timeout_ms.max(1)));
    let started = start_operation(runtime, "probe", true, move |cancel| {
      if cancel.load(Ordering::Relaxed) {
        return OpResult::Cancelled;
      }
      let value = match probe_blocking(&host, port, &path, timeout) {
        Ok(status) => serde_json::json!({ "status": status }),
        Err(error) => serde_json::json!({ "status": null, "error": error }),
      };
      OpResult::Done(value.to_string())
    });
    match started {
      Ok(handle) => {
        // SAFETY: `out_operation` is writable per the contract.
        unsafe { out_operation.write(handle) };
        YoloStatus::Ok
      }
      Err(status) => status,
    }
  })
}
