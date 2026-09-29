//! Probe: does `BxcCli::run` lose or truncate stdout on a successful child?
use std::time::Duration;

use aphrody_web_bridge::{cli::BxcCli, resolve::Source};

#[tokio::test]
async fn large_stdout_is_complete_on_exit_zero() {
    let (bin, args) = if cfg!(windows) {
        (
            std::path::PathBuf::from("powershell.exe"),
            vec![
                "-NoProfile".to_string(),
                "-Command".to_string(),
                "$s=('x'*1024); for($i=0;$i -lt 4096;$i++){[Console]::Out.Write($s)}; exit 0"
                    .to_string(),
            ],
        )
    } else {
        (
            std::path::PathBuf::from("bash"),
            vec!["-c".to_string(), "head -c 4194304 /dev/zero | tr '\\0' 'x'".to_string()],
        )
    };

    let cli = BxcCli::from_source(Source::Override(bin));
    let run = cli.run(&args, Duration::from_secs(120)).await.expect("spawn");
    eprintln!("code={:?} timed_out={} len={}", run.code, run.timed_out, run.stdout.len());
    assert_eq!(run.code, Some(0));
    assert_eq!(run.stdout.len(), 4 * 1024 * 1024, "stdout truncated");
}
