"""Minimal stdlib WebSocket client (RFC 6455, client side) for the order-flow feeder.

Only what the InsightSentry market-data socket needs: TLS connect + upgrade, masked text frames
out, text / continuation / ping / close frames in, pong replies, a read timeout. No extensions
(no permessage-deflate is offered, so the server sends plain frames).
"""
import base64
import os
import socket
import ssl
import struct
from urllib.parse import urlparse


class WSClosed(Exception):
    pass


class WS:
    def __init__(self, url, timeout=30):
        u = urlparse(url)
        host, port = u.hostname, u.port or (443 if u.scheme == 'wss' else 80)
        raw = socket.create_connection((host, port), timeout=timeout)
        if u.scheme == 'wss':
            raw = ssl.create_default_context().wrap_socket(raw, server_hostname=host)
        self.s = raw
        key = base64.b64encode(os.urandom(16)).decode()
        req = ('GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
               'Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\nUser-Agent: tradezoro-of-feeder/1\r\n\r\n') % (u.path or '/', host, key)
        self.s.sendall(req.encode())
        head = b''
        while b'\r\n\r\n' not in head:
            ch = self.s.recv(4096)
            if not ch:
                raise WSClosed('closed during upgrade')
            head += ch
        line = head.split(b'\r\n', 1)[0]
        if b' 101 ' not in line:
            raise WSClosed('upgrade refused: ' + line.decode('latin-1')[:80])
        self.buf = head.split(b'\r\n\r\n', 1)[1]

    def _read(self, n):
        while len(self.buf) < n:
            ch = self.s.recv(1 << 16)
            if not ch:
                raise WSClosed('eof')
            self.buf += ch
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _send(self, op, data):
        hdr = bytearray([0x80 | op])
        n = len(data)
        if n < 126:
            hdr.append(0x80 | n)
        elif n < 65536:
            hdr.append(0x80 | 126)
            hdr += struct.pack('>H', n)
        else:
            hdr.append(0x80 | 127)
            hdr += struct.pack('>Q', n)
        mask = os.urandom(4)
        hdr += mask
        body = bytes(b ^ mask[i & 3] for i, b in enumerate(data)) if n < 4096 else _xor(data, mask)
        self.s.sendall(bytes(hdr) + body)

    def send(self, text):
        self._send(0x1, text.encode())

    def ping(self):
        self._send(0x9, b'hb')

    def recv(self):
        """The next text message (str). Answers pings; raises WSClosed on close; socket.timeout passes up."""
        parts = []
        while True:
            b0, b1 = self._read(2)
            op, fin, n = b0 & 0x0f, b0 & 0x80, b1 & 0x7f
            if n == 126:
                n = struct.unpack('>H', self._read(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', self._read(8))[0]
            if b1 & 0x80:
                mask = self._read(4)
                data = _xor(self._read(n), mask)
            else:
                data = self._read(n)
            if op == 0x9:
                self._send(0xA, data)
                continue
            if op == 0xA:
                continue
            if op == 0x8:
                code = struct.unpack('>H', data[:2])[0] if len(data) >= 2 else 0
                raise WSClosed('close %d %s' % (code, data[2:120].decode('utf-8', 'replace')))
            parts.append(data)
            if fin:
                return b''.join(parts).decode('utf-8', 'replace')

    def close(self):
        try:
            self._send(0x8, struct.pack('>H', 1000))
        except Exception:
            pass
        try:
            self.s.close()
        except Exception:
            pass


def _xor(data, mask):
    m = int.from_bytes(mask * ((len(data) + 3) // 4), 'little')
    x = int.from_bytes(data, 'little') ^ (m & ((1 << (8 * len(data))) - 1))
    return x.to_bytes(len(data), 'little')
