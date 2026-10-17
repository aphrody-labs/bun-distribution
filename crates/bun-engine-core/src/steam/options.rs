//! Options of `bun-engine run <system> <image> --steam ...` and of [`super::SteamPlugin`]: the
//! AppID, cloud and input switches, and the qualification script (open the overlay, trigger a
//! screenshot, quit) used for unattended proofs.

use std::time::Duration;

/// Steam Deck panel size; gamescope scales it to the output.
pub const DECK_SIZE: (u32, u32) = (1280, 800);

/// Scheduled actions for unattended qualification runs.
#[derive(Clone, Debug, Default)]
pub struct Script {
    /// Open the overlay on this dialog after `overlay_after`.
    pub overlay: Option<String>,
    pub overlay_after: Duration,
    /// Trigger a Steam screenshot after this delay.
    pub screenshot_after: Option<Duration>,
    /// Close the window after this delay.
    pub quit_after: Option<Duration>,
}

/// Options of `bun-engine run <system> <image> --steam ...`.
#[derive(Clone, Debug, Default)]
pub struct RunOptions {
    pub app_id: Option<u32>,
    pub cloud: bool,
    pub input: bool,
    pub title: Option<String>,
    pub script: Script,
}

/// True for flags of `run` that take a value.
pub fn takes_value(flag: &str) -> bool {
    matches!(
        flag,
        "--steam-appid"
            | "--steam-title"
            | "--steam-overlay"
            | "--steam-overlay-after"
            | "--steam-screenshot-after"
            | "--steam-quit-after"
    )
}

/// Parses the `--steam*` flags collected by the `run` command.
pub fn parse(args: &[String]) -> Result<RunOptions, String> {
    let mut options = RunOptions {
        cloud: true,
        input: true,
        ..RunOptions::default()
    };
    let mut it = args.iter();
    let secs = |v: Option<&String>| -> Result<Duration, String> {
        v.and_then(|v| v.parse::<f64>().ok())
            .filter(|v| *v >= 0.0)
            .map(Duration::from_secs_f64)
            .ok_or_else(|| "expected seconds".to_string())
    };
    while let Some(flag) = it.next() {
        match flag.as_str() {
            "--steam" => {}
            "--steam-appid" => {
                options.app_id = Some(
                    it.next()
                        .and_then(|v| v.parse().ok())
                        .ok_or("--steam-appid needs a number")?,
                )
            }
            "--steam-title" => options.title = it.next().cloned(),
            "--steam-no-cloud" => options.cloud = false,
            "--steam-no-input" => options.input = false,
            "--steam-overlay" => options.script.overlay = it.next().cloned(),
            "--steam-overlay-after" => options.script.overlay_after = secs(it.next())?,
            "--steam-screenshot-after" => options.script.screenshot_after = Some(secs(it.next())?),
            "--steam-quit-after" => options.script.quit_after = Some(secs(it.next())?),
            other => return Err(format!("unknown Steam option {other}")),
        }
    }
    Ok(options)
}
