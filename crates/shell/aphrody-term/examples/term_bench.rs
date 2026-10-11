// SPDX-License-Identifier: Apache-2.0
//! Parser throughput (MB/s) and per-frame batching time of the terminal engine.
//!
//! ```sh
//! cargo run -p aphrody-term --release --example term_bench
//! ```

use std::time::Instant;

use aphrody_term::{AphrodyTerm, TermConfig};

/// Deterministic mixed VT corpus: plain text, SGR/256/truecolor, UTF-8, cursor
/// movement, hyperlinks and shell-integration marks.
fn corpus(target: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(target + 256);
    let mut seed = 0x2545_F491_u32;
    let mut next = || {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        seed
    };
    while out.len() < target {
        match next() % 10 {
            0..=3 => out.extend_from_slice(
                b"cargo build --release: Compiling aphrody-term v1.0.0 (crates/shell/aphrody-term) in 0.42s\r\n",
            ),
            4 | 5 => {
                let n = next() % 256;
                let (r, g, b) = (next() % 256, next() % 256, next() % 256);
                out.extend_from_slice(
                    format!(
                        "\x1b[1;32mok\x1b[0m \x1b[38;5;{n}mindexed\x1b[0m \x1b[38;2;{r};{g};{b}mtruecolor\x1b[48;5;236m bg \x1b[0m\r\n"
                    )
                    .as_bytes(),
                );
            },
            6 => out.extend_from_slice("héllo wörld 日本語 ✓ → λ\r\n".as_bytes()),
            7 => {
                let (row, col) = (next() % 40 + 1, next() % 100 + 1);
                out.extend_from_slice(format!("\x1b[{row};{col}Hcursor\x1b[K\x1b[2;1H").as_bytes());
            },
            8 => out.extend_from_slice(
                b"\x1b]8;;file:///c/aphrody/src/lib.rs\x1b\\src/lib.rs:12:5\x1b]8;;\x1b\\ error\r\n",
            ),
            _ => out.extend_from_slice(b"\x1b]133;A\x07$ \x1b]133;B\x07ls\r\n\x1b]133;C\x07\x1b]133;D;0\x07"),
        }
    }
    out
}

fn main() {
    let bytes = corpus(16 * 1024 * 1024);
    let mb = bytes.len() as f64 / (1024.0 * 1024.0);
    let chunk = 64 * 1024;

    let mut term = AphrodyTerm::new(TermConfig { cols: 120, rows: 40, max_scrollback: 10_000 });
    let started = Instant::now();
    for piece in bytes.chunks(chunk) {
        term.ingest(piece);
    }
    let secs = started.elapsed().as_secs_f64();
    println!("aphrody-term ingest: {mb:.1} MB in {secs:.3} s = {:.1} MB/s", mb / secs);

    let frames = 2_000;
    let _ = term.render_frame();
    let started = Instant::now();
    let mut quads = 0;
    for _ in 0..frames {
        let (bg, glyphs) = term.render_frame();
        quads += bg.len() + glyphs.len();
    }
    let per_frame = started.elapsed().as_secs_f64() * 1e6 / f64::from(frames);
    println!(
        "aphrody-term frame (120x40): {per_frame:.1} us/frame, {} quads/frame",
        quads / frames as usize
    );

    let mut state = aphrody_terminal_core::TerminalState::new(120, 40);
    let started = Instant::now();
    for piece in bytes.chunks(chunk) {
        state.ingest(piece);
        let _ = state.take_replies();
    }
    let secs = started.elapsed().as_secs_f64();
    println!("terminal-core (rio-vt) ingest: {mb:.1} MB in {secs:.3} s = {:.1} MB/s", mb / secs);

    let started = Instant::now();
    let snapshots = 500;
    let mut cells = 0;
    for _ in 0..snapshots {
        cells += state.styled_snapshot().cells.len();
    }
    let per_snapshot = started.elapsed().as_secs_f64() * 1e6 / f64::from(snapshots);
    println!(
        "terminal-core styled_snapshot (120x40): {per_snapshot:.1} us/frame ({} rows)",
        cells / snapshots as usize
    );
}
