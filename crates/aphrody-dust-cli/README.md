# aphrody-dust-cli

A CLI debug bridge for driving a headless Dust (Nintendo DS emulator) instance for reverse
engineering: breakpoints, real watchpoints, stepping, register/memory inspection, input injection,
screenshots, and deterministic record/replay. Reach for it whenever static analysis (Ghidra,
disassembly) needs a dynamic answer -- what's actually at PC during some phase of execution, what
byte changes when some observable event happens, does a candidate address actually get hit, what
does the player actually see at a given state.

It talks newline-delimited JSON to a compatible `dust-desktop` binary's `cli-server` feature
(archived source: `vendor/dust-imgui-frontend-archive/src/emu/cli_server.rs`), a headless
(`--headless`, no window) mode with its own
TCP bridge. Unlike the in-app GDB server, this is a bespoke protocol built directly on Dust's own
core APIs -- no GDB client, no RSP encoding.

## Prerequisites

- Python 3, no extra packages.
- A compatible `dust-desktop` binary with the `cli-server` feature, supplied separately. The
  frontend source is retained as an archive and is no longer built from this workspace.
  `aphrody-dust-cli` looks for it at `target/release/dust-desktop` or `target/debug/dust-desktop` relative
  to the current directory, or via `--dust-desktop-bin PATH` / `$DUST_DESKTOP_BIN`.

## Session state

Run all commands from your project's working directory -- session state persists in
`.dust-cli-state.json` (port, pid) and `.aphrody-dust-cli.log` (the emulator's stdout/stderr) there; both
are git-ignored.

## Command reference

- `aphrody-dust-cli launch <rom.nds> [--model ds|lite|ique|iquelite|dsi] [--arm7-bios PATH] [--arm9-bios PATH] [--firmware PATH] [--addr 127.0.0.1:0]`
  Starts `dust-desktop --headless` in the background (no window), loads the ROM, and waits for it
  to report its listening port. Boots straight into the game (direct boot) unless both
  `--arm7-bios`/`--arm9-bios` are given, in which case it boots through firmware instead.

- `aphrody-dust-cli break <addr> [--core arm7|arm9]` -- sets a live breakpoint, e.g. `aphrody-dust-cli break 0x02004000`.
  Addresses accept `0x...`, `$...`, or bare hex. No relaunch required -- this calls the core's
  `add_breakpoint` directly against the live emulator.
- `aphrody-dust-cli unbreak <addr> [--core arm7|arm9]`
- `aphrody-dust-cli breaks [--core arm7|arm9]` -- lists current breakpoints for that core.

- `aphrody-dust-cli watch <addr> [--size N] [--rw r|w|both] [--core arm7|arm9]` -- a real, hardware-accurate
  watchpoint (Dust's own bus-fallback watchpoint mechanism, not a polling/diff trick). Stops
  execution the instant a matching read/write occurs.
- `aphrody-dust-cli unwatch <addr> [--size N] [--rw r|w|both] [--core arm7|arm9]`

- `aphrody-dust-cli continue` -- resumes both cores and blocks until the next stop (breakpoint, watchpoint,
  or ROM shutdown), printing the stop reason.
- `aphrody-dust-cli run <frames>` -- emulates exactly that many frames, then stops (or stops earlier if a
  breakpoint/watchpoint fires, reporting how many frames it got through). Use this rather than
  timing a `continue` against the wall clock: headless Dust runs at ~14x realtime, so wall-clock
  slices are both coarse and machine-dependent, while a frame count is exact and reproducible.
- `aphrody-dust-cli step [--core arm7|arm9]` -- executes exactly **one instruction** on the given core (a
  real instruction-level single-step, not a cycle-count approximation) and blocks until it's done.
- `aphrody-dust-cli pause` -- interrupts an in-flight `continue` from another terminal/process.

- `aphrody-dust-cli regs [--json] [--core arm7|arm9]` -- prints `pc`/`r0`-`r15`/`cpsr`, or `--json` for
  `{"pc":...,"gprs":[...],"cpsr":...}`.
- `aphrody-dust-cli set-reg <reg> <value> [--core arm7|arm9]` -- `reg` is `r0`-`r15`, `pc`, `lr`, `sp`, or
  `cpsr`.

- `aphrody-dust-cli read <addr> <length> [--raw] [--core arm7|arm9]` -- reads a byte range from that core's
  address space via side-effect-free debug reads. Default output is one `addr: byte` line per byte
  (for `diff`ing); `--raw` writes the raw bytes to stdout.
- `aphrody-dust-cli write <addr> --bytes-hex "AA BB CC" [--core arm7|arm9]` (or pipe raw bytes on stdin if
  `--bytes-hex` is omitted) -- writes through the core's debug memory-write path.

- `aphrody-dust-cli press <button...>` / `aphrody-dust-cli release <button...>` -- injects joypad input directly.
  Buttons: `a b x y select start right left up down r l`.

- `aphrody-dust-cli tap <x> <y>` / `aphrody-dust-cli drag <x,y> <x,y>...` / `aphrody-dust-cli touch <x> <y>` /
  `aphrody-dust-cli release-touch` / `aphrody-dust-cli touch-script <file>` / `aphrody-dust-cli touch-state` -- the
  touchscreen; see [Touchscreen input](#touchscreen-input) below.

- `aphrody-dust-cli screenshot [path]` -- dumps both screens (top then bottom, stacked) as a 256x384 PNG.

- `aphrody-dust-cli checkpoint` / `aphrody-dust-cli save-replay <path>` / `aphrody-dust-cli replay <path>` -- deterministic
  record/replay, see below.

- `aphrody-dust-cli kill` -- tears down the session.

## Touchscreen input

Most DS games are driven by the stylus, and two properties of the hardware make naive injection
fail silently -- both handled by these commands, so you can think purely in "where on the screen"
and "for how long".

**Coordinates are bottom-screen pixels**: `0..=255` horizontally, `0..=191` vertically, origin
top-left, exactly like a screenshot. An off-screen coordinate is an error, not a clamp. (Underneath,
the touch panel reports raw 12-bit ADC readings which the game converts to pixels via the
calibration in the firmware's user settings -- typically `pixel = adc / 16`. These commands invert
that conversion using the calibration from the firmware image actually in use. `--raw` opts out and
passes 12-bit panel readings straight through.)

**A touch is a sequence, not a state**: a game samples the panel once per frame, so a tap has to
stay down across several frames to register, and a drag only exists if the position moves *between*
frames while the emulator is running. Every command below is therefore measured in frames and runs
the emulator for exactly that long.

```
aphrody-dust-cli tap 128 96                        # press and release at the centre of the bottom screen
aphrody-dust-cli tap 200 40 --hold-frames 30       # a long press (~0.5s)

aphrody-dust-cli drag 40,150 200,60                # a stroke; duration scales with the path length
aphrody-dust-cli drag 40,150 120,20 200,60 \       # a multi-point path, sampled once per frame
    --duration-frames 60
aphrody-dust-cli drag 20,20 200,170 --no-release   # leave the pen down at the last point

aphrody-dust-cli touch 128 96                      # put the pen down and leave it there (no frames run)
aphrody-dust-cli run 30                            # ...hold it there for 30 frames
aphrody-dust-cli release-touch                     # lift it (also cancels a gesture in flight)

aphrody-dust-cli touch-state                       # where the pen is + how much gesture is pending
```

`tap`/`drag` report the frames they emulated, e.g. `frames_elapsed frames=22`.

Timing knobs, all in frames: `--hold-frames`/`--release-frames` on `tap` (default 6 and 2);
`--duration-frames` (the moving part of the stroke -- default ~3 px/frame, a natural stylus speed),
`--hold-start-frames`/`--hold-end-frames` (default 4 each, so the game registers touch-down and
touch-up at the exact endpoints rather than mid-motion), `--release-frames`, and `--no-release` on
`drag`.

For anything these don't cover, `touch-script` takes the general form -- an explicit per-frame
timeline, which is what the others desugar to. A sample without `x`/`y` lifts the pen:

```
echo '[{"x":40,"y":150,"frames":4},{"x":90,"y":110},{"x":140,"y":70},{"frames":2}]' \
  | aphrody-dust-cli touch-script -
```

### Gestures and breakpoints

A gesture stops early if a breakpoint or watchpoint fires partway through, and the rest stays
queued -- so you can watch a stroke arrive in the game's own touch handler and then let it finish:

```
aphrody-dust-cli break 0x0203a1c4                  # the game's touch handler
aphrody-dust-cli drag 40,150 200,60                # -> breakpoint core=arm9 pc=... touch_remaining=61
aphrody-dust-cli regs                              # inspect it mid-stroke
aphrody-dust-cli continue                          # the rest of the stroke plays out
```

`touch_remaining` in a stop line is how many frames of gesture are still pending; `touch-state`
reports the same thing as `queued_frames`. Issuing a new touch command replaces whatever was
pending.

Gestures are recorded into `checkpoint`/`save-replay` like any other input, so a scripted stroke
replays exactly.

## Deterministic record/replay

```
aphrody-dust-cli launch game.nds
aphrody-dust-cli checkpoint                 # mark "now" as a replay origin
aphrody-dust-cli press start
aphrody-dust-cli continue
...                                  # play normally: press/release/continue/write, etc.
aphrody-dust-cli save-replay run1.replay     # bundles the checkpoint snapshot + input log

# Later, in a fresh session:
aphrody-dust-cli launch game.nds
aphrody-dust-cli replay run1.replay          # loads the checkpoint, arms input playback
aphrody-dust-cli continue                    # replays deterministically
aphrody-dust-cli screenshot frame.png        # inspect any point along the replay
```

`replay` verifies the replay file was recorded against the same ROM (CRC32 check) and refuses to
load a mismatched one. Input events are logged and replayed at frame granularity (not raw cycle
timestamps). Determinism holds because Dust's core has no RNG and the headless RTC backend never
reads the host's wall clock (see the archived frontend's `src/emu/rtc.rs` `FixedBackend`) -- the only
non-determinism a normal windowed session would have.

## Recipe: real watchpoint instead of polling

```
aphrody-dust-cli watch 0x02100000 --rw w    # write-only by default
aphrody-dust-cli continue                    # blocks until that address is written
aphrody-dust-cli regs                        # see exactly which instruction did it
```

## Recipe: confirm which screen a state value corresponds to

```
aphrody-dust-cli launch game.nds
aphrody-dust-cli continue                    # let it boot to the title/menu (Ctrl-C-free: use `pause` from another shell if it never stops on its own)
aphrody-dust-cli read 0x02100000 1           # note the current state value
aphrody-dust-cli screenshot state1.png       # see it directly instead of inferring from memory
aphrody-dust-cli press start
aphrody-dust-cli continue
aphrody-dust-cli read 0x02100000 1           # did it change?
aphrody-dust-cli screenshot state2.png
```

## Known limitations

- One `dust-desktop --headless` process per `.dust-cli-state.json`/working directory.
- `continue` blocks its own connection until a stop occurs; use `aphrody-dust-cli pause` (a second, short
  connection) to interrupt it if the ROM never hits a breakpoint/watchpoint on its own.
- Headless mode always uses the software 2D/3D renderers (needed for synchronous screenshot
  readback) and the interpreter engine, not the JIT.
- Save-file (SPI/flash) persistence isn't wired up in headless mode -- sessions always start from
  an empty save.
