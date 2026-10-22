#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# A virtual Xbox 360 style gamepad through /dev/uinput, for testing the frontend with Chrome's real Gamepad
# stack. Needs write access to /dev/uinput (root, or the `input` group). It reads commands, one per line, from
# the FIFO given as the first argument:   down A | up A | tap A | axis X 20000 | hat X -1 | quit
# Buttons: A B X Y LB RB SELECT START MODE L3 R3. Axes: X Y Z RX RY RZ. Hats: X Y (-1, 0, 1).
# With --acl <user> it grants that user rw on the new /dev/input nodes (they vanish with the device).
import fcntl, os, struct, subprocess, sys, time

UI_SET_EVBIT, UI_SET_KEYBIT, UI_SET_ABSBIT = 0x40045564, 0x40045565, 0x40045567
UI_DEV_CREATE, UI_DEV_DESTROY = 0x5501, 0x5502
EV_SYN, EV_KEY, EV_ABS = 0, 1, 3
BUTTONS = {"A": 0x130, "B": 0x131, "X": 0x133, "Y": 0x134, "LB": 0x136, "RB": 0x137, "SELECT": 0x13A, "START": 0x13B, "MODE": 0x13C, "L3": 0x13D, "R3": 0x13E}
AXES = {"X": 0, "Y": 1, "Z": 2, "RX": 3, "RY": 4, "RZ": 5}
HATS = {"X": 0x10, "Y": 0x11}

fifo = sys.argv[1]
acl = sys.argv[sys.argv.index("--acl") + 1] if "--acl" in sys.argv else None
fd = os.open("/dev/uinput", os.O_WRONLY | os.O_NONBLOCK)
fcntl.ioctl(fd, UI_SET_EVBIT, EV_KEY)
fcntl.ioctl(fd, UI_SET_EVBIT, EV_ABS)
for code in BUTTONS.values():
    fcntl.ioctl(fd, UI_SET_KEYBIT, code)
for code in [*AXES.values(), *HATS.values()]:
    fcntl.ioctl(fd, UI_SET_ABSBIT, code)
absmax, absmin = [0] * 64, [0] * 64
for code in AXES.values():
    absmin[code], absmax[code] = -32768, 32767
for code in (2, 5):  # triggers
    absmin[code], absmax[code] = 0, 255
for code in HATS.values():
    absmin[code], absmax[code] = -1, 1
dev = struct.pack("80sHHHHi", b"Microsoft X-Box 360 pad", 3, 0x045E, 0x028E, 0x0110, 0) + struct.pack("64i", *absmax) + struct.pack("64i", *absmin) + struct.pack("64i", *[0] * 64) + struct.pack("64i", *[0] * 64)
os.write(fd, dev)
fcntl.ioctl(fd, UI_DEV_CREATE)
time.sleep(1.0)
nodes = []
text = open("/proc/bus/input/devices").read().split("\n\n")
for block in text:
    if "Microsoft X-Box 360 pad" in block and "Handlers=" in block:
        handlers = [h for h in block.split("Handlers=")[1].split("\n")[0].split() if h.startswith(("event", "js"))]
        nodes = ["/dev/input/" + h for h in handlers]
print("nodes:", " ".join(nodes), flush=True)
if acl:
    subprocess.run(["setfacl", "-m", f"u:{acl}:rw", *nodes], check=True)

def emit(kind, code, value):
    os.write(fd, struct.pack("llHHi", 0, 0, kind, code, value))
    os.write(fd, struct.pack("llHHi", 0, 0, EV_SYN, 0, 0))

with open(fifo) as commands:
    while True:
        line = commands.readline()
        if not line:
            time.sleep(0.05)
            continue
        part = line.split()
        if not part:
            continue
        if part[0] == "quit":
            break
        if part[0] in ("down", "up"):
            emit(EV_KEY, BUTTONS[part[1]], 1 if part[0] == "down" else 0)
        elif part[0] == "tap":
            emit(EV_KEY, BUTTONS[part[1]], 1)
            time.sleep(0.2)
            emit(EV_KEY, BUTTONS[part[1]], 0)
        elif part[0] == "axis":
            emit(EV_ABS, AXES[part[1]], int(part[2]))
        elif part[0] == "hat":
            emit(EV_ABS, HATS[part[1]], int(part[2]))
        print("ok", line.strip(), flush=True)
fcntl.ioctl(fd, UI_DEV_DESTROY)
os.close(fd)
