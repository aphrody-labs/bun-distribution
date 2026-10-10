#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Read-only tunnel proof plus an ephemeral event; never prints authentication material."""
import argparse
import json
import socket
import statistics
import time
import uuid
from pathlib import Path


class Rpc:
    def __init__(self, sock):
        self.sock = sock
        self.sock.settimeout(10)
        self.reader = sock.makefile('rb')
        self.sequence = 0

    def send(self, method, params, request=True):
        message = {'jsonrpc': '2.0', 'method': method, 'params': params}
        if request:
            self.sequence += 1
            message['id'] = self.sequence
        self.sock.sendall(json.dumps(message).encode() + b'\n')
        return self.sequence

    def read(self):
        line = self.reader.readline(16 * 1024 * 1024 + 1)
        if not line or len(line) > 16 * 1024 * 1024:
            raise RuntimeError('closed or oversized RPC frame')
        return json.loads(line)

    def request(self, method, params):
        ident = self.send(method, params)
        while True:
            message = self.read()
            if message.get('id') == ident and 'method' not in message:
                if 'error' in message:
                    raise RuntimeError(message['error']['message'])
                return message['result']

    def initialize(self, token=None):
        params = {'protocolVersion': '2025-03-26', 'capabilities': {},
                  'clientInfo': {'name': 'host-bridge-audit', 'version': '1'}}
        if token:
            params['authToken'] = token
        self.request('initialize', params)
        self.send('notifications/initialized', {}, False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=Path.home() / '.config/aphrody/host-bridge/windows.json')
    parser.add_argument('--endpoint', default=f'/run/user/{__import__("os").getuid()}/aphrody-os.sock')
    parser.add_argument('--samples', type=int, default=100)
    args = parser.parse_args()
    if not 1 <= args.samples <= 10000:
        parser.error('samples must be between 1 and 10000')
    config = json.loads(args.config.read_text())
    host_sock = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
    host_sock.connect((socket.VMADDR_CID_HOST, config['port']))
    host = Rpc(host_sock)
    host.initialize(config['token'])
    durations = []
    for _ in range(args.samples):
        start = time.perf_counter_ns()
        host.request('ping', {})
        durations.append((time.perf_counter_ns() - start) / 1e6)
    ready_until = time.monotonic() + 10
    while not any(t['name'] == 'linux_nu_eval' for t in host.request('tools/list', {})['tools']):
        if time.monotonic() >= ready_until:
            raise RuntimeError('Linux catalog has not registered on the host')
        time.sleep(0.1)
    reverse = host.request('tools/call', {'name': 'linux_nu_eval', 'arguments': {'code': 'sys host | get name'}})
    if reverse.get('isError'):
        raise RuntimeError('reverse Linux call failed')
    host.request('system/subscribe', {})
    guest_sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    guest_sock.connect(args.endpoint)
    guest = Rpc(guest_sock)
    guest.initialize()
    guest.request('system/subscribe', {})
    kind = 'audit.' + uuid.uuid4().hex
    guest.request('system/publish', {'kind': kind, 'payload': {'ephemeral': True}})
    deadline = time.monotonic() + 10
    event_seen = False
    while time.monotonic() < deadline:
        message = host.read()
        if message.get('method') == 'system/event' and message.get('params', {}).get('kind') == 'bridge.linux.' + kind:
            event_seen = True
            break
    if not event_seen:
        raise RuntimeError('guest-to-host event did not arrive')
    host_kind = 'audit.' + uuid.uuid4().hex
    host.request('system/publish', {'kind': host_kind, 'payload': {'ephemeral': True}})
    deadline = time.monotonic() + 10
    reverse_event_seen = False
    while time.monotonic() < deadline:
        message = guest.read()
        if message.get('method') == 'system/event' and message.get('params', {}).get('kind') == 'bridge.windows.' + host_kind:
            reverse_event_seen = True
            break
    if not reverse_event_seen:
        raise RuntimeError('host-to-guest event did not arrive')
    rejected = False
    bad_sock = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
    bad_sock.connect((socket.VMADDR_CID_HOST, config['port']))
    try:
        Rpc(bad_sock).initialize('invalid-audit-token')
    except RuntimeError:
        rejected = True
    finally:
        bad_sock.close()
    if not rejected:
        raise RuntimeError('invalid authentication token was accepted')
    ordered = sorted(durations)
    print(json.dumps({'samples': len(durations), 'medianMs': statistics.median(durations),
                      'p95Ms': ordered[min(len(ordered)-1, int(len(ordered)*0.95))],
                      'maxMs': max(durations), 'reverseLinuxCall': reverse.get('structuredContent'),
                      'guestToHostEvent': event_seen, 'hostToGuestEvent': reverse_event_seen,
                      'invalidTokenRejected': rejected}, indent=2))


if __name__ == '__main__':
    main()
