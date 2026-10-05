use std::process::Command;

fn output(program: &str, args: &[&str]) -> String {
  Command::new(program)
    .args(args)
    .output()
    .ok()
    .filter(|output| output.status.success())
    .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
    .filter(|output| !output.is_empty())
    .unwrap_or_else(|| "unknown".into())
}

fn main() {
  tauri_build::build();
  println!(
    "cargo:rustc-env=YOLO_DESKTOP_TARGET={}",
    std::env::var("TARGET").unwrap_or_else(|_| "unknown".into())
  );
  println!(
    "cargo:rustc-env=YOLO_DESKTOP_GIT_REV={}",
    output("git", &["rev-parse", "HEAD"])
  );
  println!(
    "cargo:rustc-env=YOLO_DESKTOP_RUSTC={}",
    output(
      &std::env::var("RUSTC").unwrap_or_else(|_| "rustc".into()),
      &["--version"]
    )
  );
  for name in ["HEAD", "packed-refs"] {
    println!(
      "cargo:rerun-if-changed={}",
      output("git", &["rev-parse", "--git-path", name])
    );
  }
  let branch = output("git", &["symbolic-ref", "-q", "HEAD"]);
  if branch != "unknown" {
    println!(
      "cargo:rerun-if-changed={}",
      output("git", &["rev-parse", "--git-path", &branch])
    );
  }
  println!("cargo:rerun-if-changed=build.rs");
}
