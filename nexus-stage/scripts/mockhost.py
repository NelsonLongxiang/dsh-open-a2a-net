"""Standalone mock host for the nexus stage - the standing smoke artifact.

Serves the built stage (assets/nexusDist) plus canned /__dsh_a2a endpoints so
both proof scenes are plain openable URLs, no browser automation required:

  http://127.0.0.1:<port>/            healthy (canned live-shaped state)
  http://127.0.0.1:<port>/?fault=500  state answers 500 -> on-page fault badge

Usage: python scripts/mockhost.py [port]        (default 8780)
State source: LIVE_STATE env, else http://127.0.0.1:3080/__dsh_a2a/state, with
a graceful empty-fleet fallback so offline dev still boots.
"""
import functools
import json
import os
import sys
import urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8780
DIST = Path(__file__).resolve().parents[2] / 'assets' / 'nexusDist'
LIVE = os.environ.get('LIVE_STATE', 'http://127.0.0.1:3080/__dsh_a2a/state')


def fetch_state() -> bytes:
    try:
        return urllib.request.urlopen(LIVE, timeout=5).read()
    except Exception:  # noqa: BLE001 - offline dev must still boot
        return json.dumps({'sessions': [], 'canvas': {'teams': []}, 'peers': []}).encode()


state_bytes = fetch_state()
# The layout store starts absent and remembers saves in memory only - the
# mock exists to exercise the stage's save loop (lamp ladder), not to be a
# second implementation of the host's clamp (the stage normalizes on GET).
layout_store = {'doc': None}


class MockHost(SimpleHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 - stdlib signature
        path, _, query = self.path.partition('?')
        referer = self.headers.get('Referer') or ''
        faulted = 'fault' in query or 'fault' in referer
        if path == '/__dsh_a2a/state':
            if faulted:
                self._json(b'{"ok":false,"error":"injected fault"}', status=500)
            else:
                self._json(state_bytes)
        elif path == '/__dsh_a2a/canvas-layout':
            self._json(json.dumps({'ok': True, 'layout': layout_store['doc']}).encode())
        else:
            super().do_GET()

    def do_POST(self):  # noqa: N802 - stdlib signature
        path, _, query = self.path.partition('?')
        referer = self.headers.get('Referer') or ''
        faulted = 'fault' in query or 'fault' in referer
        if path != '/__dsh_a2a/canvas-layout':
            self._json(b'{"ok":false,"error":"unknown route"}', status=404)
            return
        try:
            length = int(self.headers.get('Content-Length') or 0)
            body = json.loads(self.rfile.read(length) or b'{}')
        except Exception:  # noqa: BLE001 - malformed body mirrors the host 400
            self._json(b'{"ok":false,"error":"malformed body"}', status=400)
            return
        if faulted:
            self._json(b'{"ok":false,"error":"injected fault"}', status=500)
            return
        action = body.get('action')
        if action == 'reset':
            layout_store['doc'] = None
            self._json(b'{"ok":true,"layout":null}')
        elif action == 'save':
            layout_store['doc'] = body.get('layout')
            self._json(json.dumps({'ok': True, 'layout': layout_store['doc']}).encode())
        else:
            self._json(b'{"ok":false,"error":"unknown action"}')

    def _json(self, payload: bytes, status: int = 200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):  # keep the console readable
        pass


handler = functools.partial(MockHost, directory=str(DIST))
print(f'mock host on http://127.0.0.1:{PORT}/  (dist: {DIST})', flush=True)
ThreadingHTTPServer(('127.0.0.1', PORT), handler).serve_forever()
