# Bun Engine game-stream client

`bun-engine stream` is a native Moonlight/GameStream client built as a Bevy plugin of Bun Engine's
runtime (`stream::session::StreamPlugin`: Bevy's window, wgpu 30 device and input; see
[BEVY.md](BEVY.md)). It targets the CPU-only VPS that streams games through Wolf or Sunshine to a PC with
a hardware decoder (RTX 4070 here): the PC does decode, upscale and present on the GPU.

## Usage

```text
bun-engine stream <host[:port]> [--app NAME|ID] [--size 1920x1080] [--fps 60] [--bitrate 20000]
                  [--codec auto|h264|hevc|av1] [--window WxH] [--vsync] [--sharpness 0.25]
                  [--encrypt-video] [--no-hud] [--seconds N]
bun-engine stream <host> --pair        # pair only
bun-engine stream <host> --apps        # list the host's apps
bun-engine stream <host> --quit-app    # stop the running app
bun-engine stream --loopback [--size 1280x720] [--fps 60] [--loss 5] [--fec 20] [--seconds 20]
```

Pairing: the first connection prints a random 4-digit PIN. The owner enters it on the host
(Sunshine web UI > PIN; Wolf prints a pairing URL in its log). The client identity (RSA-2048 key,
self-signed certificate, unique id) and the pinned server certificates live in
`%APPDATA%\bun-engine\stream` (override with `BUN_STREAM_HOME`).

In-stream keys: `Ctrl+Alt+Shift+Z` toggles mouse capture (a left click captures), `+S` toggles the
HUD, `+Q` quits. Focus loss releases the mouse and every held key.

## Pipeline

| Stage | Owner | Notes |
| --- | --- | --- |
| HTTPS pairing, app list, launch/resume | `stream/http.rs` | 5-step PIN pairing (AES-128-ECB keyed by SHA-256(salt‖PIN), RSA-SHA256 secrets), mutual TLS (rustls + ring) pinned to the paired server certificate |
| RTSP setup | `stream/rtsp.rs` | OPTIONS, DESCRIBE (codec + encryption discovery), SETUP audio/video/control, ANNOUNCE (SDP), PLAY |
| Control stream | `stream/control.rs` | ENet (rusty_enet) with Sunshine "control v2" AES-128-GCM framing; IDR request + start, 100 ms pings, input, rumble to XInput, termination |
| Input | `stream/input.rs`, `stream/session.rs`, `window.rs` | Bevy `KeyboardInput` key codes -> Windows VK, raw (unaccelerated) `MouseMotion` deltas, wheel, gilrs gamepads in XInput layout (`window::pad_from_bevy`) |
| Video receive | `stream/video.rs`, `stream/fec/` | RTP + NV headers, per-block Reed-Solomon recovery (SIMD GF(2^8)), optional AES-GCM shard decryption, in-order delivery, IDR request on loss |
| Decode | `stream/decode.rs` | Media Foundation decoder MFT (DXVA) on a D3D11 device created on the wgpu adapter (same LUID); each picture is GPU-copied into a 5-slot ring of NT-shared NV12 textures and a shared fence is signalled |
| Import | `stream/decode.rs` | the ring is opened through the wgpu D3D12 device (`texture_from_raw` + `create_texture_from_hal`, NV12 with Plane0/Plane1 views); the wgpu queue waits on the shared fence on the GPU, no CPU sync, no readback |
| Present | `stream/present.rs`, `runtime/fsr1.rs`, `runtime/fsr1.wgsl` | FSR1 EASU fused with NV12 -> RGB (BT.709) from stream size to the letterboxed viewport, RCAS (with denoise) into the swap chain, HUD blend; `Immediate > Mailbox > Fifo` (`--vsync` flips it), frame latency 1, tether's frame-age drop policy |
| Pacing / stats | `stream/pacing.rs`, `stream/stats.rs` | latest-frame mailbox with slot pinning; precise GPU completion times from D3D11/D3D12 fences watched on side threads |

If the D3D11 device cannot share NV12 textures (or `BUN_STREAM_CPU_COPY=1`), decoded pictures are
read back and uploaded (`CPU copy` in the HUD). A software decoder MFT works the same way.

## Loopback self-test

`--loopback` starts an in-process host: a synthetic NV12 pattern (moving bars, 1-pixel
checkerboard, gradient, bouncing box, frame counter) encoded by the Media Foundation H.264 encoder
(low-latency CBR, software), packetized by the absorbed Moonshine packetizer with 20 % FEC and sent
over UDP to 127.0.0.1. `--loss P` drops P % of the shards to exercise FEC recovery. The client side
is exactly the remote path from the UDP socket on. The default 1280x720 stream is upscaled 1.5x
by FSR1. At exit the client prints per-stage mean/p50/p95/p99 latencies.

## Measured on this PC

RTX 4070, Windows 11, `bun-engine stream --loopback --seconds 20` (1280x720@60 H.264, 20 Mb/s CBR target,
20 % FEC, FSR1 to a 2400x1350 window, Immediate present, HUD on; dev build with the engine and wgpu
crates at opt-level 3). Decoder: Microsoft H264 Video Decoder MFT with DXVA, zero-copy ring.

| Stage (ms) | mean | p50 | p95 |
| --- | --- | --- | --- |
| encode (loopback host, software MFT) | 2.49 | 2.35 | 3.18 |
| network + FEC reassembly | 0.03 | 0.02 | 0.06 |
| decode submit (CPU) | 0.52 | 0.46 | 0.60 |
| decode GPU (DXVA + NV12 copy) | 2.24 | 1.89 | 4.54 |
| render record + submit (CPU) | 1.08 | 0.96 | 1.38 |
| present GPU (EASU + RCAS + HUD) | 3.42 | 3.44 | 6.42 |
| receive -> glass | 6.12 | 5.97 | 10.09 |
| capture -> glass | 8.72 | 8.53 | 12.90 |

1128 frames in 18.8 s = 59.97 fps (the source rate), 0 frames lost. With `--loss 5` the FEC rebuilt
70 shards in 10 s, one frame was unrecoverable and the IDR request resynchronized the stream at
59.8 fps. Without the HUD, receive -> glass drops to 3.5 ms mean (2.6 ms p50) and 3.2 ms at 1:1
scale. The GPU stays in its low P-state (P8, about 210 MHz) under this light load, so the GPU stages
are clock-bound rather than work-bound; a game-sized stream raises the clocks.

These figures predate the Bevy runtime (own winit/wgpu loop); the Bevy path keeps the same zero-copy
decode, ring import and FSR1 passes, rendered in the `Core2d` schedule into the camera output.

Screenshot of the running window: `target/stream-selftest/loopback.png` (not versioned).

## Limits

- Audio (Opus over RTP) is not played yet; the RTSP setup negotiates stereo so hosts accept the
  session.
- Windows only for decode/present (Media Foundation + D3D12); the protocol modules are portable.
- HEVC and AV1 need the Microsoft HEVC / AV1 Video Extensions (their decoder MFTs); without them the
  client negotiates H.264.
- Reference-frame invalidation is not used: on unrecoverable loss the client requests an IDR frame
  and drops frames until it arrives.
- No HDR (10-bit P010) path yet; the SDP requests SDR Rec. 709 limited range.
- Encrypted RTSP (`rtspenc://`) is not implemented; hosts are asked for plain RTSP.
