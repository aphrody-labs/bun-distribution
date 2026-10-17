// SPDX-License-Identifier: Apache-2.0
//! Windows scheduled tasks without PowerShell.
//!
//! Task Scheduler 2.0 XML definitions are built, read and patched here in plain Rust (unit-tested on
//! every platform); on Windows they are registered, read and started through the COM `ITaskService`.
//!
//! Window policy (the same rules `aphrody infra boot` audits): every task is `Settings.Hidden`; SYSTEM
//! (session 0) and S4U principals have no window station, so no console can appear; a task that
//! needs the interactive desktop runs `InteractiveToken` with its program wrapped in
//! `conhost.exe --headless`, so its console is never created on screen.

use std::fmt::Write as _;

/// Who runs the task.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Principal {
    /// LocalSystem, session 0.
    System,
    /// The registering user, whether logged on or not, without a window station.
    S4U,
    /// The registering user's interactive desktop session (capture, tray).
    Interactive,
}

impl Principal {
    /// Logon-type label, as reported by [`observe`] (the Task Scheduler `LogonType` names).
    #[must_use]
    pub const fn logon_label(self) -> &'static str {
        match self {
            Self::System => "ServiceAccount",
            Self::S4U => "S4U",
            Self::Interactive => "Interactive",
        }
    }
}

/// When the task starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    /// `atStartup`.
    Boot,
    /// `atLogon` (the registering user's logon, any logon for SYSTEM tasks).
    Logon,
    /// `every:<N>m`: from midnight today, every N minutes, indefinitely.
    Every { minutes: u32 },
    /// `daily@HH:MM`: every day at local time HH:MM.
    Daily { hour: u8, minute: u8 },
}

impl Trigger {
    /// Parses the catalog vocabulary (`atStartup`, `atLogon`, `every:30m`, `daily@06:00`).
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "atStartup" => return Some(Self::Boot),
            "atLogon" => return Some(Self::Logon),
            _ => {}
        }
        if let Some(rest) = text.strip_prefix("every:") {
            let minutes: u32 = rest.strip_suffix('m')?.parse().ok()?;
            return (1..=31 * 24 * 60)
                .contains(&minutes)
                .then_some(Self::Every { minutes });
        }
        let (hour, minute) = text.strip_prefix("daily@")?.split_once(':')?;
        let (hour, minute): (u8, u8) = (hour.parse().ok()?, minute.parse().ok()?);
        (hour < 24 && minute < 60).then_some(Self::Daily { hour, minute })
    }

    /// The catalog label of this trigger.
    #[must_use]
    pub fn label(self) -> String {
        match self {
            Self::Boot => "atStartup".to_owned(),
            Self::Logon => "atLogon".to_owned(),
            Self::Every { minutes } => format!("every:{minutes}m"),
            Self::Daily { hour, minute } => format!("daily@{hour:02}:{minute:02}"),
        }
    }

    fn xml(self, user: Option<&str>, today: &str) -> String {
        match self {
            Self::Boot => "<BootTrigger><Enabled>true</Enabled></BootTrigger>".to_owned(),
            Self::Logon => match user {
                Some(user) => format!(
                    "<LogonTrigger><Enabled>true</Enabled><UserId>{}</UserId></LogonTrigger>",
                    escape(user)
                ),
                None => "<LogonTrigger><Enabled>true</Enabled></LogonTrigger>".to_owned(),
            },
            Self::Every { minutes } => format!(
                "<TimeTrigger><Repetition><Interval>PT{minutes}M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>{today}T00:00:00</StartBoundary><Enabled>true</Enabled></TimeTrigger>"
            ),
            Self::Daily { hour, minute } => format!(
                "<CalendarTrigger><StartBoundary>{today}T{hour:02}:{minute:02}:00</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>"
            ),
        }
    }
}

/// The program a task runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Action {
    pub command: String,
    pub arguments: Option<String>,
    pub working_directory: Option<String>,
}

impl Action {
    /// True when the program runs inside `conhost.exe --headless`.
    #[must_use]
    pub fn is_headless(&self) -> bool {
        self.command.to_ascii_lowercase().ends_with("conhost.exe")
            && self
                .arguments
                .as_deref()
                .is_some_and(|a| a.trim_start().starts_with("--headless"))
    }

    /// Wraps the program in `conhost.exe --headless` (idempotent).
    #[must_use]
    pub fn headless(self, system_root: &str) -> Self {
        if self.is_headless() {
            return self;
        }
        let inner = format!("\"{}\"", self.command.trim_matches('"'));
        let arguments = match self.arguments.as_deref().filter(|a| !a.is_empty()) {
            Some(args) => format!("--headless {inner} {args}"),
            None => format!("--headless {inner}"),
        };
        Self {
            command: format!(
                "{}\\System32\\conhost.exe",
                system_root.trim_end_matches('\\')
            ),
            arguments: Some(arguments),
            working_directory: self.working_directory,
        }
    }

    /// The program inside a `conhost.exe --headless` wrapper (the action itself otherwise).
    #[must_use]
    pub fn unwrapped(&self) -> Self {
        if !self.is_headless() {
            return self.clone();
        }
        let rest = self.arguments.as_deref().unwrap_or_default().trim_start();
        let rest = rest.strip_prefix("--headless").unwrap_or(rest).trim_start();
        let (command, arguments) = if let Some(quoted) = rest.strip_prefix('"') {
            match quoted.split_once('"') {
                Some((command, args)) => (command.to_owned(), args.trim_start().to_owned()),
                None => (quoted.to_owned(), String::new()),
            }
        } else {
            match rest.split_once(' ') {
                Some((command, args)) => (command.to_owned(), args.trim_start().to_owned()),
                None => (rest.to_owned(), String::new()),
            }
        };
        Self {
            command,
            arguments: (!arguments.is_empty()).then_some(arguments),
            working_directory: self.working_directory.clone(),
        }
    }

    /// Same program and arguments: command paths compare case-insensitively, and by file name when
    /// one side is a bare name resolved through `PATH`.
    #[must_use]
    pub fn same_program(&self, other: &Self) -> bool {
        let (a, b) = (self.unwrapped(), other.unwrapped());
        let (ca, cb) = (a.command.trim_matches('"'), b.command.trim_matches('"'));
        let file = |c: &str| {
            c.rsplit(['\\', '/'])
                .next()
                .unwrap_or(c)
                .to_ascii_lowercase()
        };
        let bare = |c: &str| !c.contains(['\\', '/']);
        let same_command =
            ca.eq_ignore_ascii_case(cb) || ((bare(ca) || bare(cb)) && file(ca) == file(cb));
        same_command
            && a.arguments.as_deref().unwrap_or_default().trim()
                == b.arguments.as_deref().unwrap_or_default().trim()
    }

    fn xml(&self) -> String {
        let mut out = format!("<Exec><Command>{}</Command>", escape(&self.command));
        if let Some(args) = self.arguments.as_deref().filter(|a| !a.is_empty()) {
            let _ = write!(out, "<Arguments>{}</Arguments>", escape(args));
        }
        if let Some(dir) = self.working_directory.as_deref().filter(|d| !d.is_empty()) {
            let _ = write!(out, "<WorkingDirectory>{}</WorkingDirectory>", escape(dir));
        }
        out.push_str("</Exec>");
        out
    }
}

/// Settings a long-running or scheduled task always receives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Settings {
    /// Restart every minute after a failure, 999 times (long-running tasks).
    pub restart: bool,
    /// Execution time limit in minutes; `None` runs without limit.
    pub time_limit_minutes: Option<u32>,
}

/// A complete task declaration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskSpec {
    /// Folder, with leading and trailing backslash (`\Aphrody\`).
    pub path: String,
    pub name: String,
    pub description: Option<String>,
    /// Already wrapped in `conhost --headless` for interactive tasks.
    pub action: Action,
    pub principal: Principal,
    /// `HighestAvailable` instead of `LeastPrivilege` (SYSTEM always runs highest).
    pub highest: bool,
    pub triggers: Vec<Trigger>,
    pub settings: Settings,
}

impl TaskSpec {
    /// `\Folder\Name`.
    #[must_use]
    pub fn full_path(&self) -> String {
        full_path(&self.path, &self.name)
    }
}

/// `\Folder\Name` from a folder (`\Aphrody\`, `\`) and a task name.
#[must_use]
pub fn full_path(folder: &str, name: &str) -> String {
    let folder = folder.trim_matches('\\');
    if folder.is_empty() {
        format!("\\{name}")
    } else {
        format!("\\{folder}\\{name}")
    }
}

/// What an existing task looks like, from its XML (state and enablement come from the service).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Observation {
    pub hidden: bool,
    /// `ServiceAccount`, `S4U`, `Interactive`, `Password`, `Group`, `InteractiveOrPassword`.
    pub logon: String,
    pub action: Option<Action>,
    pub restart_count: u32,
    /// Catalog labels (`atStartup`, `atLogon`, `every:30m`, `daily@06:00`), element names otherwise.
    pub triggers: Vec<String>,
}

const SYSTEM_SIDS: [&str; 6] = [
    "S-1-5-18",
    "SYSTEM",
    "NT AUTHORITY\\SYSTEM",
    "LOCALSYSTEM",
    "S-1-5-19",
    "S-1-5-20",
];

/// Reads the audited fields of a task definition.
#[must_use]
pub fn observe(xml: &str) -> Observation {
    let settings = block(xml, "Settings").unwrap_or_default();
    let principal = block(xml, "Principal").unwrap_or_default();
    let user = text(principal, "UserId").unwrap_or_default();
    let logon = if SYSTEM_SIDS
        .iter()
        .any(|s| s.eq_ignore_ascii_case(user.trim()))
    {
        "ServiceAccount".to_owned()
    } else {
        match text(principal, "LogonType").as_deref() {
            Some("InteractiveToken") | None => "Interactive".to_owned(),
            Some("InteractiveTokenOrPassword") => "InteractiveOrPassword".to_owned(),
            Some(other) => other.to_owned(),
        }
    };
    let restart_count = block(settings, "RestartOnFailure")
        .and_then(|r| text(r, "Count"))
        .and_then(|c| c.trim().parse().ok())
        .unwrap_or(0);
    let action = block(xml, "Exec").map(|exec| Action {
        command: text(exec, "Command").unwrap_or_default(),
        arguments: text(exec, "Arguments"),
        working_directory: text(exec, "WorkingDirectory"),
    });
    let triggers = children(block(xml, "Triggers").unwrap_or_default())
        .into_iter()
        .map(|(name, inner)| trigger_label(name, inner))
        .collect();
    Observation {
        hidden: text(settings, "Hidden").is_some_and(|h| h.trim() == "true"),
        logon,
        action,
        restart_count,
        triggers,
    }
}

fn trigger_label(name: &str, inner: &str) -> String {
    match name {
        "BootTrigger" => "atStartup".to_owned(),
        "LogonTrigger" => "atLogon".to_owned(),
        "TimeTrigger" => block(inner, "Repetition")
            .and_then(|r| text(r, "Interval"))
            .and_then(|i| iso_minutes(&i))
            .map_or_else(|| name.to_owned(), |minutes| format!("every:{minutes}m")),
        "CalendarTrigger" if block(inner, "ScheduleByDay").is_some() => {
            text(inner, "StartBoundary")
                .and_then(|start| {
                    let time = start.split_once('T')?.1;
                    Some(format!("daily@{}", time.get(..5)?))
                })
                .unwrap_or_else(|| name.to_owned())
        }
        other => other.to_owned(),
    }
}

/// Minutes of an ISO-8601 duration made of hours and minutes (`PT1H30M`).
fn iso_minutes(duration: &str) -> Option<u32> {
    let rest = duration.trim().strip_prefix("PT")?;
    let (mut total, mut number) = (0u32, String::new());
    for ch in rest.chars() {
        match ch {
            '0'..='9' => number.push(ch),
            'H' => total += number.drain(..).as_str().parse::<u32>().ok()? * 60,
            'M' => total += number.drain(..).as_str().parse::<u32>().ok()?,
            _ => return None,
        }
    }
    (number.is_empty() && total > 0).then_some(total)
}

fn principal_xml(principal: Principal, highest: bool, user: &str) -> String {
    let level = if highest || principal == Principal::System {
        "HighestAvailable"
    } else {
        "LeastPrivilege"
    };
    match principal {
        Principal::System => {
            format!(
                "<Principals><Principal id=\"Author\"><UserId>S-1-5-18</UserId><RunLevel>{level}</RunLevel></Principal></Principals>"
            )
        }
        Principal::S4U | Principal::Interactive => format!(
            "<Principals><Principal id=\"Author\"><UserId>{}</UserId><LogonType>{}</LogonType><RunLevel>{level}</RunLevel></Principal></Principals>",
            escape(user),
            if principal == Principal::S4U {
                "S4U"
            } else {
                "InteractiveToken"
            }
        ),
    }
}

fn time_limit(minutes: Option<u32>) -> String {
    minutes.map_or_else(|| "PT0S".to_owned(), |m| format!("PT{m}M"))
}

/// The full Task Scheduler XML of a declaration; `user` is `DOMAIN\name` of the registering user and
/// `today` the local date (`YYYY-MM-DD`) anchoring time-based triggers.
#[must_use]
pub fn task_xml(spec: &TaskSpec, user: &str, today: &str) -> String {
    let logon_user = (spec.principal != Principal::System).then_some(user);
    let mut triggers = String::new();
    for trigger in &spec.triggers {
        triggers.push_str(&trigger.xml(logon_user, today));
    }
    let restart = if spec.settings.restart {
        "<RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>"
    } else {
        ""
    };
    let description = spec.description.as_deref().map_or(String::new(), |d| {
        format!("<Description>{}</Description>", escape(d))
    });
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-16\"?>\n<Task version=\"1.3\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">\
<RegistrationInfo>{description}</RegistrationInfo>\
{principal}\
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><Enabled>true</Enabled><Hidden>true</Hidden><ExecutionTimeLimit>{limit}</ExecutionTimeLimit>{restart}</Settings>\
<Triggers>{triggers}</Triggers>\
<Actions Context=\"Author\">{action}</Actions></Task>",
        principal = principal_xml(spec.principal, spec.highest, user),
        limit = time_limit(spec.settings.time_limit_minutes),
        action = spec.action.xml(),
    )
}

/// Corrections applied to an existing task definition; everything else is preserved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Patch {
    pub principal: Principal,
    pub highest: bool,
    /// Replace the long-running settings (`None` keeps the scheduled task's own settings).
    pub settings: Option<Settings>,
    /// Triggers added when absent.
    pub add_triggers: Vec<Trigger>,
    /// Replacement action (declared program, or the existing one wrapped headless).
    pub action: Option<Action>,
}

/// Applies `patch` to an existing definition: Hidden and Enabled set, principal replaced, optional
/// settings, missing triggers appended, optional action replaced.
#[must_use]
pub fn patch_xml(existing: &str, patch: &Patch, user: &str, today: &str) -> String {
    let mut xml = replace_block(
        existing,
        "Principals",
        &principal_xml(patch.principal, patch.highest, user),
    );
    let mut settings = block(&xml, "Settings").unwrap_or_default().to_owned();
    set_child(&mut settings, "Hidden", "true");
    set_child(&mut settings, "Enabled", "true");
    if let Some(wanted) = patch.settings {
        set_child(&mut settings, "MultipleInstancesPolicy", "IgnoreNew");
        set_child(&mut settings, "DisallowStartIfOnBatteries", "false");
        set_child(&mut settings, "StopIfGoingOnBatteries", "false");
        set_child(&mut settings, "StartWhenAvailable", "true");
        set_child(
            &mut settings,
            "ExecutionTimeLimit",
            &time_limit(wanted.time_limit_minutes),
        );
        remove_child(&mut settings, "RestartOnFailure");
        if wanted.restart {
            settings.push_str(
                "<RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>",
            );
        }
    }
    xml = replace_block(
        &xml,
        "Settings",
        &format!("<Settings>{settings}</Settings>"),
    );
    let present = observe(&xml).triggers;
    let logon_user = (patch.principal != Principal::System).then_some(user);
    let missing: String = patch
        .add_triggers
        .iter()
        .filter(|t| !present.contains(&t.label()))
        .map(|t| t.xml(logon_user, today))
        .collect();
    if !missing.is_empty() {
        let inner = format!("{}{missing}", block(&xml, "Triggers").unwrap_or_default());
        xml = replace_block(&xml, "Triggers", &format!("<Triggers>{inner}</Triggers>"));
    }
    if let Some(action) = &patch.action {
        xml = replace_block(
            &xml,
            "Actions",
            &format!("<Actions Context=\"Author\">{}</Actions>", action.xml()),
        );
    }
    xml
}

/// XML text escaping for element content.
#[must_use]
pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            other => out.push(other),
        }
    }
    out
}

fn unescape(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// Byte range of the first `<tag ...>...</tag>` (or self-closing `<tag/>`) element.
fn element(xml: &str, tag: &str) -> Option<(usize, usize, usize, usize)> {
    let open = format!("<{tag}");
    let mut from = 0;
    while let Some(found) = xml[from..].find(&open) {
        let start = from + found;
        let after = start + open.len();
        match xml[after..].chars().next() {
            Some('>' | ' ' | '/' | '\t' | '\r' | '\n') => {}
            _ => {
                from = after;
                continue;
            }
        }
        let close_of_open = after + xml[after..].find('>')?;
        if xml[..close_of_open].ends_with('/') {
            return Some((
                start,
                close_of_open + 1,
                close_of_open + 1,
                close_of_open + 1,
            ));
        }
        let close = format!("</{tag}>");
        let inner_start = close_of_open + 1;
        let inner_end = inner_start + xml[inner_start..].find(&close)?;
        return Some((start, inner_start, inner_end, inner_end + close.len()));
    }
    None
}

/// Inner content of the first `tag` element (empty for a self-closing element).
fn block<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    element(xml, tag).map(|(_, inner_start, inner_end, _)| &xml[inner_start..inner_end])
}

/// Unescaped text of the first `tag` element.
fn text(xml: &str, tag: &str) -> Option<String> {
    block(xml, tag).map(|inner| unescape(inner.trim()))
}

/// Replaces the first `tag` element, or inserts the replacement before `</Task>`.
fn replace_block(xml: &str, tag: &str, replacement: &str) -> String {
    match element(xml, tag) {
        Some((start, _, _, end)) => format!("{}{replacement}{}", &xml[..start], &xml[end..]),
        None => match xml.rfind("</Task>") {
            Some(at) => format!("{}{replacement}{}", &xml[..at], &xml[at..]),
            None => format!("{xml}{replacement}"),
        },
    }
}

/// Sets the value of a direct child element of `inner`, appending it when absent.
fn set_child(inner: &mut String, tag: &str, value: &str) {
    let replacement = format!("<{tag}>{value}</{tag}>");
    *inner = match top_level(inner, tag) {
        Some((start, end)) => format!("{}{replacement}{}", &inner[..start], &inner[end..]),
        None => format!("{inner}{replacement}"),
    };
}

fn remove_child(inner: &mut String, tag: &str) {
    if let Some((start, end)) = top_level(inner, tag) {
        inner.replace_range(start..end, "");
    }
}

/// Byte range of a direct child `tag` of `inner` (nested elements of the same name are skipped).
fn top_level(inner: &str, tag: &str) -> Option<(usize, usize)> {
    child_ranges(inner)
        .into_iter()
        .find(|(name, ..)| *name == tag)
        .map(|(_, _, start, end)| (start, end))
}

fn child_ranges(inner: &str) -> Vec<(&str, &str, usize, usize)> {
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(found) = inner[at..].find('<') {
        let start = at + found;
        let rest = &inner[start + 1..];
        if rest.starts_with('/') || rest.starts_with('!') || rest.starts_with('?') {
            match rest.find('>') {
                Some(end) => {
                    at = start + 1 + end + 1;
                    continue;
                }
                None => break,
            }
        }
        let name_len = rest
            .find(|c: char| c == '>' || c == '/' || c.is_whitespace())
            .unwrap_or(rest.len());
        let name = &rest[..name_len];
        match element(&inner[start..], name) {
            Some((_, inner_start, inner_end, end)) => {
                out.push((
                    name,
                    &inner[start + inner_start..start + inner_end],
                    start,
                    start + end,
                ));
                at = start + end;
            }
            None => break,
        }
    }
    out
}

/// Direct child elements `(name, inner)` of `inner`.
fn children(inner: &str) -> Vec<(&str, &str)> {
    child_ranges(inner)
        .into_iter()
        .map(|(name, body, _, _)| (name, body))
        .collect()
}

/// `DOMAIN\user` of the current process.
#[must_use]
pub fn current_user() -> String {
    let user = std::env::var("USERNAME").unwrap_or_default();
    match std::env::var("USERDOMAIN") {
        Ok(domain) if !domain.is_empty() => format!("{domain}\\{user}"),
        _ => user,
    }
}

/// Expands `%NAME%` references from the process environment (unknown names are kept).
#[must_use]
pub fn expand_env(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 && !after[..end].contains(char::is_whitespace) => {
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(value) => out.push_str(&value),
                    Err(_) => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Live state of a registered task.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Registered {
    /// `Running`, `Ready`, `Disabled`, `Queued` or `Unknown`.
    pub state: String,
    pub enabled: bool,
    pub xml: String,
}

#[cfg(windows)]
mod com {
    use super::{Principal, Registered};
    use anyhow::{Context, Result};
    use std::mem::ManuallyDrop;
    use windows::Win32::Foundation::{RPC_E_CHANGED_MODE, VARIANT_TRUE};
    use windows::Win32::System::Com::{
        CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx,
        CoUninitialize,
    };
    use windows::Win32::System::TaskScheduler::{
        ITaskFolder, ITaskService, TASK_CREATE_OR_UPDATE, TASK_LOGON_INTERACTIVE_TOKEN,
        TASK_LOGON_S4U, TASK_LOGON_SERVICE_ACCOUNT, TASK_STATE_DISABLED, TASK_STATE_QUEUED,
        TASK_STATE_READY, TASK_STATE_RUNNING, TaskScheduler,
    };
    use windows::Win32::System::Variant::VARIANT;
    use windows::core::BSTR;

    /// HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND) and (ERROR_PATH_NOT_FOUND).
    const NOT_FOUND: [i32; 2] = [0x8007_0002_u32 as i32, 0x8007_0003_u32 as i32];

    /// One connected Task Scheduler session on the COM apartment of the calling thread.
    pub struct Scheduler {
        root: ManuallyDrop<ITaskFolder>,
        uninitialize: bool,
    }

    impl Scheduler {
        pub fn connect() -> Result<Self> {
            // SAFETY: COM initialisation of the calling thread, balanced in Drop when it succeeded.
            let init = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            let uninitialize = init.is_ok();
            if init.is_err() && init != RPC_E_CHANGED_MODE {
                init.ok().context("CoInitializeEx")?;
            }
            // SAFETY: plain COM activation and calls on interfaces owned by this function.
            let root = unsafe {
                CoCreateInstance::<_, ITaskService>(&TaskScheduler, None, CLSCTX_INPROC_SERVER)
                    .context("ITaskService")
                    .and_then(|service| {
                        let empty = VARIANT::default();
                        service
                            .Connect(&empty, &empty, &empty, &empty)
                            .context("ITaskService::Connect")?;
                        service
                            .GetFolder(&BSTR::from("\\"))
                            .context("ITaskService::GetFolder(\\)")
                    })
            };
            match root {
                Ok(root) => Ok(Self {
                    root: ManuallyDrop::new(root),
                    uninitialize,
                }),
                Err(error) => {
                    if uninitialize {
                        // SAFETY: balances the successful CoInitializeEx above; no interface is alive.
                        unsafe { CoUninitialize() };
                    }
                    Err(error)
                }
            }
        }

        pub fn get(&self, path: &str) -> Result<Option<Registered>> {
            // SAFETY: COM calls on a connected folder; the returned interfaces are released on drop.
            unsafe {
                let task = match self.root.GetTask(&BSTR::from(path)) {
                    Ok(task) => task,
                    Err(error) if NOT_FOUND.contains(&error.code().0) => return Ok(None),
                    Err(error) => return Err(error).with_context(|| format!("GetTask({path})")),
                };
                let state = match task.State()? {
                    TASK_STATE_RUNNING => "Running",
                    TASK_STATE_READY => "Ready",
                    TASK_STATE_DISABLED => "Disabled",
                    TASK_STATE_QUEUED => "Queued",
                    _ => "Unknown",
                };
                Ok(Some(Registered {
                    state: state.to_owned(),
                    enabled: task.Enabled()? == VARIANT_TRUE,
                    xml: task.Xml()?.to_string(),
                }))
            }
        }

        pub fn register(
            &self,
            path: &str,
            xml: &str,
            principal: Principal,
            user: &str,
        ) -> Result<()> {
            let (user, logon) = match principal {
                Principal::System => ("SYSTEM", TASK_LOGON_SERVICE_ACCOUNT),
                Principal::S4U => (user, TASK_LOGON_S4U),
                Principal::Interactive => (user, TASK_LOGON_INTERACTIVE_TOKEN),
            };
            // SAFETY: COM call with owned BSTR/VARIANT arguments.
            unsafe {
                self.root
                    .RegisterTask(
                        &BSTR::from(path),
                        &BSTR::from(xml),
                        TASK_CREATE_OR_UPDATE.0,
                        &VARIANT::from(user),
                        &VARIANT::default(),
                        logon,
                        &VARIANT::default(),
                    )
                    .with_context(|| format!("RegisterTask({path})"))?;
            }
            Ok(())
        }

        pub fn run(&self, path: &str) -> Result<()> {
            // SAFETY: COM calls on a connected folder.
            unsafe {
                let task = self
                    .root
                    .GetTask(&BSTR::from(path))
                    .with_context(|| format!("GetTask({path})"))?;
                task.Run(&VARIANT::default())
                    .with_context(|| format!("Run({path})"))?;
            }
            Ok(())
        }

        pub fn delete(&self, path: &str) -> Result<bool> {
            // SAFETY: COM call on a connected folder.
            match unsafe { self.root.DeleteTask(&BSTR::from(path), 0) } {
                Ok(()) => Ok(true),
                Err(error) if NOT_FOUND.contains(&error.code().0) => Ok(false),
                Err(error) => Err(error).with_context(|| format!("DeleteTask({path})")),
            }
        }
    }

    impl Drop for Scheduler {
        fn drop(&mut self) {
            // SAFETY: the folder is released exactly once, here, before the apartment is left.
            unsafe { ManuallyDrop::drop(&mut self.root) };
            if self.uninitialize {
                // SAFETY: balances the successful CoInitializeEx of `connect`.
                unsafe { CoUninitialize() };
            }
        }
    }
}

#[cfg(windows)]
pub use com::Scheduler;

/// Off Windows there is no Task Scheduler: every call reports it.
#[cfg(not(windows))]
pub struct Scheduler;

#[cfg(not(windows))]
impl Scheduler {
    /// # Errors
    /// Always: the Task Scheduler exists only on Windows.
    pub fn connect() -> anyhow::Result<Self> {
        anyhow::bail!("le Planificateur de tâches n'existe que sous Windows")
    }

    /// # Errors
    /// Never reached.
    pub fn get(&self, _path: &str) -> anyhow::Result<Option<Registered>> {
        anyhow::bail!("le Planificateur de tâches n'existe que sous Windows")
    }

    /// # Errors
    /// Never reached.
    pub fn register(
        &self,
        _path: &str,
        _xml: &str,
        _principal: Principal,
        _user: &str,
    ) -> anyhow::Result<()> {
        anyhow::bail!("le Planificateur de tâches n'existe que sous Windows")
    }

    /// # Errors
    /// Never reached.
    pub fn run(&self, _path: &str) -> anyhow::Result<()> {
        anyhow::bail!("le Planificateur de tâches n'existe que sous Windows")
    }

    /// # Errors
    /// Never reached.
    pub fn delete(&self, _path: &str) -> anyhow::Result<bool> {
        anyhow::bail!("le Planificateur de tâches n'existe que sous Windows")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> TaskSpec {
        TaskSpec {
            path: "\\Aphrody\\".into(),
            name: "T & U".into(),
            description: Some("desc <x>".into()),
            action: Action {
                command: "C:\\bin\\a.exe".into(),
                arguments: Some("run --x \"y\"".into()),
                working_directory: Some("C:\\work".into()),
            },
            principal: Principal::S4U,
            highest: false,
            triggers: vec![
                Trigger::Boot,
                Trigger::Every { minutes: 30 },
                Trigger::Daily { hour: 6, minute: 0 },
            ],
            settings: Settings {
                restart: true,
                time_limit_minutes: Some(15),
            },
        }
    }

    #[test]
    fn triggers_parse_and_label_round_trip() {
        for text in [
            "atStartup",
            "atLogon",
            "every:30m",
            "daily@06:00",
            "daily@23:59",
        ] {
            assert_eq!(Trigger::parse(text).unwrap().label(), text);
        }
        for bad in ["every:0m", "every:30", "daily@24:00", "daily@6", "boot"] {
            assert!(Trigger::parse(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn built_definition_is_hidden_and_observable() {
        let xml = task_xml(&spec(), "PC\\me", "2026-10-09");
        assert!(xml.contains("<Description>desc &lt;x&gt;</Description>"));
        assert!(xml.contains("<LogonType>S4U</LogonType><RunLevel>LeastPrivilege</RunLevel>"));
        assert!(xml.contains("<ExecutionTimeLimit>PT15M</ExecutionTimeLimit>"));
        assert!(xml.contains("<StartBoundary>2026-10-09T06:00:00</StartBoundary>"));
        let seen = observe(&xml);
        assert!(seen.hidden);
        assert_eq!(seen.logon, "S4U");
        assert_eq!(seen.restart_count, 999);
        assert_eq!(seen.triggers, ["atStartup", "every:30m", "daily@06:00"]);
        assert_eq!(seen.action.unwrap(), spec().action);
    }

    #[test]
    fn system_principal_has_no_logon_user() {
        let mut s = spec();
        s.principal = Principal::System;
        s.triggers = vec![Trigger::Logon];
        let xml = task_xml(&s, "PC\\me", "2026-10-09");
        assert!(xml.contains("<UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel>"));
        assert!(xml.contains("<LogonTrigger><Enabled>true</Enabled></LogonTrigger>"));
        assert_eq!(observe(&xml).logon, "ServiceAccount");
    }

    const EXPORTED: &str = r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <URI>\Aphrody\Container</URI>
  </RegistrationInfo>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-21-1</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <IdleSettings>
      <Duration>PT10M</Duration>
      <StopOnIdleEnd>true</StopOnIdleEnd>
    </IdleSettings>
    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>
  </Settings>
  <Triggers>
    <LogonTrigger>
      <UserId>PC\me</UserId>
    </LogonTrigger>
    <TimeTrigger>
      <Repetition>
        <Interval>PT1H</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>2026-10-09T00:00:00+02:00</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Actions Context="Author">
    <Exec>
      <Command>C:\WINDOWS\System32\conhost.exe</Command>
      <Arguments>--headless "C:\Program Files\pwsh.exe" -NoProfile -File "C:\x.ps1"</Arguments>
      <WorkingDirectory>C:\aphrody</WorkingDirectory>
    </Exec>
  </Actions>
</Task>"#;

    #[test]
    fn exported_definition_is_observed() {
        let seen = observe(EXPORTED);
        assert!(!seen.hidden);
        assert_eq!(seen.logon, "Interactive");
        assert_eq!(seen.restart_count, 0);
        assert_eq!(seen.triggers, ["atLogon", "every:60m"]);
        let action = seen.action.unwrap();
        assert!(action.is_headless());
        let inner = action.unwrapped();
        assert_eq!(inner.command, "C:\\Program Files\\pwsh.exe");
        assert_eq!(
            inner.arguments.as_deref(),
            Some("-NoProfile -File \"C:\\x.ps1\"")
        );
    }

    #[test]
    fn periodic_patch_only_hides_and_replaces_the_action() {
        let action = Action {
            command: "C:\\bun.exe".into(),
            arguments: Some("run.ts".into()),
            working_directory: Some("C:\\aphrody".into()),
        }
        .headless("C:\\WINDOWS");
        let patch = Patch {
            principal: Principal::Interactive,
            highest: true,
            settings: None,
            add_triggers: vec![],
            action: Some(action.clone()),
        };
        let xml = patch_xml(EXPORTED, &patch, "PC\\me", "2026-10-09");
        let seen = observe(&xml);
        assert!(seen.hidden);
        assert_eq!(seen.triggers, ["atLogon", "every:60m"]);
        assert_eq!(seen.restart_count, 0);
        assert_eq!(seen.action.unwrap(), action);
        // The nested IdleSettings and unrelated settings survive.
        assert!(
            xml.contains("<Duration>PT10M</Duration>")
                && xml.contains("<UseUnifiedSchedulingEngine>")
        );
        assert_eq!(xml.matches("<Hidden>").count(), 1);
    }

    #[test]
    fn long_running_patch_adds_triggers_and_restart_once() {
        let patch = Patch {
            principal: Principal::S4U,
            highest: true,
            settings: Some(Settings {
                restart: true,
                time_limit_minutes: None,
            }),
            add_triggers: vec![Trigger::Boot, Trigger::Logon],
            action: None,
        };
        let once = patch_xml(EXPORTED, &patch, "PC\\me", "2026-10-09");
        let twice = patch_xml(&once, &patch, "PC\\me", "2026-10-09");
        assert_eq!(once, twice);
        let seen = observe(&once);
        assert_eq!(seen.logon, "S4U");
        assert_eq!(seen.restart_count, 999);
        assert_eq!(seen.triggers, ["atLogon", "every:60m", "atStartup"]);
        assert!(seen.action.unwrap().is_headless());
    }

    #[test]
    fn headless_wrap_round_trips() {
        let bare = Action {
            command: "C:\\a b\\x.exe".into(),
            arguments: None,
            working_directory: None,
        };
        let wrapped = bare.clone().headless("C:\\WINDOWS\\");
        assert_eq!(wrapped.command, "C:\\WINDOWS\\System32\\conhost.exe");
        assert_eq!(
            wrapped.arguments.as_deref(),
            Some("--headless \"C:\\a b\\x.exe\"")
        );
        assert_eq!(wrapped.clone().headless("C:\\WINDOWS"), wrapped);
        assert_eq!(wrapped.unwrapped(), bare);
        assert!(wrapped.same_program(&bare));
    }

    /// Live round trip on the local Task Scheduler: register, read, patch, run, delete. The task is
    /// the current user's, interactive and least-privileged, so no elevation is needed.
    #[cfg(windows)]
    #[test]
    fn scheduler_round_trip() {
        let scheduler = Scheduler::connect().unwrap();
        let name = format!("AphrodyWintaskTest-{}", std::process::id());
        let path = full_path("\\", &name);
        let user = current_user();
        let spec = TaskSpec {
            path: "\\".into(),
            name,
            description: Some("aphrody-infra wintask test".into()),
            action: Action {
                command: format!(
                    "{}\\System32\\cmd.exe",
                    std::env::var("SystemRoot").unwrap()
                ),
                arguments: Some("/d /c exit 0".into()),
                working_directory: None,
            }
            .headless(&std::env::var("SystemRoot").unwrap()),
            principal: Principal::Interactive,
            highest: false,
            triggers: vec![Trigger::Daily { hour: 3, minute: 7 }],
            settings: Settings {
                restart: false,
                time_limit_minutes: Some(1),
            },
        };
        scheduler
            .register(
                &path,
                &task_xml(&spec, &user, "2026-10-09"),
                Principal::Interactive,
                &user,
            )
            .unwrap();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let registered = scheduler.get(&path).unwrap().unwrap();
            assert!(registered.enabled);
            let seen = observe(&registered.xml);
            assert!(seen.hidden);
            assert_eq!(seen.logon, "Interactive");
            assert_eq!(seen.triggers, ["daily@03:07"]);
            assert!(seen.action.as_ref().unwrap().same_program(&spec.action));
            let patch = Patch {
                principal: Principal::Interactive,
                highest: false,
                settings: None,
                add_triggers: vec![Trigger::Every { minutes: 720 }],
                action: None,
            };
            let xml = patch_xml(&registered.xml, &patch, &user, "2026-10-09");
            scheduler
                .register(&path, &xml, Principal::Interactive, &user)
                .unwrap();
            let patched = observe(&scheduler.get(&path).unwrap().unwrap().xml);
            assert_eq!(patched.triggers, ["daily@03:07", "every:720m"]);
            scheduler.run(&path).unwrap();
        }));
        assert!(scheduler.delete(&path).unwrap());
        assert!(scheduler.get(&path).unwrap().is_none());
        assert!(!scheduler.delete(&path).unwrap());
        if let Err(panic) = result {
            std::panic::resume_unwind(panic);
        }
    }

    #[test]
    fn env_expansion_keeps_unknown_names() {
        // SAFETY: test-local variable name, no other test reads it.
        unsafe { std::env::set_var("APHRODY_WINTASK_TEST", "v") };
        assert_eq!(
            expand_env("%APHRODY_WINTASK_TEST%\\x %NOPE_UNSET_1% 50%"),
            "v\\x %NOPE_UNSET_1% 50%"
        );
        assert_eq!(full_path("\\", "a"), "\\a");
        assert_eq!(
            full_path("\\Aphrody\\Native\\", "site"),
            "\\Aphrody\\Native\\site"
        );
    }
}
