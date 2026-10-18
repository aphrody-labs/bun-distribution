# VPS game streaming: gamescope in Docker, WebRTC to a WebGPU client, Wolf for Moonlight

The VPS renders on the CPU (llvmpipe/lavapipe, 12 Haswell cores, no GPU). This directory streams a
gamescope session from Docker to the workstation over `wg1` and moves the expensive half of
presentation to the client GPU:

| Path      | Server (VPS, Docker)                                                                                                                                  | Client                                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser   | `gamestream`: gamescope `--backend headless` 1280x720 -> PipeWire -> x264 (zerolatency) + Opus -> `webrtcbin`                                         | `packages/bun-gamestream`: WebRTC receive, WebGPU `importExternalTexture`, FSR1 EASU + RCAS upscaling to the window, input over a data channel |
| Moonlight | `wolf`: [games-on-whales/wolf](https://github.com/games-on-whales/wolf) (MIT), `WOLF_RENDER_NODE=software`, x264 software encoder, apps as containers | Moonlight Qt (hardware decode on the RTX 4070)                                                                                                 |

Both services are bound to the `wg1` address `10.200.77.1` only and share the cpuset `4-11`, leaving
CPUs 0-3 to production services.

## Files

| File                                          | Role                                                                                                                                                                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Containerfile`                               | `aphrody/bun-gamestream:local`: Ubuntu 26.10, gamescope 3.16, Mesa lavapipe/llvmpipe, PipeWire + WirePlumber, GStreamer 1.28 (`webrtcbin`, `x264enc`, `pipewiresrc`, libnice), python3-gi/xlib/evdev, the Bun client sources |
| `entrypoint.sh`                               | `GAMESTREAM_MODE=webrtc` (default), `wolf-app` (workload on Wolf's compositor) or `probe` (Vulkan/GStreamer capability report)                                                                                               |
| `sender.py`                                   | WebRTC sender supervised by the Bun server (JSON lines on stdin/stdout); XTest input into gamescope's Xwayland, uinput Xbox 360 pad on the first gamepad message                                                             |
| `pipewire/pipewire.conf.d/50-gamestream.conf` | 48 kHz / 10 ms graph and the `gamestream` virtual sink the session plays into                                                                                                                                                |
| `compose.yaml`                                | `gamestream` (profile `webrtc`) and `wolf` (profile `moonlight`); not part of the shared infra compose                                                                                                                       |
| `compose.ntsync.yaml`                         | adds `/dev/ntsync` when the host exposes it                                                                                                                                                                                  |
| `wolf/config.toml`                            | Wolf seed config: gamescope glxgears/vkcube apps from this image, Steam (games-on-whales image), test ball; upstream `[gstreamer]` section with x264 `ultrafast`                                                             |
| `up.sh`                                       | `webrtc`, `moonlight`, `build`, `down`                                                                                                                                                                                       |

## Run (as `ubuntu` on the VPS)

```sh
./up.sh build      # apt-only image, about 2.5 minutes, 354 MB
./up.sh webrtc     # http://10.200.77.1:8797 from the workstation (Chrome or Edge)
./up.sh moonlight  # Moonlight: add host 10.200.77.1, pair with the PIN URL printed in `docker logs bun-wolf`
./up.sh down
```

`up.sh` resolves the host Bun (`BUN_BIN`, bind-mounted read-only into the container) and seeds
`$WOLF_STATE` (`/games/wolf` by default) once; Wolf then owns `cfg/config.toml` (paired clients).

Tunables (environment of `up.sh`): `GAMESTREAM_APP` (default `glxgears -fullscreen`),
`GAMESTREAM_FPS` (60), `GAMESTREAM_BITRATE_KBPS` (8000), `LP_NUM_THREADS` (4),
`GAMESTREAM_ENCODER_THREADS` (3), `GAMESTREAM_CPUSET` (`4-11`), `GAMESTREAM_BIND` (`10.200.77.1`).

## Capture the existing Steam desktop

The existing image also supports `./up.sh x11` through `compose.x11.yaml`.
Rebuild the image after a sender or entrypoint change. This mode captures host
display `:99` through a read-only X11 socket mount, retains the private mesh bind,
CPU and memory constraints, and uses the declared uinput device as container root.
It starts neither gamescope nor a test workload, and mounts no Steam store.
Audio is explicitly disabled for this initial mode. X11 authorization must already
allow this capture; a failed preflight must not be bypassed with `xhost` changes.
Image construction and actual desktop/game streaming remain separate gates.

`host-x11.sh` reuses the sender and signalling protocol on the host, capturing an
existing authorized X11 session instead of launching a container workload. It does
not start Steam, sign in, change its library or create a second desktop.

```sh
GAMESTREAM_DISPLAY=:99 GAMESTREAM_HOST=10.200.77.1 \
GAMESTREAM_ICE_ADDRESS=10.200.77.1 ./host-x11.sh --check
# After Infra has qualified the dependencies and access, use the same command
# without --check in a bounded, supervised job.
```

`GAMESTREAM_VIDEO_SOURCE=x11` selects `ximagesrc`; the default remains `pipewire`.
The display is passed as a GStreamer property, with XTest input mapped to the
actual desktop dimensions before capture scaling. Native audio is disabled by
default: enable it only with `GAMESTREAM_AUDIO=1` and an explicit existing
`GAMESTREAM_AUDIO_NODE` PipeWire sink monitor. `--check` verifies sender imports,
elements and XTest access without starting capture. Gamepad activation additionally
requires authorized write access to `/dev/uinput`; the script never changes it.

The host needs the same GStreamer GI/WebRTC, x264, libnice and Python Xlib/evdev
dependencies declared in `Containerfile`, plus `ximagesrc`. The October 18 probe
found Xvfb `:99` (1600x900, XTEST), Python GI/Xlib and `ximagesrc`, but no
GStreamer inspection tool, WebRTC/x264 plugin files or evdev package; the user
could not write `/dev/uinput`. No native sender or real game stream was activated.
Infra must qualify these prerequisites before launch. A successful preflight does
not prove video, audio, input delivery or playable DBXV2 frame rates.

## CPU-only sizing

- 8 of 12 CPUs (`cpuset 4-11`), 24 GiB memory for the session and each Wolf app, 8 GiB for Wolf,
  2 GiB `/dev/shm`, `cpu_shares 512` so production wins under contention.
- gamescope renders at 1280x720; the client upscales. llvmpipe gets 4 threads, x264 3 sliced
  threads (`ultrafast`, `zerolatency`, no B-frames, no lookahead, 4 s GOP plus keyframes on PLI).
- Audio: 10 ms Opus frames, `restricted-lowdelay`.
- `/dev/ntsync` is passed through when present (absent on the current 7.3 kernel: the module is
  not loaded).

## Client (`packages/bun-gamestream`)

`bun packages/bun-gamestream/src/server.ts` serves the page and the WebSocket signalling with
`Bun.serve` (`GAMESTREAM_HOST`, `GAMESTREAM_PORT`, `GAMESTREAM_SENDER`). The page:

- presents through WebGPU: `MediaStreamTrackProcessor` frames (or `requestVideoFrameCallback` on a
  hidden video with `?source=video`) -> `importExternalTexture` -> EASU (12 `textureLoad` taps) ->
  RCAS -> canvas in device pixels; `?upscale=bilinear` for comparison, `?sharpness=<stops>`
  (default 0.2); plain `<video>` only when WebGPU is unavailable;
- sets `jitterBufferTarget = 0` on the receivers;
- captures input: click for pointer lock (`unadjustedMovement`), relative motion flushed per
  frame, absolute motion when unlocked, buttons, wheel, keyboard (`KeyboardEvent.code` -> X
  keysyms), Gamepad API standard mapping; F8 toggles the HUD;
- shows a HUD (server fps/kbps/encode time, receive/presented fps, decode time, jitter buffer,
  data channel RTT, estimated glass-to-glass latency) and logs `[gamestream] stats {...}` every 5 s;
- `?source=test` (or a server without sender) runs a local 1280x720 test pattern through the same
  WebGPU/FSR and input paths; `await gamestreamBenchmark()` in the console measures the GPU cost
  of one presentation.

FSR1 is ported from AMD FidelityFX `ffx_fsr1.h` (MIT); the notice is kept in
`packages/bun-gamestream/src/client/fsr.ts`.

## Qualification status

Done:

- Image build on the VPS (2026-10-17): `aphrody/bun-gamestream:local`, 354 MB; the Wolf image
  `ghcr.io/games-on-whales/wolf:stable` (2026-09-29) is pulled.
- Client on the workstation (Chrome, RTX 4070 "nvidia lovelace", localhost test source):
  WebGPU `webgpu-trackprocessor` path, FSR 1280x720 -> 2276x1280, 59 fps presented in a focused
  window, GPU cost 1.6-1.7 ms per frame (bilinear 0.1-0.2 ms), keyboard/mouse/button events
  captured and normalized to the letterboxed picture. `bun check` and `bun lint` clean.

Remaining on the VPS (paused: the host is reserved for game downloads and Steam Remote Play):

1. `docker run --rm -e GAMESTREAM_MODE=probe aphrody/bun-gamestream:local`: lavapipe device,
   GStreamer elements.
2. `./up.sh webrtc`: gamescope `--backend headless` on lavapipe and its PipeWire node `gamescope`
   (fallback if it does not start: Xwayland/Xvfb + `ximagesrc`), libnice pinned to `10.200.77.1`
   (`ice-agent.agent.add_local_address`; candidates are filtered to that address either way),
   data channel creation before the first offer, XTest into gamescope's Xwayland (glxgears arrow
   keys), then the browser test at `http://10.200.77.1:8797`.
3. `./up.sh moonlight`: Wolf software compositor and x264 with the bridge-published ports (Wolf
   documents host networking; its listeners are hard-coded to `0.0.0.0`, which is why the ports
   are published on the wg1 address instead), Moonlight Qt pairing
   (`Moonlight.exe pair 10.200.77.1 --pin <pin>`, then `stream 10.200.77.1 "Gamescope glxgears (CPU)"
--video-codec H.264 --resolution 1280x720 --fps 60`). Choose H.264: Wolf also offers software
   x265, too slow on this CPU.
4. `wolf-app` mode: gamescope `--backend wayland` nested in Wolf's software compositor; if it
   needs dmabuf, set `GAMESTREAM_WOLF_GAMESCOPE=0` and use Wayland clients (`vkcube --wsi wayland`).
5. Latency/fps under a real workload; the virtual uinput devices (Wolf, gamepad) are host-wide.
