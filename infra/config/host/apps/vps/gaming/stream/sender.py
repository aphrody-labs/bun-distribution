#!/usr/bin/env python3
"""Bun OS gamestream WebRTC sender.

Supervised by packages/bun-gamestream/src/server.ts: signalling messages are JSON lines on
stdin/stdout, logs go to stderr. One viewer at a time; a new `start` replaces the session.

  pipewiresrc (gamescope node) -> x264enc zerolatency -> rtph264pay -> webrtcbin
  pipewiresrc (gamestream sink monitor) -> opusenc 10 ms -> rtpopuspay -> webrtcbin
  webrtcbin data channel "input" -> XTest (Xwayland of gamescope) and a uinput gamepad
"""

import json
import os
import sys
import threading
import time

import gi

gi.require_version("Gst", "1.0")
gi.require_version("GstSdp", "1.0")
gi.require_version("GstWebRTC", "1.0")
from gi.repository import GLib, Gst, GstSdp, GstWebRTC  # noqa: E402

Gst.init(None)


def env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


WIDTH = env_int("GAMESTREAM_WIDTH", 1280)
HEIGHT = env_int("GAMESTREAM_HEIGHT", 720)
FPS = env_int("GAMESTREAM_FPS", 60)
BITRATE = env_int("GAMESTREAM_BITRATE_KBPS", 8000)
ENC_THREADS = env_int("GAMESTREAM_ENCODER_THREADS", 4)
ICE_ADDRESS = os.environ.get("GAMESTREAM_ICE_ADDRESS", "").strip()
VIDEO_NODE = os.environ.get("GAMESTREAM_VIDEO_NODE", "gamescope")
AUDIO_NODE = os.environ.get("GAMESTREAM_AUDIO_NODE", "gamestream")
AUDIO = os.environ.get("GAMESTREAM_AUDIO", "1") == "1"
X_DISPLAY = os.environ.get("GAMESTREAM_DISPLAY", os.environ.get("DISPLAY", ":0"))

out_lock = threading.Lock()


def send(msg):
    with out_lock:
        sys.stdout.write(json.dumps(msg, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def log(*args):
    print("[sender]", *args, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------------------------
# Input injection
# --------------------------------------------------------------------------------------------

KEY_NAMES = {
    "Enter": "Return", "NumpadEnter": "KP_Enter", "Space": "space", "Escape": "Escape",
    "Tab": "Tab", "Backspace": "BackSpace", "Delete": "Delete", "Insert": "Insert",
    "Home": "Home", "End": "End", "PageUp": "Prior", "PageDown": "Next",
    "ArrowUp": "Up", "ArrowDown": "Down", "ArrowLeft": "Left", "ArrowRight": "Right",
    "ShiftLeft": "Shift_L", "ShiftRight": "Shift_R", "ControlLeft": "Control_L",
    "ControlRight": "Control_R", "AltLeft": "Alt_L", "AltRight": "ISO_Level3_Shift",
    "MetaLeft": "Super_L", "MetaRight": "Super_R", "CapsLock": "Caps_Lock",
    "Minus": "minus", "Equal": "equal", "BracketLeft": "bracketleft",
    "BracketRight": "bracketright", "Backslash": "backslash", "Semicolon": "semicolon",
    "Quote": "apostrophe", "Backquote": "grave", "Comma": "comma", "Period": "period",
    "Slash": "slash", "IntlBackslash": "less", "ContextMenu": "Menu", "PrintScreen": "Print",
    "ScrollLock": "Scroll_Lock", "Pause": "Pause", "NumLock": "Num_Lock",
    "NumpadAdd": "KP_Add", "NumpadSubtract": "KP_Subtract", "NumpadMultiply": "KP_Multiply",
    "NumpadDivide": "KP_Divide", "NumpadDecimal": "KP_Decimal",
}


def key_name(code):
    if code in KEY_NAMES:
        return KEY_NAMES[code]
    if code.startswith("Key") and len(code) == 4:
        return code[3].lower()
    if code.startswith("Digit") and len(code) == 6:
        return code[5]
    if code.startswith("Numpad") and code[6:].isdigit():
        return "KP_" + code[6:]
    if code.startswith("F") and code[1:].isdigit():
        return code
    return None


class XInput:
    """XTest injection into gamescope's Xwayland (games run as X clients there)."""

    def __init__(self, display_name):
        from Xlib import X, XK, display
        from Xlib.ext import xtest

        self.X, self.XK, self.xtest = X, XK, xtest
        self.d = display.Display(display_name)
        if not self.d.has_extension("XTEST"):
            raise RuntimeError("XTEST missing on " + display_name)
        self.lock = threading.Lock()
        self.keycodes = {}
        self.events = 0
        log("XTest on", display_name)

    def keycode(self, code):
        if code not in self.keycodes:
            name = key_name(code)
            sym = self.XK.string_to_keysym(name) if name else 0
            self.keycodes[code] = self.d.keysym_to_keycode(sym) if sym else 0
        return self.keycodes[code]

    def handle(self, m):
        X, fake = self.X, self.xtest.fake_input
        t = m.get("t")
        with self.lock:
            if t == "mm":
                fake(self.d, X.MotionNotify, detail=1, x=int(m["dx"]), y=int(m["dy"]))
            elif t == "ma":
                fake(self.d, X.MotionNotify, x=int(m["x"] * WIDTH), y=int(m["y"] * HEIGHT))
            elif t == "mb":
                button = {0: 1, 1: 2, 2: 3, 3: 8, 4: 9}.get(int(m["b"]), 1)
                fake(self.d, X.ButtonPress if m["d"] else X.ButtonRelease, button)
            elif t == "mw":
                button = 4 if m["dy"] < 0 else 5
                fake(self.d, X.ButtonPress, button)
                fake(self.d, X.ButtonRelease, button)
            elif t == "k":
                kc = self.keycode(m["c"])
                if not kc:
                    return
                fake(self.d, X.KeyPress if m["d"] else X.KeyRelease, kc)
            else:
                return
            self.d.flush()
            self.events += 1

    def pointer(self):
        with self.lock:
            p = self.d.screen().root.query_pointer()
            return [p.root_x, p.root_y]


class Gamepad:
    """Xbox 360 layout uinput pad, created on the first gamepad message (W3C standard mapping)."""

    BUTTONS = None

    def __init__(self):
        from evdev import AbsInfo, UInput
        from evdev import ecodes as e

        self.e = e
        self.BUTTONS = [
            e.BTN_SOUTH, e.BTN_EAST, e.BTN_WEST, e.BTN_NORTH, e.BTN_TL, e.BTN_TR,
            None, None, e.BTN_SELECT, e.BTN_START, e.BTN_THUMBL, e.BTN_THUMBR,
            None, None, None, None, e.BTN_MODE,
        ]
        stick = AbsInfo(0, -32768, 32767, 16, 128, 0)
        trigger = AbsInfo(0, 0, 255, 0, 0, 0)
        hat = AbsInfo(0, -1, 1, 0, 0, 0)
        caps = {
            e.EV_KEY: [b for b in self.BUTTONS if b is not None],
            e.EV_ABS: [
                (e.ABS_X, stick), (e.ABS_Y, stick), (e.ABS_RX, stick), (e.ABS_RY, stick),
                (e.ABS_Z, trigger), (e.ABS_RZ, trigger), (e.ABS_HAT0X, hat), (e.ABS_HAT0Y, hat),
            ],
        }
        self.ui = UInput(caps, name="Microsoft X-Box 360 pad", vendor=0x045E, product=0x028E,
                         version=0x110, bustype=e.BUS_USB)
        self.state = {}
        log("uinput gamepad", self.ui.device.path if self.ui.device else "")

    def set(self, typ, code, value):
        if self.state.get((typ, code)) != value:
            self.state[(typ, code)] = value
            self.ui.write(typ, code, value)

    def handle(self, m):
        e = self.e
        b = m.get("b", [])
        a = m.get("a", [])
        for i, code in enumerate(self.BUTTONS):
            if code is not None and i < len(b):
                self.set(e.EV_KEY, code, 1 if b[i] > 0.5 else 0)
        if len(b) > 7:
            self.set(e.EV_ABS, e.ABS_Z, int(b[6] * 255))
            self.set(e.EV_ABS, e.ABS_RZ, int(b[7] * 255))
        if len(b) > 15:
            self.set(e.EV_ABS, e.ABS_HAT0X, (1 if b[15] > 0.5 else 0) - (1 if b[14] > 0.5 else 0))
            self.set(e.EV_ABS, e.ABS_HAT0Y, (1 if b[13] > 0.5 else 0) - (1 if b[12] > 0.5 else 0))
        for i, code in enumerate((e.ABS_X, e.ABS_Y, e.ABS_RX, e.ABS_RY)):
            if i < len(a):
                self.set(e.EV_ABS, code, max(-32768, min(32767, int(a[i] * 32767))))
        self.ui.syn()


# --------------------------------------------------------------------------------------------
# WebRTC session
# --------------------------------------------------------------------------------------------


def video_branch():
    x264 = (
        f"x264enc tune=zerolatency speed-preset=ultrafast bitrate={BITRATE} "
        f"vbv-buf-capacity={max(50, 2000 // FPS)} key-int-max={FPS * 4} bframes=0 b-adapt=false "
        f"threads={ENC_THREADS} sliced-threads=true "
        f'option-string="scenecut=0:rc-lookahead=0:sync-lookahead=0:slices={ENC_THREADS}"'
    )
    return (
        f"pipewiresrc name=vsrc target-object={VIDEO_NODE} do-timestamp=true keepalive-time=1000 ! "
        "queue name=vq max-size-buffers=1 max-size-time=0 max-size-bytes=0 leaky=downstream ! "
        "videoconvert n-threads=2 ! videoscale ! "
        f"video/x-raw,format=I420,width={WIDTH},height={HEIGHT} ! "
        f"{x264} name=venc ! video/x-h264,profile=constrained-baseline,stream-format=byte-stream ! "
        "rtph264pay name=vpay config-interval=-1 aggregate-mode=zero-latency pt=96 mtu=1200 ! "
        "application/x-rtp,media=video,encoding-name=H264,payload=96,clock-rate=90000 ! webrtc. "
    )


def audio_branch():
    return (
        f"pipewiresrc name=asrc target-object={AUDIO_NODE} do-timestamp=true "
        'stream-properties="props,stream.capture.sink=true" ! '
        "queue max-size-time=40000000 leaky=downstream ! audioconvert ! audioresample ! "
        "audio/x-raw,rate=48000,channels=2 ! "
        "opusenc bitrate=128000 frame-size=10 audio-type=restricted-lowdelay ! "
        "rtpopuspay pt=97 ! application/x-rtp,media=audio,encoding-name=OPUS,payload=97,clock-rate=48000 ! "
        "webrtc. "
    )


class Session:
    def __init__(self, sid, xinput):
        self.sid = sid
        self.xinput = xinput
        self.gamepad = None
        self.channel = None
        self.frames = 0
        self.bytes = 0
        self.enc_ms = []
        self.pending = {}
        desc = "webrtcbin name=webrtc bundle-policy=max-bundle latency=0 " + video_branch()
        if AUDIO:
            desc += audio_branch()
        self.pipe = Gst.parse_launch(desc)
        self.webrtc = self.pipe.get_by_name("webrtc")
        self.restrict_ice()
        self.webrtc.connect("on-negotiation-needed", self.on_negotiation_needed)
        self.webrtc.connect("on-ice-candidate", self.on_ice_candidate)
        self.webrtc.connect("on-data-channel", lambda _w, ch: self.attach_channel(ch))
        self.webrtc.connect("notify::ice-connection-state", self.on_state)
        bus = self.pipe.get_bus()
        bus.add_signal_watch()
        bus.connect("message", self.on_bus)
        venc = self.pipe.get_by_name("venc")
        venc.get_static_pad("sink").add_probe(Gst.PadProbeType.BUFFER, self.probe_in)
        venc.get_static_pad("src").add_probe(Gst.PadProbeType.BUFFER, self.probe_out)

    def restrict_ice(self):
        """Advertise only the wg1 address: candidates and sockets bound to GAMESTREAM_ICE_ADDRESS."""
        if not ICE_ADDRESS:
            return
        ice = self.webrtc.get_property("ice-agent")
        try:
            gi.require_version("Nice", "0.1")
            from gi.repository import Nice

            agent = ice.get_property("agent")
            addr = Nice.Address.new()
            addr.set_from_string(ICE_ADDRESS)
            agent.add_local_address(addr)
            log("ICE bound to", ICE_ADDRESS)
        except Exception as err:  # candidate filtering below still applies
            log("ICE local address not pinned:", err)

    def start(self):
        if self.pipe.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
            send({"type": "error", "id": self.sid, "message": "pipeline failed to start"})
            return
        ch = self.webrtc.emit("create-data-channel", "input", Gst.Structure.new_from_string(
            "options,ordered=true"))
        if ch:
            self.attach_channel(ch)

    def stop(self):
        self.pipe.set_state(Gst.State.NULL)

    # -- signalling ---------------------------------------------------------------------------
    def on_negotiation_needed(self, element):
        promise = Gst.Promise.new_with_change_func(self.on_offer_created, element, None)
        element.emit("create-offer", None, promise)

    def on_offer_created(self, promise, element, _data):
        promise.wait()
        offer = promise.get_reply().get_value("offer")
        element.emit("set-local-description", offer, Gst.Promise.new())
        send({"type": "offer", "id": self.sid, "sdp": offer.sdp.as_text()})

    def on_ice_candidate(self, _element, mline, candidate):
        if ICE_ADDRESS and ICE_ADDRESS not in candidate:
            return
        send({"type": "ice", "id": self.sid, "candidate": candidate, "sdpMLineIndex": mline})

    def set_answer(self, sdp):
        ok, msg = GstSdp.SDPMessage.new_from_text(sdp)
        if ok != GstSdp.SDPResult.OK:
            log("bad answer SDP")
            return
        answer = GstWebRTC.WebRTCSessionDescription.new(GstWebRTC.WebRTCSDPType.ANSWER, msg)
        self.webrtc.emit("set-remote-description", answer, Gst.Promise.new())

    def add_ice(self, candidate, mline):
        if candidate:
            self.webrtc.emit("add-ice-candidate", int(mline or 0), candidate)

    def on_state(self, element, _pspec):
        state = element.get_property("ice-connection-state")
        log("ice", state.value_nick)
        send({"type": "state", "id": self.sid, "ice": state.value_nick})

    def on_bus(self, _bus, message):
        if message.type == Gst.MessageType.ERROR:
            err, dbg = message.parse_error()
            log("error:", err.message, dbg)
            send({"type": "error", "id": self.sid, "message": err.message})
        elif message.type == Gst.MessageType.WARNING:
            warn, _ = message.parse_warning()
            log("warning:", warn.message)

    # -- data channel ---------------------------------------------------------------------------
    def attach_channel(self, ch):
        if self.channel is ch:
            return
        self.channel = ch
        ch.connect("on-message-string", self.on_message)
        ch.connect("on-open", lambda _c: log("data channel open"))

    def on_message(self, ch, text):
        try:
            m = json.loads(text)
        except ValueError:
            return
        t = m.get("t")
        if t == "ping":
            ch.emit("send-string", json.dumps({"t": "pong", "ts": m.get("ts")}))
        elif t == "gp":
            try:
                if self.gamepad is None:
                    self.gamepad = Gamepad()
                self.gamepad.handle(m)
            except Exception as err:
                log("gamepad unavailable:", err)
                self.gamepad = False
        elif self.xinput:
            try:
                self.xinput.handle(m)
            except Exception as err:
                log("input error:", err)

    # -- measurements ----------------------------------------------------------------------------
    def probe_in(self, _pad, info):
        buf = info.get_buffer()
        if buf and buf.pts != Gst.CLOCK_TIME_NONE:
            self.pending[buf.pts] = time.monotonic()
            if len(self.pending) > 240:
                self.pending.clear()
        return Gst.PadProbeReturn.OK

    def probe_out(self, _pad, info):
        buf = info.get_buffer()
        if buf:
            self.frames += 1
            self.bytes += buf.get_size()
            started = self.pending.pop(buf.pts, None)
            if started is not None:
                self.enc_ms.append((time.monotonic() - started) * 1000)
        return Gst.PadProbeReturn.OK

    def stats(self, interval):
        enc = sorted(self.enc_ms)
        out = {
            "type": "stats", "id": self.sid,
            "fps": round(self.frames / interval, 1),
            "kbps": round(self.bytes * 8 / 1000 / interval),
            "encodeMs": round(enc[len(enc) // 2], 1) if enc else None,
            "inputEvents": self.xinput.events if self.xinput else 0,
            "pointer": self.xinput.pointer() if self.xinput else None,
        }
        self.frames = self.bytes = 0
        self.enc_ms = []
        return out


class Sender:
    def __init__(self):
        self.session = None
        self.buffer = b""
        try:
            self.xinput = XInput(X_DISPLAY)
        except Exception as err:
            log("XTest unavailable:", err)
            self.xinput = None
        GLib.io_add_watch(sys.stdin.fileno(), GLib.IO_IN | GLib.IO_HUP, self.on_stdin)
        GLib.timeout_add_seconds(2, self.on_stats)
        send({"type": "ready", "width": WIDTH, "height": HEIGHT, "fps": FPS, "codec": "H264",
              "bitrateKbps": BITRATE, "encoderThreads": ENC_THREADS})

    def on_stdin(self, fd, cond):
        if cond & GLib.IO_HUP:
            loop.quit()
            return False
        chunk = os.read(fd, 65536)
        if not chunk:
            loop.quit()
            return False
        self.buffer += chunk
        while b"\n" in self.buffer:
            line, self.buffer = self.buffer.split(b"\n", 1)
            if line.strip():
                self.dispatch(json.loads(line))
        return True

    def dispatch(self, m):
        t = m.get("type")
        if t == "start":
            if self.session:
                self.session.stop()
            self.session = Session(m.get("id"), self.xinput)
            self.session.start()
        elif not self.session or m.get("id") != self.session.sid:
            return
        elif t == "answer":
            self.session.set_answer(m["sdp"])
        elif t == "ice":
            self.session.add_ice(m.get("candidate"), m.get("sdpMLineIndex"))
        elif t == "stop":
            self.session.stop()
            self.session = None

    def on_stats(self):
        if self.session:
            send(self.session.stats(2))
        return True


loop = GLib.MainLoop()
Sender()
loop.run()
