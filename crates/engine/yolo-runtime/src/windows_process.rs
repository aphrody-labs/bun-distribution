//! Windows process-tree ownership established before the child can execute user code.
//! Stable std::Command creates the child suspended, retaining std Child/stdio behavior.
//! Its only thread is resumed after admission to a non-inheritable kill-on-close Job.
//! No process that has begun executing is adopted, and no breakaway fallback is allowed.
use std::io;
use std::mem::{offset_of, size_of};
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::os::windows::process::CommandExt;
use std::process::{Child, Command};

use windows_sys::Win32::Foundation::{ERROR_NO_MORE_FILES, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
  CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
};
use windows_sys::Win32::System::JobObjects::{
  AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation, SetInformationJobObject,
  TerminateJobObject,
};
use windows_sys::Win32::System::Threading::{
  CREATE_SUSPENDED, GetProcessIdOfThread, OpenThread, ResumeThread,
  THREAD_QUERY_LIMITED_INFORMATION, THREAD_SUSPEND_RESUME,
};

fn owned(handle: HANDLE) -> io::Result<OwnedHandle> {
  if handle.is_null() || handle == INVALID_HANDLE_VALUE {
    return Err(io::Error::last_os_error());
  }
  // SAFETY: every caller transfers one fresh, checked Win32 handle; never a pseudo handle.
  Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}

/// The unique owner handle is never inherited by the child. It closes at runtime teardown,
/// terminating all processes still in the job even if the leader has exited already.
#[derive(Debug)]
pub(crate) struct Job(OwnedHandle);

impl Job {
  fn new() -> io::Result<Self> {
    // SAFETY: NULL security attributes create a non-inheritable handle; no named shared job.
    let job = Self(owned(unsafe {
      CreateJobObjectW(std::ptr::null(), std::ptr::null())
    })?);
    // SAFETY: the native limit structure consists of scalar fields and supports zero defaults.
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    // SAFETY: the owned job and correctly sized limit structure outlive this synchronous call.
    if unsafe {
      SetInformationJobObject(
        job.0.as_raw_handle(),
        JobObjectExtendedLimitInformation,
        (&raw const limits).cast(),
        size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
      )
    } == 0
    {
      return Err(io::Error::last_os_error());
    }
    Ok(job)
  }

  fn assign(&self, child: &Child) -> io::Result<()> {
    // SAFETY: the handles are borrowed from their owners. The child's primary thread is still
    // suspended: it cannot start a descendant before the kernel places it in this job.
    if unsafe { AssignProcessToJobObject(self.0.as_raw_handle(), child.as_raw_handle()) } == 0 {
      return Err(io::Error::last_os_error());
    }
    Ok(())
  }

  /// Terminate the entire owned job without relying on the leader still being alive.
  pub(crate) fn terminate(&self) -> io::Result<()> {
    // SAFETY: this live handle references only the anonymous job we created and admitted.
    if unsafe { TerminateJobObject(self.0.as_raw_handle(), 1) } == 0 {
      return Err(io::Error::last_os_error());
    }
    Ok(())
  }
}

fn primary_thread(pid: u32) -> io::Result<OwnedHandle> {
  // SAFETY: snapshot contains system thread metadata; no thread is changed by enumeration.
  let snapshot = owned(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) })?;
  // SAFETY: THREADENTRY32 is scalar-only; dwSize announces the exact native structure.
  let mut entry: THREADENTRY32 = unsafe { std::mem::zeroed() };
  entry.dwSize = size_of::<THREADENTRY32>() as u32;
  // SAFETY: snapshot is owned and entry is a writable, sized structure.
  let mut present = unsafe { Thread32First(snapshot.as_raw_handle(), &raw mut entry) } != 0;
  let mut thread_id = None;
  while present {
    if entry.dwSize < (offset_of!(THREADENTRY32, th32OwnerProcessID) + size_of::<u32>()) as u32 {
      return Err(io::Error::other(
        "thread snapshot does not contain a complete owner PID",
      ));
    }
    if entry.th32OwnerProcessID == pid && thread_id.replace(entry.th32ThreadID).is_some() {
      return Err(io::Error::other(
        "suspended child has more than one thread; refusing to resume",
      ));
    }
    entry.dwSize = size_of::<THREADENTRY32>() as u32;
    // SAFETY: same sized structure, the live snapshot remains borrowed.
    present = unsafe { Thread32Next(snapshot.as_raw_handle(), &raw mut entry) } != 0;
  }
  let error = io::Error::last_os_error();
  if error.raw_os_error() != Some(ERROR_NO_MORE_FILES as i32) {
    return Err(error);
  }
  let thread_id =
    thread_id.ok_or_else(|| io::Error::other("suspended child has no primary thread"))?;
  // SAFETY: thread ID came from this process's snapshot entry, handle is non-inheritable.
  let thread = owned(unsafe {
    OpenThread(
      THREAD_SUSPEND_RESUME | THREAD_QUERY_LIMITED_INFORMATION,
      0,
      thread_id,
    )
  })?;
  // SAFETY: the queried thread handle is live; verify identity again against ID reuse.
  if unsafe { GetProcessIdOfThread(thread.as_raw_handle()) } != pid {
    return Err(io::Error::other(
      "primary thread no longer belongs to the suspended child",
    ));
  }
  Ok(thread)
}

fn resume(child: &Child) -> io::Result<()> {
  let thread = primary_thread(child.id())?;
  // SAFETY: this verified sole thread of our owned child is admitted to the job before resume.
  let previous_count = unsafe { ResumeThread(thread.as_raw_handle()) };
  if previous_count == u32::MAX {
    return Err(io::Error::last_os_error());
  }
  if previous_count != 1 {
    return Err(io::Error::other(format!(
      "unexpected primary thread suspend count {previous_count}; refusing startup"
    )));
  }
  Ok(())
}

fn finish_spawn(mut child: Child, job: Job) -> io::Result<(Child, Job)> {
  if let Err(error) = job.assign(&child).and_then(|()| resume(&child)) {
    // Failure before resume must not leave a suspended child behind. If assignment failed,
    // terminating the job is insufficient, so also terminate/reap this exact std Child.
    let _ = job.terminate();
    drop(job); // Closing the owner is a second kernel kill path before waiting on the leader.
    let _ = child.kill();
    if let Err(cleanup) = child.wait() {
      return Err(io::Error::new(
        error.kind(),
        format!("{error}; failed to reap the rejected child: {cleanup}"),
      ));
    }
    return Err(error);
  }
  Ok((child, job))
}

/// Preserve std argument/environment/stdio/capture semantics. The ABI does not accept native
/// creation flags; only its owned suspended-start flag is set here, never a breakaway flag.
pub(crate) fn spawn_owned(command: &mut Command) -> io::Result<(Child, Job)> {
  let job = Job::new()?;
  command.creation_flags(CREATE_SUSPENDED);
  let child = command.spawn()?;
  finish_spawn(child, job)
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::{BufRead, BufReader};
  use std::process::Stdio;
  use std::time::{Duration, Instant};
  use windows_sys::Win32::Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT};
  use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, SuspendThread,
    WaitForSingleObject,
  };

  fn process(pid: u32) -> OwnedHandle {
    // SAFETY: open a non-inheritable query/wait handle for the owned test child's PID.
    owned(unsafe {
      OpenProcess(
        PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
        0,
        pid,
      )
    })
    .unwrap()
  }

  fn descendant(child: &mut Child) -> OwnedHandle {
    let stdout = child.stdout.take().unwrap();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
      let mut line = String::new();
      let result = BufReader::new(stdout).read_line(&mut line).map(|_| line);
      let _ = sender.send(result);
    });
    let line = receiver
      .recv_timeout(Duration::from_secs(10))
      .expect("owned leader did not publish its descendant PID")
      .unwrap();
    process(line.trim().parse().unwrap())
  }

  fn wait_leader(child: &mut Child) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while child.try_wait().unwrap().is_none() {
      assert!(Instant::now() < deadline, "leader did not exit");
      std::thread::sleep(Duration::from_millis(10));
    }
  }

  #[test]
  fn kill_on_close_terminates_a_descendant_after_its_leader_exits() {
    let mut command = Command::new("powershell.exe");
    command.args([
      "-NoProfile", "-NonInteractive", "-Command",
      "$p = Start-Process -FilePath $env:ComSpec -ArgumentList '/c ping -n 60 127.0.0.1 > nul' -NoNewWindow -PassThru; [Console]::WriteLine($p.Id)",
    ]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    let (mut child, job) = spawn_owned(&mut command).unwrap();
    let descendant = descendant(&mut child);
    wait_leader(&mut child);
    // SAFETY: the wait handle identifies exactly the owned descendant.
    assert_eq!(
      unsafe { WaitForSingleObject(descendant.as_raw_handle(), 0) },
      WAIT_TIMEOUT
    );
    drop(job);
    // SAFETY: keep the descendant's handle alive to observe actual termination.
    assert_eq!(
      unsafe { WaitForSingleObject(descendant.as_raw_handle(), 5_000) },
      WAIT_OBJECT_0
    );
  }

  #[test]
  fn explicit_termination_owns_descendants_and_preserves_binary_capture() {
    let mut command = Command::new("powershell.exe");
    command.args([
      "-NoProfile", "-NonInteractive", "-Command",
      "$p = Start-Process -FilePath $env:ComSpec -ArgumentList '/c ping -n 60 127.0.0.1 > nul' -NoNewWindow -PassThru; [Console]::WriteLine($p.Id); [Console]::OpenStandardError().Write([byte[]](0,255,10),0,3)",
    ]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let (mut child, job) = spawn_owned(&mut command).unwrap();
    let descendant = descendant(&mut child);
    wait_leader(&mut child);
    job.terminate().unwrap();
    // SAFETY: the retained handle observes the exact owned descendant's exit.
    assert_eq!(
      unsafe { WaitForSingleObject(descendant.as_raw_handle(), 5_000) },
      WAIT_OBJECT_0
    );
    let mut captured = Vec::new();
    std::io::Read::read_to_end(&mut child.stderr.take().unwrap(), &mut captured).unwrap();
    assert_eq!(captured, [0, 255, 10]);
  }

  #[test]
  fn failed_resume_terminates_and_reaps_the_suspended_child() {
    let mut command = Command::new("powershell.exe");
    command
      .args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Start-Sleep -Seconds 60",
      ])
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .creation_flags(CREATE_SUSPENDED);
    let child = command.spawn().unwrap();
    let observed = process(child.id());
    let thread = primary_thread(child.id()).unwrap();
    // SAFETY: introduce an extra suspension on the owned test child to exercise fail-closed
    // cleanup. ResumeThread will report 2 instead of the required initial count of 1.
    assert_eq!(unsafe { SuspendThread(thread.as_raw_handle()) }, 1);
    assert!(finish_spawn(child, Job::new().unwrap()).is_err());
    // SAFETY: this live handle proves that failed admission did not leak a suspended process.
    assert_eq!(
      unsafe { WaitForSingleObject(observed.as_raw_handle(), 5_000) },
      WAIT_OBJECT_0
    );
  }
}
