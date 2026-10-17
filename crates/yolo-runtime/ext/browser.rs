// SPDX-License-Identifier: Apache-2.0
// Optional R4 browser provider. Obscura and every V8 object stay on the context's owner thread.
// Only bounded JSON commands and library-owned buffers cross the existing C ABI.

use super::*;
use std::collections::BTreeSet;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender};
use std::time::Instant;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use obscura_browser::{BrowserContext, Page, WaitUntil};
use obscura_net::RequestInfo;
use obscura_net::interceptor::{InterceptAction, RequestInterceptor};
use serde::Deserialize;
use serde_json::{Value, json};
use url::Url;

const MAX_INPUT_BYTES: usize = 64 * 1024;
const MAX_RESULT_BYTES: usize = 8 * 1024 * 1024;
const POLL: Duration = Duration::from_millis(10);
type Interrupt = Box<dyn Fn() + Send + Sync>;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BrowserOptions {
  allowed_origins: Vec<String>,
  #[serde(default)]
  allow_private_network: bool,
  #[serde(default = "default_width")]
  width: u32,
  #[serde(default = "default_height")]
  height: u32,
  #[serde(default = "default_timeout")]
  timeout_ms: u64,
  #[serde(default = "default_result_limit")]
  max_result_bytes: usize,
}

fn default_width() -> u32 {
  1024
}
fn default_height() -> u32 {
  768
}
fn default_timeout() -> u64 {
  30_000
}
fn default_result_limit() -> usize {
  MAX_RESULT_BYTES
}

#[derive(Clone)]
struct OriginPolicy {
  origins: BTreeSet<String>,
  allow_private_network: bool,
}

impl OriginPolicy {
  fn origin(value: &str) -> Result<String, String> {
    let url = Url::parse(value).map_err(|_| "invalid browser URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
      || url.host_str().is_none()
      || !url.username().is_empty()
      || url.password().is_some()
      || url.host_str().is_some_and(|host| host.contains('*'))
    {
      return Err("browser URLs require HTTP(S), a host and no credentials".to_string());
    }
    Ok(url.origin().ascii_serialization())
  }

  fn new(options: &BrowserOptions) -> Result<Self, String> {
    if options.allowed_origins.is_empty() || options.allowed_origins.len() > 32 {
      return Err("allowedOrigins must contain 1..32 explicit origins".to_string());
    }
    if !(1..=4096).contains(&options.width) || !(1..=4096).contains(&options.height) {
      return Err("browser viewport dimensions must be 1..4096".to_string());
    }
    if !(100..=30_000).contains(&options.timeout_ms) {
      return Err("browser timeoutMs must be 100..30000".to_string());
    }
    if !(1..=MAX_RESULT_BYTES).contains(&options.max_result_bytes) {
      return Err("browser maxResultBytes must be 1..8 MiB".to_string());
    }
    let mut origins = BTreeSet::new();
    for value in &options.allowed_origins {
      let url = Url::parse(value).map_err(|_| "invalid allowed origin".to_string())?;
      if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err(
          "allowedOrigins accepts origins without paths, queries or fragments".to_string(),
        );
      }
      origins.insert(Self::origin(value)?);
    }
    Ok(Self {
      origins,
      allow_private_network: options.allow_private_network,
    })
  }

  fn permits(&self, value: &str) -> bool {
    if !Self::origin(value).is_ok_and(|origin| self.origins.contains(&origin)) {
      return false;
    }
    if self.allow_private_network {
      return true;
    }
    let Ok(url) = Url::parse(value) else {
      return false;
    };
    match url.host() {
      Some(url::Host::Ipv4(ip)) => !obscura_net::is_forbidden_ip(std::net::IpAddr::V4(ip)),
      Some(url::Host::Ipv6(ip)) => !obscura_net::is_forbidden_ip(std::net::IpAddr::V6(ip)),
      Some(url::Host::Domain(host)) => host != "localhost" && !host.ends_with(".localhost"),
      None => false,
    }
  }

  fn require(&self, value: &str) -> Result<(), String> {
    if self.permits(value) {
      Ok(())
    } else {
      Err("browser origin is outside this context's native allow-list".to_string())
    }
  }
}

// Obscura invokes this at every redirect hop and for scripts, styles, fetch/XHR and images.
// Remote scripts cannot replace this interceptor or add origins.
#[async_trait::async_trait]
impl RequestInterceptor for OriginPolicy {
  async fn intercept(&self, request: &RequestInfo) -> InterceptAction {
    if self.permits(request.url.as_str()) {
      InterceptAction::Continue
    } else {
      InterceptAction::Block
    }
  }
}

#[derive(Deserialize)]
#[serde(
  tag = "method",
  rename_all = "camelCase",
  rename_all_fields = "camelCase",
  deny_unknown_fields
)]
enum BrowserCommand {
  Navigate {
    url: String,
    #[serde(default)]
    wait_until: NavigationWait,
  },
  Snapshot,
  Content,
  Extract {
    selector: String,
  },
  Screenshot,
  Evaluate {
    expression: String,
  },
  SetCookie {
    url: String,
    cookie: String,
  },
  Cookies {
    url: String,
  },
  ClearCookies,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "lowercase")]
enum NavigationWait {
  #[default]
  Load,
  Domcontentloaded,
  Networkidle,
}

impl BrowserCommand {
  fn validate(&self, policy: &OriginPolicy) -> Result<(), String> {
    match self {
      Self::Navigate { url, .. } | Self::SetCookie { url, .. } | Self::Cookies { url } => {
        policy.require(url)
      }
      Self::Extract { selector } if selector.is_empty() || selector.len() > 4096 => {
        Err("browser selector must contain 1..4096 bytes".to_string())
      }
      Self::Evaluate { expression } if expression.len() > 32 * 1024 => {
        Err("browser expression exceeds 32 KiB".to_string())
      }
      _ => Ok(()),
    }?;
    if let Self::SetCookie { cookie, .. } = self {
      if cookie.len() > 4096 || cookie.contains(['\r', '\n', '\0']) {
        return Err("invalid browser cookie header".to_string());
      }
    }
    Ok(())
  }
}

struct Task {
  command: BrowserCommand,
  cancel: Arc<AtomicBool>,
  result: SyncSender<OpResult>,
}

enum Message {
  Task(Task),
  Stop,
}

pub(crate) struct BrowserWorker {
  owner: YoloHandle,
  policy: OriginPolicy,
  queue: SyncSender<Message>,
  thread: Mutex<Option<JoinHandle<()>>>,
  closed: Arc<AtomicBool>,
  busy: AtomicBool,
  active_cancel: Arc<Mutex<Option<Arc<AtomicBool>>>>,
  interrupt: Arc<Mutex<Option<Interrupt>>>,
}

impl BrowserWorker {
  fn start(
    owner: YoloHandle,
    options: BrowserOptions,
    policy: OriginPolicy,
  ) -> Result<Arc<Self>, YoloStatus> {
    let (queue, receiver) = mpsc::sync_channel(1);
    let closed = Arc::new(AtomicBool::new(false));
    let active_cancel = Arc::new(Mutex::new(None));
    let interrupt = Arc::new(Mutex::new(None));
    let thread_closed = Arc::clone(&closed);
    let thread_cancel = Arc::clone(&active_cancel);
    let thread_interrupt = Arc::clone(&interrupt);
    let thread_policy = policy.clone();
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let thread = std::thread::Builder::new()
      .name("yolo-browser-context".to_string())
      .spawn(move || {
        let outcome = catch_unwind(AssertUnwindSafe(|| {
          run_browser(
            receiver,
            options,
            thread_policy,
            &thread_closed,
            &thread_cancel,
            &thread_interrupt,
            ready_tx,
          );
        }));
        if outcome.is_err() {
          thread_closed.store(true, Ordering::SeqCst);
        }
      })
      .map_err(|_| set_error(YoloStatus::Internal, "cannot start browser owner thread"))?;
    if !matches!(ready_rx.recv_timeout(Duration::from_secs(5)), Ok(Ok(()))) {
      closed.store(true, Ordering::SeqCst);
      let _ = queue.try_send(Message::Stop);
      let _ = thread.join();
      return Err(set_error(
        YoloStatus::Internal,
        "browser owner thread initialization failed",
      ));
    }
    Ok(Arc::new(Self {
      owner,
      policy,
      queue,
      thread: Mutex::new(Some(thread)),
      closed,
      busy: AtomicBool::new(false),
      active_cancel,
      interrupt,
    }))
  }

  fn interrupt(&self) {
    if let Some(cancel) = lock(&self.active_cancel).as_ref() {
      cancel.store(true, Ordering::SeqCst);
    }
    if let Some(interrupt) = lock(&self.interrupt).as_ref() {
      interrupt();
    }
  }

  pub(crate) fn stop(&self) {
    self.closed.store(true, Ordering::SeqCst);
    self.interrupt();
    let _ = self.queue.try_send(Message::Stop);
    if let Some(thread) = lock(&self.thread).take() {
      let _ = thread.join();
    }
  }

  fn execute(self: &Arc<Self>, command: BrowserCommand, cancel: &AtomicBool) -> OpResult {
    let task_cancel = Arc::new(AtomicBool::new(cancel.load(Ordering::SeqCst)));
    let (result_tx, result_rx) = mpsc::sync_channel(1);
    if self.closed.load(Ordering::SeqCst)
      || self
        .queue
        .try_send(Message::Task(Task {
          command,
          cancel: Arc::clone(&task_cancel),
          result: result_tx,
        }))
        .is_err()
    {
      self.busy.store(false, Ordering::SeqCst);
      return OpResult::Failed("browser owner thread is closed".to_string());
    }
    let outcome = loop {
      if cancel.load(Ordering::SeqCst) || self.closed.load(Ordering::SeqCst) {
        task_cancel.store(true, Ordering::SeqCst);
        self.interrupt();
      }
      match result_rx.recv_timeout(POLL) {
        Ok(result) => break result,
        Err(RecvTimeoutError::Timeout) => {}
        Err(RecvTimeoutError::Disconnected) => {
          break OpResult::Failed("browser owner thread stopped".to_string());
        }
      }
    };
    self.busy.store(false, Ordering::SeqCst);
    if cancel.load(Ordering::SeqCst) {
      OpResult::Cancelled
    } else {
      outcome
    }
  }
}

impl Drop for BrowserWorker {
  fn drop(&mut self) {
    self.stop();
  }
}

async fn pending_navigation(page: &mut Page, policy: &OriginPolicy) -> Result<(), String> {
  if let Some((url, method, body)) = page.take_pending_navigation() {
    policy.require(&url)?;
    page
      .navigate_from_document(&url, &method, &body)
      .await
      .map_err(|_| "browser page navigation failed".to_string())?;
  }
  Ok(())
}

async fn dispatch(
  page: &mut Page,
  command: BrowserCommand,
  policy: &OriginPolicy,
  options: &BrowserOptions,
) -> Result<Value, String> {
  match command {
    BrowserCommand::Navigate { url, wait_until } => {
      let wait = match wait_until {
        NavigationWait::Load => WaitUntil::Load,
        NavigationWait::Domcontentloaded => WaitUntil::DomContentLoaded,
        NavigationWait::Networkidle => WaitUntil::NetworkIdle0,
      };
      page
        .navigate_with_wait(&url, wait)
        .await
        .map_err(|_| "browser navigation failed or was denied".to_string())?;
      policy.require(&page.url_string())?;
      Ok(json!({ "url": page.url_string(), "title": page.title }))
    }
    BrowserCommand::Snapshot => {
      let dom = page
        .dom()
        .ok_or_else(|| "browser has no navigated document".to_string())?;
      let body = dom
        .query_selector("body")
        .map_err(|_| "cannot select browser body".to_string())?
        .unwrap_or_else(|| dom.document());
      Ok(json!({ "url": page.url_string(), "title": page.title, "text": dom.text_content(body) }))
    }
    BrowserCommand::Content => {
      let dom = page
        .dom()
        .ok_or_else(|| "browser has no navigated document".to_string())?;
      Ok(json!(dom.outer_html(dom.document())))
    }
    BrowserCommand::Extract { selector } => {
      let dom = page
        .dom()
        .ok_or_else(|| "browser has no navigated document".to_string())?;
      let ids = dom
        .query_selector_all(&selector)
        .map_err(|_| "invalid browser CSS selector".to_string())?;
      if ids.len() > 10_000 {
        return Err("browser extraction exceeds 10000 elements".to_string());
      }
      Ok(json!(
        ids
          .into_iter()
          .map(|id| dom.text_content(id))
          .collect::<Vec<_>>()
      ))
    }
    BrowserCommand::Screenshot => {
      page
        .prepare_screenshot_resources(options.timeout_ms.min(1000))
        .await;
      let bytes = page
        .screenshot((options.width as f32, options.height as f32))
        .ok_or_else(|| "browser screenshot requires a navigated document".to_string())?;
      if bytes.len() > options.max_result_bytes / 4 * 3 {
        return Err("browser PNG exceeds the result budget".to_string());
      }
      Ok(
        json!({ "mimeType": "image/png", "data": STANDARD.encode(bytes), "width": options.width, "height": options.height }),
      )
    }
    BrowserCommand::Evaluate { expression } => {
      if !page.has_js() {
        return Err("browser evaluation requires a navigated document".to_string());
      }
      let watchdog = page
        .js
        .as_mut()
        .map(|js| js.arm_watchdog(Duration::from_millis(options.timeout_ms)));
      let evaluated = page
        .evaluate_for_cdp_with_timeout(&expression, true, true, options.timeout_ms)
        .await;
      let overrun = match (page.js.as_mut(), watchdog) {
        (Some(js), Some(token)) => js.disarm_watchdog(token),
        _ => false,
      };
      if overrun {
        return Err("browser evaluation deadline exceeded".to_string());
      }
      let evaluated =
        evaluated.map_err(|_| "browser evaluation failed or timed out".to_string())?;
      if evaluated.thrown {
        return Err("browser JavaScript threw or rejected".to_string());
      }
      pending_navigation(page, policy).await?;
      Ok(evaluated.value.unwrap_or(Value::Null))
    }
    BrowserCommand::SetCookie { url, cookie } => {
      let url = Url::parse(&url).map_err(|_| "invalid cookie origin".to_string())?;
      page.context.cookie_jar.set_cookie(&cookie, &url);
      Ok(Value::Null)
    }
    BrowserCommand::Cookies { url } => {
      let url = Url::parse(&url).map_err(|_| "invalid cookie origin".to_string())?;
      Ok(json!(page.context.cookie_jar.get_cookie_header(&url)))
    }
    BrowserCommand::ClearCookies => {
      page.context.cookie_jar.clear();
      Ok(Value::Null)
    }
  }
}

fn run_browser(
  receiver: Receiver<Message>,
  options: BrowserOptions,
  policy: OriginPolicy,
  closed: &AtomicBool,
  active_cancel: &Mutex<Option<Arc<AtomicBool>>>,
  interrupt: &Mutex<Option<Interrupt>>,
  ready: SyncSender<Result<(), ()>>,
) {
  let Ok(local) = tokio::runtime::Builder::new_current_thread()
    .enable_all()
    .build()
  else {
    let _ = ready.send(Err(()));
    return;
  };
  // No profile directory, disk cookies, global auth import or privileged page bindings.
  let mut context = BrowserContext::with_storage_and_network(
    "runtime-browser".to_string(),
    None,
    false,
    None,
    None,
    options.allow_private_network,
  );
  if let Some(client) = Arc::get_mut(&mut context.http_client) {
    client.honor_private_network_environment = false;
  } else {
    let _ = ready.send(Err(()));
    return;
  }
  local.block_on(async {
    *context.http_client.interceptor.write().await = Some(Box::new(policy.clone()));
  });
  let mut page = Page::new("runtime-page".to_string(), Arc::new(context));
  page.set_viewport((options.width as f32, options.height as f32));
  page.set_navigation_timeout(Duration::from_millis(options.timeout_ms));
  let _ = ready.send(Ok(()));
  while !closed.load(Ordering::SeqCst) {
    match receiver.recv_timeout(POLL) {
      Ok(Message::Stop) | Err(RecvTimeoutError::Disconnected) => break,
      Err(RecvTimeoutError::Timeout) => {
        if page.has_js() {
          *lock(interrupt) = page.isolate_handle().map(|handle| {
            Box::new(move || {
              handle.terminate_execution();
            }) as Interrupt
          });
          let watchdog = page
            .js
            .as_mut()
            .map(|js| js.arm_watchdog(Duration::from_millis(options.timeout_ms)));
          local.block_on(async {
            let _ = tokio::time::timeout(POLL, page.run_autonomous_event_loop_turn()).await;
            let _ = pending_navigation(&mut page, &policy).await;
          });
          if let (Some(js), Some(token)) = (page.js.as_mut(), watchdog) {
            js.disarm_watchdog(token);
          }
          *lock(interrupt) = page.isolate_handle().map(|handle| {
            Box::new(move || {
              handle.terminate_execution();
            }) as Interrupt
          });
        }
      }
      Ok(Message::Task(task)) => {
        *lock(active_cancel) = Some(Arc::clone(&task.cancel));
        *lock(interrupt) = page.isolate_handle().map(|handle| {
          Box::new(move || {
            handle.terminate_execution();
          }) as Interrupt
        });
        page.cancel_v8_termination();
        let result = if task.cancel.load(Ordering::SeqCst) {
          OpResult::Cancelled
        } else {
          local.block_on(async {
            let work = dispatch(&mut page, task.command, &policy, &options);
            tokio::pin!(work);
            let deadline = Instant::now() + Duration::from_millis(options.timeout_ms);
            loop {
              tokio::select! {
                result = &mut work => {
                  break match result {
                    Ok(value) => match serde_json::to_string(&value) {
                      Ok(json) if json.len() <= options.max_result_bytes => OpResult::Done(json),
                      _ => OpResult::Failed("browser result exceeds its byte budget".to_string()),
                    },
                    Err(message) => OpResult::Failed(message),
                  };
                }
                () = tokio::time::sleep(POLL) => {
                  if task.cancel.load(Ordering::SeqCst) || closed.load(Ordering::SeqCst) { break OpResult::Cancelled; }
                  if Instant::now() >= deadline { break OpResult::Failed("browser command deadline exceeded".to_string()); }
                }
              }
            }
          })
        };
        *lock(interrupt) = page.isolate_handle().map(|handle| {
          Box::new(move || {
            handle.terminate_execution();
          }) as Interrupt
        });
        *lock(active_cancel) = None;
        page.cancel_v8_termination();
        let _ = task.result.send(result);
      }
    }
  }
  // Drop the page/isolate here, before its Tokio runtime and before the owner thread joins.
  drop(page);
}

unsafe fn parse_input<T: serde::de::DeserializeOwned>(
  input: *const u8,
  len: usize,
) -> Result<T, YoloStatus> {
  if input.is_null() || len == 0 || len > MAX_INPUT_BYTES {
    return Err(set_error(
      YoloStatus::InvalidArgument,
      "browser JSON input must contain 1..64 KiB",
    ));
  }
  // SAFETY: the caller guarantees input points to len readable bytes for this call.
  let bytes = unsafe { std::slice::from_raw_parts(input, len) };
  serde_json::from_slice(bytes)
    .map_err(|_| set_error(YoloStatus::InvalidArgument, "invalid browser JSON contract"))
}

/// Create an isolated browser context owned by runtime. Its permissions cannot be expanded.
/// # Safety
/// input must point to len readable UTF-8 JSON bytes and out must point to writable handle storage.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_browser_create(
  runtime: YoloHandle,
  input: *const u8,
  len: usize,
  out: *mut YoloHandle,
) -> YoloStatus {
  guard(|| {
    if out.is_null() {
      return set_error(YoloStatus::InvalidArgument, "null browser output handle");
    }
    let options: BrowserOptions = match unsafe { parse_input(input, len) } {
      Ok(value) => value,
      Err(status) => return status,
    };
    let policy = match OriginPolicy::new(&options) {
      Ok(value) => value,
      Err(message) => return set_error(YoloStatus::InvalidArgument, message),
    };
    // Linearize the resource check, non-I/O context initialization and insertion against destroy.
    // Startup creates no V8 isolate and never acquires this lock. Holding the slot limit here
    // prevents concurrent callers from spawning unregistered owner threads beyond that limit.
    let mut reg = lock(registry());
    let limit = match runtime_limit(&reg, runtime) {
      Ok(limit) => limit,
      Err(status) => return status,
    };
    if reg.operations_of(runtime).len() as u32 >= limit {
      return set_error(YoloStatus::Busy, "runtime browser resource limit reached");
    }
    let worker = match BrowserWorker::start(runtime, options, policy) {
      Ok(worker) => worker,
      Err(status) => return status,
    };
    let handle = reg.insert(Entry::Browser {
      owner: runtime,
      state: worker,
    });
    // SAFETY: out is non-null and writable by the caller's contract.
    unsafe { out.write(handle) };
    YoloStatus::Ok
  })
}

/// Start one bounded browser operation. A busy context is rejected instead of queuing work.
/// # Safety
/// input must point to len readable UTF-8 JSON bytes and out must point to writable handle storage.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn yolo_browser_call_start(
  browser: YoloHandle,
  input: *const u8,
  len: usize,
  out: *mut YoloHandle,
) -> YoloStatus {
  guard(|| {
    if out.is_null() {
      return set_error(
        YoloStatus::InvalidArgument,
        "null browser operation output handle",
      );
    }
    let command: BrowserCommand = match unsafe { parse_input(input, len) } {
      Ok(value) => value,
      Err(status) => return status,
    };
    let state = match lock(registry()).get(browser) {
      Some(Entry::Browser { state, .. }) if !state.closed.load(Ordering::SeqCst) => {
        Arc::clone(state)
      }
      _ => return set_error(YoloStatus::InvalidHandle, "invalid browser context handle"),
    };
    if let Err(message) = command.validate(&state.policy) {
      return set_error(YoloStatus::InvalidArgument, message);
    }
    if state
      .busy
      .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
      .is_err()
    {
      return set_error(
        YoloStatus::Busy,
        "browser context already has an active operation",
      );
    }
    let worker = Arc::clone(&state);
    match start_operation(state.owner, "browser", true, move |cancel| {
      worker.execute(command, cancel)
    }) {
      Ok(operation) => {
        unsafe { out.write(operation) };
        YoloStatus::Ok
      }
      Err(status) => {
        state.busy.store(false, Ordering::SeqCst);
        status
      }
    }
  })
}

/// Close the context, cancel current work and join its V8 owner thread before returning.
#[unsafe(no_mangle)]
pub extern "C" fn yolo_browser_close(browser: YoloHandle) -> YoloStatus {
  guard(|| {
    let entry = {
      let mut reg = lock(registry());
      if !matches!(reg.get(browser), Some(Entry::Browser { .. })) {
        return set_error(YoloStatus::InvalidHandle, "invalid browser context handle");
      }
      reg.remove(browser)
    };
    if let Some(Entry::Browser { state, .. }) = entry {
      state.stop();
    }
    YoloStatus::Ok
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  const CONTEXT_JSON: &[u8] = br#"{"allowedOrigins":["https://example.test"]}"#;
  const SNAPSHOT_JSON: &[u8] = br#"{"method":"snapshot"}"#;

  struct OwnedRuntime(YoloHandle);

  impl OwnedRuntime {
    fn new(limit: u32) -> Self {
      let info = YoloCreateInfo {
        struct_size: size_of::<YoloCreateInfo>() as u32,
        abi_major: ABI_MAJOR,
        abi_minor: ABI_MINOR,
        max_operations: limit,
      };
      let mut handle = 0;
      // SAFETY: info and handle are live, correctly sized stack objects.
      assert_eq!(
        unsafe { yolo_runtime_create(&info, &mut handle) },
        YoloStatus::Ok
      );
      Self(handle)
    }
  }

  impl Drop for OwnedRuntime {
    fn drop(&mut self) {
      let _ = yolo_runtime_destroy(self.0);
    }
  }

  fn create_context(runtime: YoloHandle) -> (YoloStatus, YoloHandle) {
    let mut handle = 0;
    // SAFETY: the input slice and output handle remain live throughout the call.
    let status = unsafe {
      yolo_browser_create(
        runtime,
        CONTEXT_JSON.as_ptr(),
        CONTEXT_JSON.len(),
        &mut handle,
      )
    };
    (status, handle)
  }

  fn snapshot_start(context: YoloHandle) -> (YoloStatus, YoloHandle) {
    let mut operation = 0;
    // SAFETY: the input slice and output handle remain live throughout the call.
    let status = unsafe {
      yolo_browser_call_start(
        context,
        SNAPSHOT_JSON.as_ptr(),
        SNAPSHOT_JSON.len(),
        &mut operation,
      )
    };
    (status, operation)
  }

  #[test]
  fn browser_abi_rejects_null_oversized_and_invalid_contract_inputs() {
    let runtime = OwnedRuntime::new(2);
    let mut handle = 0;
    let oversized = vec![b' '; MAX_INPUT_BYTES + 1];
    // SAFETY: null input is rejected before reads; otherwise pointers target live storage.
    unsafe {
      assert_eq!(
        yolo_browser_create(runtime.0, ptr::null(), 1, &mut handle),
        YoloStatus::InvalidArgument
      );
      assert_eq!(
        yolo_browser_create(runtime.0, CONTEXT_JSON.as_ptr(), 0, &mut handle),
        YoloStatus::InvalidArgument
      );
      assert_eq!(
        yolo_browser_create(runtime.0, oversized.as_ptr(), oversized.len(), &mut handle,),
        YoloStatus::InvalidArgument
      );
      assert_eq!(
        yolo_browser_create(
          runtime.0,
          CONTEXT_JSON.as_ptr(),
          CONTEXT_JSON.len(),
          ptr::null_mut(),
        ),
        YoloStatus::InvalidArgument
      );
      for input in [
        b"{".as_slice(),
        br#"{"allowedOrigins":["*"]}"#.as_slice(),
        br#"{"allowedOrigins":["https://example.test"],"hostAccess":true}"#.as_slice(),
      ] {
        assert_eq!(
          yolo_browser_create(runtime.0, input.as_ptr(), input.len(), &mut handle),
          YoloStatus::InvalidArgument
        );
      }
      assert_eq!(
        yolo_browser_call_start(0, ptr::null(), 1, &mut handle),
        YoloStatus::InvalidArgument
      );
      assert_eq!(
        yolo_browser_call_start(
          0,
          SNAPSHOT_JSON.as_ptr(),
          SNAPSHOT_JSON.len(),
          ptr::null_mut()
        ),
        YoloStatus::InvalidArgument
      );
    }
    assert_eq!(handle, 0);
    assert!(lock(registry()).operations_of(runtime.0).is_empty());
  }

  #[test]
  fn browser_context_close_releases_capacity_and_invalidates_its_generation() {
    let runtime = OwnedRuntime::new(1);
    let (status, first) = create_context(runtime.0);
    assert_eq!(status, YoloStatus::Ok);
    assert_eq!(create_context(runtime.0), (YoloStatus::Busy, 0));
    assert_eq!(yolo_browser_close(first), YoloStatus::Ok);
    assert_eq!(snapshot_start(first), (YoloStatus::InvalidHandle, 0));
    let (status, replacement) = create_context(runtime.0);
    assert_eq!(status, YoloStatus::Ok);
    assert_ne!(first, replacement);
    assert_eq!(yolo_browser_close(first), YoloStatus::InvalidHandle);
    assert_eq!(yolo_browser_close(replacement), YoloStatus::Ok);
  }

  #[test]
  fn browser_runtime_destroy_joins_context_and_operation_owners() {
    let runtime = OwnedRuntime::new(2);
    let (status, context) = create_context(runtime.0);
    assert_eq!(status, YoloStatus::Ok);
    let (status, operation) = snapshot_start(context);
    assert_eq!(status, YoloStatus::Ok);
    assert_eq!(yolo_runtime_destroy(runtime.0), YoloStatus::Ok);
    assert_eq!(yolo_browser_close(context), YoloStatus::InvalidHandle);
    assert_eq!(snapshot_start(context), (YoloStatus::InvalidHandle, 0));
    assert_eq!(create_context(runtime.0), (YoloStatus::InvalidHandle, 0));
    assert_eq!(yolo_operation_cancel(operation), YoloStatus::InvalidHandle);
  }

  #[test]
  fn browser_concurrent_creation_cannot_exceed_the_runtime_resource_limit() {
    let runtime = OwnedRuntime::new(1);
    let barrier = Arc::new(std::sync::Barrier::new(17));
    let callers: Vec<_> = (0..16)
      .map(|_| {
        let barrier = Arc::clone(&barrier);
        let owner = runtime.0;
        std::thread::spawn(move || {
          barrier.wait();
          create_context(owner)
        })
      })
      .collect();
    barrier.wait();
    let results: Vec<_> = callers
      .into_iter()
      .map(|caller| caller.join().unwrap())
      .collect();
    assert_eq!(
      results
        .iter()
        .filter(|(status, _)| *status == YoloStatus::Ok)
        .count(),
      1
    );
    assert_eq!(
      results
        .iter()
        .filter(|(status, handle)| *status == YoloStatus::Busy && *handle == 0)
        .count(),
      15
    );
    assert_eq!(lock(registry()).operations_of(runtime.0).len(), 1);
  }

  #[test]
  fn browser_create_and_runtime_destroy_have_one_registry_order() {
    for _ in 0..8 {
      let runtime = OwnedRuntime::new(1);
      let owner = runtime.0;
      let barrier = Arc::new(std::sync::Barrier::new(2));
      let caller_barrier = Arc::clone(&barrier);
      let caller = std::thread::spawn(move || {
        caller_barrier.wait();
        create_context(owner)
      });
      barrier.wait();
      assert_eq!(yolo_runtime_destroy(owner), YoloStatus::Ok);
      let (status, context) = caller.join().unwrap();
      assert!(matches!(status, YoloStatus::Ok | YoloStatus::InvalidHandle));
      if status == YoloStatus::Ok {
        assert_eq!(yolo_browser_close(context), YoloStatus::InvalidHandle);
      } else {
        assert_eq!(context, 0);
      }
      assert!(lock(registry()).operations_of(owner).is_empty());
    }
  }

  fn options() -> BrowserOptions {
    serde_json::from_value(json!({ "allowedOrigins": ["https://example.test"] })).unwrap()
  }

  #[test]
  fn origin_policy_never_accepts_scheme_credentials_path_or_wildcard_expansion() {
    let policy = OriginPolicy::new(&options()).unwrap();
    assert!(policy.permits("https://example.test/path?q=1"));
    for value in [
      "http://example.test",
      "https://sub.example.test",
      "https://example.test:444",
      "file:///etc/passwd",
      "data:text/html,hi",
      "https://user:secret@example.test",
    ] {
      assert!(!policy.permits(value));
    }
    for value in [
      "https://example.test/path",
      "https://example.test?token=private",
      "https://*.example.test",
      "*",
    ] {
      let mut options = options();
      options.allowed_origins = vec![value.to_string()];
      assert!(OriginPolicy::new(&options).is_err());
    }
  }

  #[test]
  fn browser_contract_rejects_extra_permissions_and_unbounded_dimensions() {
    assert!(
      serde_json::from_value::<BrowserOptions>(
        json!({ "allowedOrigins": ["https://example.test"], "storageDir": "/private" })
      )
      .is_err()
    );
    assert!(
      serde_json::from_value::<BrowserCommand>(
        json!({ "method": "evaluate", "expression": "1", "hostAccess": true })
      )
      .is_err()
    );
    let mut options = options();
    options.width = 4097;
    assert!(OriginPolicy::new(&options).is_err());
    options.width = 1024;
    options.timeout_ms = 0;
    assert!(OriginPolicy::new(&options).is_err());
  }

  #[test]
  fn cookie_and_navigation_commands_cannot_cross_the_context_origin() {
    let policy = OriginPolicy::new(&options()).unwrap();
    let command: BrowserCommand = serde_json::from_value(
      json!({ "method": "setCookie", "url": "https://elsewhere.test", "cookie": "fixture=1" }),
    )
    .unwrap();
    assert!(command.validate(&policy).is_err());
    let command: BrowserCommand = serde_json::from_value(
      json!({ "method": "navigate", "url": "https://example.test", "waitUntil": "load" }),
    )
    .unwrap();
    assert!(command.validate(&policy).is_ok());
  }
}
