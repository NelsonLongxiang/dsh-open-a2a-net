"""Standalone mock host for the nexus stage - the standing smoke artifact.

Serves the built stage (assets/nexusDist) plus canned /__dsh_a2a endpoints so
both proof scenes are plain openable URLs, no browser automation required:

  http://127.0.0.1:<port>/            healthy (canned live-shaped state)
  http://127.0.0.1:<port>/?fault=500  state answers 500 -> on-page fault badge
  http://127.0.0.1:<port>/?demo=1     state merges a demo federation dataset
                                      (2 peers + 2 inFlight routes) so the PR D
                                      activity/federal layers stay demonstrable
                                      offline and on fleets with no live routes

Usage: python scripts/mockhost.py [port]        (default 8780)
State source: LIVE_STATE env, else http://127.0.0.1:3080/__dsh_a2a/state, with
a graceful empty-fleet fallback so offline dev still boots.
"""
import functools
import json
import os
import sys
import time
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
# Optional on-disk persistence: set LAYOUT_FILE=<path> so the layout
# survives mock-host restarts (the in-memory default wipes on exit).
# Corrupt files are treated as absent - presentation state only.
LAYOUT_FILE = os.environ.get('LAYOUT_FILE', '')


def layout_load():
    if not LAYOUT_FILE or not os.path.exists(LAYOUT_FILE):
        return None
    try:
        with open(LAYOUT_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:  # noqa: BLE001 - corrupt layout is presentation loss only
        return None


def layout_persist(doc):
    if not LAYOUT_FILE:
        return
    try:
        fd = os.open(LAYOUT_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write('' if doc is None else json.dumps(doc))
    except OSError:
        pass


layout_store = {'doc': None}

# ── canvas store (PR C): mutable teams, mirrored shapes from src/canvas-store.ts,
# so team writes are visible on the NEXT POLL (state is regenerated per request
# from this store - a startup snapshot would hide every write). ──
CANVAS_NAME_MAX = 40
CANVAS_TEAM_CAP = 64
CANVAS_MEMBER_CAP = 32

_BASE = json.loads(state_bytes)
member_rows = {}  # id -> rich member row captured from the snapshot
joined_ids = {s.get('id') for s in _BASE.get('sessions', []) if isinstance(s, dict)}
teams = {}  # name -> [member ids], order = routing priority
host_prefix = 'dsh'
for _t in _BASE.get('canvas', {}).get('teams', []):
    teams[_t['name']] = [m['id'] for m in _t.get('members', [])]
    for _m in _t.get('members', []):
        member_rows[_m['id']] = _m
        _p = _m.get('team', '').split('/')[0]
        if _p:
            host_prefix = _p
            break


def valid_name(raw):
    """Mirror of canvas-store.validName: trim, 1..40, no '/', not pure digits."""
    if not isinstance(raw, str):
        return None
    name = raw.strip()
    if name == '' or len(name) > CANVAS_NAME_MAX or '/' in name or name.isdigit():
        return None
    return name


# ── demo federation dataset (PR D): merged into /__dsh_a2a/state only when the
# request carries demo=1 (query or Referer), so the activity/federal layers are
# demonstrable offline and on live fleets that have no in-flight routes. ──
DEMO_PEERS = [
    {'url': 'http://192.168.3.88:3080', 'score': 42},
    {'url': 'http://10.0.0.7:13080', 'score': 17},
]


def build_state(demo: bool = False) -> bytes:
    """The snapshot with canvas.teams regenerated from the mutable store."""
    state = dict(_BASE)
    team_rows = []
    for name, ids in teams.items():
        members = []
        for mid in ids:
            row = member_rows.get(mid)
            if row is None:
                row = {'id': mid, 'team': f'{host_prefix}/{mid[:8]}', 'joined': True, 'live': True}
                member_rows[mid] = row
            members.append(row)
        team_rows.append({'name': name, 'team': f'{host_prefix}/canvas/{name}', 'members': members})
    state['canvas'] = {'teams': team_rows}
    if demo:
        # fresh list copies - _BASE's own peers must stay untouched
        state['peers'] = list(state.get('peers') or []) + [dict(p) for p in DEMO_PEERS]
        names = [row['name'] for row in team_rows]
        first = names[0] if names else 'dsh'
        second = names[1] if len(names) > 1 else first
        now_ms = int(time.time() * 1000)
        state['inFlight'] = [
            {'team': first, 'peer': '192.168.3.88:3080', 'startedAt': now_ms - 12000},
            {'team': second, 'peer': '10.0.0.7:13080', 'startedAt': now_ms - 45000},
        ]
    return json.dumps(state).encode()


class MockHost(SimpleHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 - stdlib signature
        path, _, query = self.path.partition('?')
        referer = self.headers.get('Referer') or ''
        faulted = 'fault' in query or 'fault' in referer
        demo = 'demo=1' in query or 'demo=1' in referer
        if path == '/__dsh_a2a/state':
            if faulted:
                self._json(b'{"ok":false,"error":"injected fault"}', status=500)
            else:
                self._json(build_state(demo))  # regenerated: canvas writes stay visible
        elif path == '/__dsh_a2a/canvas-layout':
            doc = layout_load() if LAYOUT_FILE else layout_store['doc']
            self._json(json.dumps({'ok': True, 'layout': doc}).encode())
        else:
            super().do_GET()

    def do_POST(self):  # noqa: N802 - stdlib signature
        path, _, query = self.path.partition('?')
        referer = self.headers.get('Referer') or ''
        faulted = 'fault' in query or 'fault' in referer
        if path not in ('/__dsh_a2a/canvas-layout', '/__dsh_a2a/canvas'):
            self._json(b'{"ok":false,"error":"unknown route"}', status=404)
            return
        try:
            length = int(self.headers.get('Content-Length') or 0)
            raw = self.rfile.read(length) or b'{}'
            if b'\xef\xbf\xbd' in raw:  # U+FFFD guard, same as the host's text-guard
                self._json(b'{"error": "text contains undecodable characters (U+FFFD) '
                           b'\xe2\x80\x94 fix the sender encoding and retry", "code": -32005}', status=422)
                return
            body = json.loads(raw)
        except Exception:  # noqa: BLE001 - malformed body mirrors the host 400
            self._json(b'{"ok":false,"error":"malformed body"}', status=400)
            return
        if faulted:
            self._json(b'{"ok":false,"error":"injected fault"}', status=500)
            return
        action = body.get('action')
        if path == '/__dsh_a2a/canvas-layout':
            self._canvas_layout(action, body)
        else:
            self._canvas(action, body)

    def _canvas_layout(self, action, body):
        if action == 'reset':
            layout_store['doc'] = None
            layout_persist(None)
            self._json(b'{"ok":true,"layout":null}')
        elif action == 'save':
            layout_store['doc'] = body.get('layout')
            layout_persist(layout_store['doc'])
            self._json(json.dumps({'ok': True, 'layout': layout_store['doc']}).encode())
        else:
            self._json(b'{"ok":false,"error":"unknown action"}')

    def _canvas(self, action, body):
        if action == 'create':
            name = valid_name(body.get('name'))
            if name is None or (name not in teams and len(teams) >= CANVAS_TEAM_CAP):
                self._json(b'{"ok":false,"error":"invalid name or team cap reached"}')
            else:
                teams.setdefault(name, [])
                self._json(json.dumps({'ok': True, 'name': name, 'teams': list(teams)}).encode())
        elif action == 'remove':
            name = body.get('name')
            teams.pop(name, None)
            self._json(json.dumps({'ok': True, 'teams': list(teams)}).encode())
        elif action == 'add-member':
            name = valid_name(body.get('name'))
            mid = body.get('id')
            if name is None or not isinstance(mid, str) or mid not in joined_ids:
                self._json(b'{"ok":false,"error":"name and a joined session id are required"}')
                return
            roster = teams.setdefault(name, [])
            if mid in roster:
                self._json(json.dumps({'ok': True, 'teams': list(teams), 'members': list(roster)}).encode())
            elif len(roster) >= CANVAS_MEMBER_CAP:
                self._json(json.dumps({'ok': False, 'teams': list(teams), 'members': list(roster)}).encode())
            else:
                roster.append(mid)
                self._json(json.dumps({'ok': True, 'teams': list(teams), 'members': list(roster)}).encode())
        elif action == 'remove-member':
            name = body.get('name')
            mid = body.get('id')
            if not isinstance(name, str) or not name.strip() or not isinstance(mid, str):
                self._json(b'{"ok":false,"error":"name and id are required"}')
                return
            roster = teams.get(name)
            if roster is None:
                self._json(json.dumps({'ok': False, 'teams': list(teams), 'members': []}).encode())
            elif mid in roster:
                roster.remove(mid)
                self._json(json.dumps({'ok': True, 'teams': list(teams), 'members': list(roster)}).encode())
            else:
                self._json(json.dumps({'ok': False, 'teams': list(teams), 'members': list(roster)}).encode())
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
