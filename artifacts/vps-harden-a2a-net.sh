#!/usr/bin/env bash
# Harden the standalone a2a-net serve node on this Debian 12 VPS and put
# nginx + certbot in front of it.
#
#   ssh root@38.209.68.244 'ROTATE_KEY=1 bash /root/vps-harden-a2a-net.sh'
#
# Upstream is always http://38.209.68.244:3080. Never 127.0.0.1:3080:
# src/faces/admin.ts injects window.__DSH_A2A_KEY__ when the TCP peer is
# loopback (controlTrustedWithoutKey in src/index.ts).
#
# If xray Reality is listening on 443 the script does not kill it and does
# not bind nginx there. Pick one:
#   EDGE_MODE=move   Reality already moved off public 443; nginx owns 443
#   EDGE_MODE=sni    TLS ClientHello split: this domain → nginx, else → xray
# See artifacts/DEPLOY-HTTPS.md.
#
# Local checks (no root):  bash artifacts/vps-harden-a2a-net.sh --self-test
set -euo pipefail

if [[ $- == *x* ]]; then
  echo "[a2a-edge] refusing to run under xtrace (set -x would expose the apiKey)" >&2
  exit 1
fi

DOMAIN="${A2A_DOMAIN:-a2a-net-zxchkjzgsajdgas.sindox.top}"
ORIGIN_URL="https://${DOMAIN}"
NIC_IP="${A2A_NIC_IP:-38.209.68.244}"
LISTEN_PORT="${A2A_PORT:-3080}"
A2A_ROOT="${A2A_ROOT:-/opt/a2a-net}"
NODE_JSON="${A2A_ROOT}/node.json"
UNIT="${A2A_UNIT:-a2a-net.service}"
PKG="@nelsonlongxiang/dsh-open-a2a-net"
PKG_DIR="${A2A_ROOT}/node_modules/@nelsonlongxiang/dsh-open-a2a-net"
KEY_FILE="${A2A_ROOT}/api-key"
KEY_MARKER="${A2A_ROOT}/.dedicated-edge-key"
NGINX_TLS_PORT="${NGINX_TLS_PORT:-8443}"
XRAY_LOCAL_PORT="${XRAY_LOCAL_PORT:-2443}"
SITE_NAME="a2a-net.conf"
SITE_AVAIL="/etc/nginx/sites-available/${SITE_NAME}"
SITE_LINK="/etc/nginx/sites-enabled/${SITE_NAME}"
STREAM_AVAIL="/etc/nginx/stream-available/a2a-reality-sni.conf"
STREAM_LINK_DIR="/etc/nginx/stream-enabled"
ACME_WEBROOT="/var/www/a2a-net"
EDGE_MODE="${EDGE_MODE:-auto}"
ROTATE_KEY="${ROTATE_KEY:-0}"

log() { printf '[a2a-edge] %s\n' "$*"; }
die() { printf '[a2a-edge] %s\n' "$*" >&2; exit 1; }
pending() { printf '[a2a-edge] %s\n' "$*" >&2; exit 2; }

HELPER="$(mktemp)"
trap 'rm -f "$HELPER"' EXIT
cat > "$HELPER" <<'PY'
import json, os, re, subprocess, sys, tempfile, time
from pathlib import Path

DOMAIN = os.environ.get("A2A_DOMAIN", "a2a-net-zxchkjzgsajdgas.sindox.top")
NIC_IP = os.environ.get("A2A_NIC_IP", "38.209.68.244")
LISTEN_PORT = os.environ.get("A2A_PORT", "3080")
ORIGIN = "https://" + DOMAIN
TLS_PORT = os.environ.get("NGINX_TLS_PORT", "8443")
XRAY_PORT = os.environ.get("XRAY_LOCAL_PORT", "2443")
WEBROOT = os.environ.get("A2A_WEBROOT", "/var/www/a2a-net")
IPV6 = os.environ.get("A2A_IPV6", "1") == "1"

HEADER = """# a2a-net-edge
# Rewritten by vps-harden-a2a-net.sh.
# Upstream is the NIC address http://{nic}:{port}.
# Never use the loopback address for that upstream. src/faces/admin.ts injects
# window.__DSH_A2A_KEY__ when the TCP peer is loopback (controlTrustedWithoutKey
# in src/index.ts), which would put the apiKey in the public workbench HTML.
# proxy_pass has no URI path, so nginx forwards the request path unchanged.
# OriginClaim Sig2/Sig3 sign method + path
# (docs/protocol/delivery-origin-auth.md). A trailing slash on proxy_pass
# would rewrite that path.
# client_max_body_size 64m matches BLOB_FILE_MAX in src/blob-store.ts.
# proxy_read_timeout 1800s matches the routeTimeoutMs default in src/config.ts.
""".format(nic=NIC_IP, port=LISTEN_PORT)

def listen(addr, extra=""):
    suffix = (" " + extra) if extra else ""
    return "\tlisten %s%s;" % (addr, suffix)

def v4_v6(v4, v6, extra=""):
    lines = [listen(v4, extra)]
    if IPV6:
        lines.append(listen(v6, extra))
    return "\n".join(lines)

def upstream_block():
    return (
        "upstream a2a_net_node {\n"
        "\tserver %s:%s;\n"
        "\tkeepalive 32;\n"
        "}\n" % (NIC_IP, LISTEN_PORT)
    )

def http_server():
    return """server {
%s
	server_name %s;

	location ^~ /.well-known/acme-challenge/ {
		root %s;
		default_type text/plain;
	}

	location / {
		return 301 https://$host$request_uri;
	}
}""" % (v4_v6("80", "[::]:80"), DOMAIN, WEBROOT)

def tls_server(addresses):
    cert = "/etc/letsencrypt/live/%s/fullchain.pem" % DOMAIN
    key = "/etc/letsencrypt/live/%s/privkey.pem" % DOMAIN
    return """server {
%s
	server_name %s;

	ssl_certificate     %s;
	ssl_certificate_key %s;
	ssl_session_timeout 1d;
	ssl_session_cache shared:a2a_ssl:10m;
	ssl_protocols TLSv1.2 TLSv1.3;

	server_tokens off;
	client_max_body_size 64m;
	add_header Strict-Transport-Security "max-age=86400" always;

	location / {
		proxy_pass http://a2a_net_node;
		proxy_http_version 1.1;
		proxy_redirect off;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto https;
		proxy_set_header Connection "";
		proxy_connect_timeout 5s;
		proxy_send_timeout 1800s;
		proxy_read_timeout 1800s;
	}
}""" % (addresses, DOMAIN, cert, key)

def render_site(kind):
    parts = [HEADER.rstrip(), ""]
    if kind == "http":
        parts.append(http_server())
    elif kind == "move":
        parts.append(upstream_block())
        parts.append(http_server())
        parts.append(tls_server(v4_v6("443", "[::]:443", "ssl http2")))
    elif kind == "sni":
        parts.append("# 127.0.0.1:%s is nginx terminating TLS for this domain." % TLS_PORT)
        parts.append("# It is not a2a-net. a2a-net is upstream a2a_net_node (the NIC).")
        parts.append(upstream_block())
        parts.append(http_server())
        parts.append(tls_server(v4_v6("127.0.0.1:%s" % TLS_PORT, "[::1]:%s" % TLS_PORT, "ssl http2")))
    else:
        raise SystemExit("unknown site kind " + kind)
    return "\n\n".join(parts) + "\n"

def render_stream():
    text = """# a2a-net-edge-stream
# SNI split in front of Xray Reality. Raw TCP: this block does not terminate TLS
# and does not speak HTTP to a2a-net. The named domain goes to nginx on
# 127.0.0.1:%s; that http server's proxy_pass uses the NIC upstream.
# Every other SNI, including clients that send none, goes to Xray Reality on
# 127.0.0.1:%s. Reality serverNames must not include %s.
# Do not enable proxy_protocol; both upstreams expect the original ClientHello.

map $ssl_preread_server_name $a2a_sni_upstream {
	%s a2a_nginx_tls;
	default xray_reality;
}

upstream a2a_nginx_tls {
	server 127.0.0.1:%s;
}

upstream xray_reality {
	server 127.0.0.1:%s;
}

server {
%s
	ssl_preread on;
	proxy_pass $a2a_sni_upstream;
	proxy_connect_timeout 5s;
	proxy_timeout 1800s;
}
""" % (
        TLS_PORT, XRAY_PORT, DOMAIN,
        DOMAIN, TLS_PORT, XRAY_PORT, v4_v6("443", "[::]:443"),
    )
    return text if text.endswith("\n") else text + "\n"

def assert_safe(text, kind):
    if "127.0.0.1:%s" % LISTEN_PORT in text or "localhost:%s" % LISTEN_PORT in text:
        raise SystemExit("config routes loopback to a2a-net port %s" % LISTEN_PORT)
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("proxy_pass") and "127.0.0.1" in stripped:
            raise SystemExit("proxy_pass targets loopback: " + stripped)
        if stripped.startswith("proxy_pass") and stripped.endswith("/;") and "a2a_net_node" in stripped:
            raise SystemExit("proxy_pass URI would rewrite the OriginClaim path")
    if kind == "stream":
        if re.search(r":%s\b" % LISTEN_PORT, text):
            raise SystemExit("stream config must not mention a2a-net port %s" % LISTEN_PORT)
        if "ssl_preread on;" not in text:
            raise SystemExit("stream config missing ssl_preread")
    if kind in ("move", "sni"):
        if "server %s:%s;" % (NIC_IP, LISTEN_PORT) not in text:
            raise SystemExit("site is missing the NIC upstream")
        if "proxy_pass http://a2a_net_node;" not in text:
            raise SystemExit("site proxy_pass must be the bare upstream name")
        if "http2 on;" in text:
            raise SystemExit("Debian 12 nginx 1.22 rejects 'http2 on;' — use listen ... ssl http2")

def key_gate(rotate, marker):
    if rotate == "1":
        return "rotate"
    if marker == "1":
        return "keep"
    return "refuse"

def classify_listeners(ss_text):
    names = []
    rows = 0
    for line in ss_text.splitlines():
        if not line.strip() or line.startswith("State") or line.startswith("Netid"):
            continue
        rows += 1
        found = re.findall(r'\(\("([^"]+)"', line)
        names.extend(found if found else ["unknown"])
    if rows == 0:
        return "free"
    if names and all(n == "nginx" or n.startswith("nginx:") for n in names):
        return "nginx"
    return "foreign:" + ",".join(names)

def local_addrs(ss_text):
    addrs = []
    for line in ss_text.splitlines():
        parts = line.split()
        if len(parts) >= 4 and parts[0] in ("LISTEN", "tcp", "tcp6"):
            addrs.append(parts[3])
    return addrs

def xray_local_ok(ss_text, port):
    addrs = local_addrs(ss_text)
    loop = {"127.0.0.1:%s" % port, "[::1]:%s" % port}
    public = {"0.0.0.0:%s" % port, "*:%s" % port, "[::]:%s" % port, "*: %s" % port}
    if any(a in public or a.endswith(":%s" % port) and not (a.startswith("127.") or a.startswith("[::1]")) for a in addrs):
        # A non-loopback bind of the Reality fallback port is public. Reject.
        non_loop = [a for a in addrs if a.endswith(":%s" % port) and not (a.startswith("127.") or a.startswith("[::1]"))]
        if non_loop:
            return "public:" + ",".join(non_loop)
    if any(a in loop for a in addrs):
        return "ok"
    return "down"

def next_3080(status):
    for line in status.splitlines():
        m = re.match(r"\[\s*(\d+)\]\s+(.*)", line)
        if m and re.search(r"\b3080\b", m.group(2)):
            return m.group(1)
    return ""

def public_3080(status):
    for line in status.splitlines():
        if "3080" in line and "ALLOW" in line and "Anywhere" in line:
            return True
    return False

def incoming_policy(status):
    m = re.search(r"Default:\s*(\w+)\s*\(incoming\)", status)
    return m.group(1) if m else ""

def execstart_flags(text):
    host = port = None
    hm = re.findall(r"--host(?:=|\s+)(\S+)", text)
    pm = re.findall(r"--port(?:=|\s+)(\S+)", text)
    if hm:
        host = hm[-1].rstrip(";")
    if pm:
        port = pm[-1].rstrip(";")
    return host, port

def execstart_conflicts(text, port):
    host, got = execstart_flags(text)
    if host not in (None, "0.0.0.0"):
        return True
    if got not in (None, str(port)):
        return True
    return False

def node_bin(text):
    m = re.search(r"\bpath=([^ ;\n]+)", text)
    if m and m.group(1).endswith("node"):
        return m.group(1)
    return ""

def patch_node():
    path = Path(os.environ["A2A_NODE_JSON"])
    origin = os.environ["A2A_ORIGIN_URL"].rstrip("/")
    if not origin.startswith("https://") or origin.endswith("/"):
        raise SystemExit("originClaimUrl must be https with no trailing slash")
    port = int(os.environ["A2A_PORT"])
    home_default = os.environ["A2A_HOME_DEFAULT"]
    rotate = os.environ.get("A2A_DO_ROTATE", "0") == "1"
    key_file = Path(os.environ["A2A_KEY_FILE"])
    marker = Path(os.environ["A2A_KEY_MARKER"])
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise SystemExit("node.json must be a JSON object")
    stamp = time.strftime("%Y%m%d%H%M%S")
    backup = path.with_name(path.name + ".bak." + stamp)
    if backup.exists():
        backup = path.with_name(path.name + ".bak." + stamp + "." + str(os.getpid()))
    backup.write_text(raw, encoding="utf-8")
    os.chmod(backup, 0o600)
    data["host"] = "0.0.0.0"
    data["port"] = port
    data["originClaimUrl"] = origin
    data["originClaimWindow"] = False
    if not isinstance(data.get("dshHome"), str) or data["dshHome"].strip() == "":
        data["dshHome"] = home_default
    existing = data.get("apiKey")
    existing = existing.strip() if isinstance(existing, str) else ""
    wrote = False
    if rotate or existing == "":
        key = subprocess.check_output(["openssl", "rand", "-hex", "32"], text=True).strip()
        if len(key) != 64 or any(c not in "0123456789abcdef" for c in key):
            raise SystemExit("openssl rand -hex 32 returned an unexpected token")
        data["apiKey"] = key
        key_file.write_text(key + "\n", encoding="utf-8")
        os.chmod(key_file, 0o600)
        marker.write_text("dedicated " + time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + "\n", encoding="utf-8")
        os.chmod(marker, 0o600)
        wrote = True
        del key
    else:
        data["apiKey"] = existing
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
    os.chmod(path, 0o600)
    redacted = {
        "host": data["host"],
        "port": data["port"],
        "originClaimUrl": data["originClaimUrl"],
        "originClaimWindow": data["originClaimWindow"],
        "dshHome": data["dshHome"],
        "peers": data.get("peers", []),
        "apiKey": "<set len=%d %s>" % (len(data["apiKey"]), "rotated" if wrote else "kept"),
    }
    print(json.dumps(redacted, indent=2))

def authed_curl():
    url = os.environ["A2A_CURL_URL"]
    body_path = os.environ["A2A_CURL_BODY"]
    key = json.loads(Path(os.environ["A2A_NODE_JSON"]).read_text(encoding="utf-8"))["apiKey"]
    cfg = Path("/tmp") / ("a2a-curl-%d.cfg" % os.getpid())
    cfg.write_text('header = "X-API-Key: %s"\nsilent\nshow-error\n' % key, encoding="utf-8")
    os.chmod(cfg, 0o600)
    try:
        proc = subprocess.run(
            ["curl", "-sS", "-K", str(cfg), "-o", body_path, "-w", "%{http_code}", "--max-time", "20", url],
            check=False, text=True, capture_output=True,
        )
    finally:
        cfg.unlink(missing_ok=True)
        del key
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        raise SystemExit(proc.returncode)
    sys.stdout.write(proc.stdout)

def check_state():
    body = json.loads(Path(os.environ["A2A_CURL_BODY"]).read_text(encoding="utf-8"))
    origin = os.environ["A2A_ORIGIN_URL"]
    version = os.environ["A2A_EXPECT_VERSION"]
    if body.get("ownerHost") != origin:
        raise SystemExit("state ownerHost is %r, want %s" % (body.get("ownerHost"), origin))
    if body.get("version") != version:
        raise SystemExit("state version is %r, want %s" % (body.get("version"), version))
    key = json.loads(Path(os.environ["A2A_NODE_JSON"]).read_text(encoding="utf-8"))["apiKey"]
    raw = Path(os.environ["A2A_CURL_BODY"]).read_text(encoding="utf-8")
    if key and key in raw:
        raise SystemExit("state body contains the apiKey")

def check_html():
    html = Path(os.environ["A2A_HTML"]).read_text(encoding="utf-8", errors="replace")
    if "window.__DSH_A2A_KEY__=" in html:
        raise SystemExit("workbench HTML injects the apiKey (upstream reached the node on loopback)")
    key = json.loads(Path(os.environ["A2A_NODE_JSON"]).read_text(encoding="utf-8"))["apiKey"]
    if key and key in html:
        raise SystemExit("workbench HTML contains the apiKey")

def self_test():
    move = render_site("move")
    sni = render_site("sni")
    http = render_site("http")
    stream = render_stream()
    assert_safe(move, "move")
    assert_safe(sni, "sni")
    assert_safe(http, "http")
    assert_safe(stream, "stream")
    if "listen 443 ssl http2;" not in move:
        raise SystemExit("move site must listen 443 ssl http2 for Debian 12 nginx 1.22")
    if "listen 127.0.0.1:%s ssl http2;" % TLS_PORT not in sni:
        raise SystemExit("sni site must terminate TLS on the local nginx port")
    if "127.0.0.1:%s" % LISTEN_PORT in sni:
        raise SystemExit("sni site still targets loopback a2a-net")
    if "ssl_preread on;" not in stream or "server 127.0.0.1:%s;" % XRAY_PORT not in stream:
        raise SystemExit("stream split is incomplete")
    if key_gate("1", "0") != "rotate" or key_gate("0", "1") != "keep" or key_gate("0", "0") != "refuse":
        raise SystemExit("key gate mismatch")
    sample = '{ path=/usr/bin/node ; argv[]=/usr/bin/node /opt/a2a-net/cli/a2a.mjs serve --config /opt/a2a-net/node.json --host 127.0.0.1 --port 3080 ; }'
    if not execstart_conflicts(sample, "3080"):
        raise SystemExit("127.0.0.1 flag must conflict")
    ok = '{ path=/usr/bin/node ; argv[]=/usr/bin/node serve --config node.json ; }'
    if execstart_conflicts(ok, "3080"):
        raise SystemExit("flags absent must not conflict")
    both = '{ path=/usr/bin/node ; argv[]=/usr/bin/node x serve --host 0.0.0.0 --port=3080 ; }'
    if execstart_conflicts(both, "3080") or node_bin(both) != "/usr/bin/node":
        raise SystemExit("matching flags should be kept")
    if classify_listeners("") != "free":
        raise SystemExit("empty ss should be free")
    if classify_listeners('LISTEN 0 511 0.0.0.0:443 0.0.0.0:* users:(("nginx",pid=1,fd=3))') != "nginx":
        raise SystemExit("nginx owner misread")
    foreign = classify_listeners('LISTEN 0 511 0.0.0.0:443 0.0.0.0:* users:(("xray",pid=9,fd=3))')
    if not foreign.startswith("foreign:xray"):
        raise SystemExit("xray owner misread: " + foreign)
    if xray_local_ok('LISTEN 0 511 127.0.0.1:2443 0.0.0.0:*', "2443") != "ok":
        raise SystemExit("loopback reality should pass")
    if xray_local_ok('LISTEN 0 511 0.0.0.0:2443 0.0.0.0:*', "2443") != "public:0.0.0.0:2443":
        raise SystemExit("public reality fallback must be rejected")
    numbered = "[ 2] 3080/tcp ALLOW IN Anywhere\n[ 4] 80/tcp ALLOW IN Anywhere\n[ 9] 3080/tcp (v6) ALLOW IN Anywhere (v6)\n"
    if next_3080(numbered) != "2":
        raise SystemExit("ufw numbered parse failed")
    if not public_3080(numbered):
        raise SystemExit("public 3080 not detected")
    if public_3080("[ 1] 3080/tcp ALLOW IN 38.209.68.244"):
        raise SystemExit("NIC allow must not look public")
    if incoming_policy("Default: deny (incoming), allow (outgoing), deny (routed)") != "deny":
        raise SystemExit("policy parse failed")
    tmp = Path(tempfile.mkdtemp())
    node = tmp / "node.json"
    node.write_text(json.dumps({
        "host": "127.0.0.1",
        "port": 13090,
        "team": "dsh",
        "session": "a2a-node-ecs",
        "agentName": "edge",
        "apiKey": "replace-me-not-a-real-key",
        "peers": ["http://10.0.0.5:13090"],
        "dshHome": "/opt/a2a-net/home",
    }), encoding="utf-8")
    os.environ["A2A_NODE_JSON"] = str(node)
    os.environ["A2A_ORIGIN_URL"] = ORIGIN
    os.environ["A2A_PORT"] = "3080"
    os.environ["A2A_HOME_DEFAULT"] = "/opt/a2a-net/home"
    os.environ["A2A_DO_ROTATE"] = "1"
    os.environ["A2A_KEY_FILE"] = str(tmp / "api-key")
    os.environ["A2A_KEY_MARKER"] = str(tmp / "marker")
    saved = sys.stdout
    sys.stdout = open(os.devnull, "w")
    try:
        patch_node()
    finally:
        sys.stdout.close()
        sys.stdout = saved
    patched = json.loads(node.read_text(encoding="utf-8"))
    if patched["originClaimUrl"] != ORIGIN or patched["originClaimWindow"] is not False:
        raise SystemExit("origin claim fields were not written")
    if patched["host"] != "0.0.0.0" or patched["port"] != 3080:
        raise SystemExit("bind was not pinned to 0.0.0.0:3080")
    if patched["peers"] != ["http://10.0.0.5:13090"] or patched["dshHome"] != "/opt/a2a-net/home":
        raise SystemExit("unrelated node.json keys changed")
    if patched["apiKey"] == "replace-me-not-a-real-key" or len(patched["apiKey"]) != 64:
        raise SystemExit("dedicated key was not generated")
    key_on_disk = (tmp / "api-key").read_text(encoding="utf-8").strip()
    if key_on_disk != patched["apiKey"]:
        raise SystemExit("api-key file does not match node.json")
    os.environ["A2A_DO_ROTATE"] = "0"
    sys.stdout = open(os.devnull, "w")
    try:
        patch_node()
    finally:
        sys.stdout.close()
        sys.stdout = saved
    again = json.loads(node.read_text(encoding="utf-8"))
    if again["apiKey"] != patched["apiKey"]:
        raise SystemExit("second run rotated the key without ROTATE_KEY=1")
    repo = None
    for candidate in (Path("cli/serve.mjs"), Path("/workspace/cli/serve.mjs")):
        if candidate.exists():
            repo = candidate
            break
    if repo is not None:
        proc = subprocess.run(
            ["node", "--input-type=module", "-e",
             "import { installLine } from " + json.dumps(repo.resolve().as_uri()) + "; process.stdout.write(installLine('0.6.39'))"],
            check=True, text=True, capture_output=True,
        )
        line = proc.stdout
        for pin in (
            "@nelsonlongxiang/dsh-open-a2a-net@0.6.39",
            "@deepseek-ai/cordis@4.0.5",
            "@deepseek-ai/cordis-plugin-timer@1.1.7",
            "@deepseek-ai/dsh-host-webserver@0.1.7-rc.2",
            "@deepseek-ai/dsh-tools@0.1.7-rc.2",
            "@deepseek-ai/dsh-system-prompt@0.1.7-rc.2",
            "@deepseek-ai/dsh-home-paths@0.1.7-rc.2",
            "@deepseek-ai/dsh-llm@0.1.7-rc.2",
            "@deepseek-ai/dsh-session@0.1.7-rc.2",
            "@deepseek-ai/schemastery@3.18.5",
        ):
            if pin not in line:
                raise SystemExit("installLine missing " + pin)
    script_dir = Path(os.environ.get("A2A_SCRIPT_DIR", "."))
    for name, kind in (
        ("nginx-a2a-net.conf.example", "move"),
        ("nginx-sni-stream.conf.example", "stream"),
    ):
        example = script_dir / name
        if not example.exists():
            example = script_dir / "artifacts" / name
        if not example.exists():
            continue
        expected = render_site("move") if kind == "move" else render_stream()
        got = example.read_text(encoding="utf-8")
        if got != expected:
            raise SystemExit(name + " drifted from the script renderer")
    print("self-test ok")

cmd = sys.argv[1] if len(sys.argv) > 1 else ""
if cmd == "self-test":
    self_test()
elif cmd == "print-site":
    text = render_site("move")
    assert_safe(text, "move")
    sys.stdout.write(text)
elif cmd == "print-site-sni":
    text = render_site("sni")
    assert_safe(text, "sni")
    sys.stdout.write(text)
elif cmd == "print-http":
    text = render_site("http")
    assert_safe(text, "http")
    sys.stdout.write(text)
elif cmd == "print-stream":
    text = render_stream()
    assert_safe(text, "stream")
    sys.stdout.write(text)
elif cmd == "key-gate":
    print(key_gate(os.environ.get("A2A_ROTATE", "0"), os.environ.get("A2A_MARKER", "0")))
elif cmd == "classify":
    print(classify_listeners(sys.stdin.read()))
elif cmd == "xray-local":
    print(xray_local_ok(sys.stdin.read(), os.environ.get("XRAY_LOCAL_PORT", "2443")))
elif cmd == "exec-conflict":
    print("yes" if execstart_conflicts(sys.stdin.read(), os.environ.get("A2A_PORT", "3080")) else "no")
elif cmd == "node-bin":
    print(node_bin(sys.stdin.read()))
elif cmd == "next-3080":
    print(next_3080(sys.stdin.read()))
elif cmd == "public-3080":
    print("yes" if public_3080(sys.stdin.read()) else "no")
elif cmd == "policy":
    print(incoming_policy(sys.stdin.read()))
elif cmd == "patch-node":
    patch_node()
elif cmd == "authed-curl":
    authed_curl()
elif cmd == "check-state":
    check_state()
elif cmd == "check-html":
    check_html()
elif cmd == "max-stable":
    raw = sys.stdin.read().strip()
    data = json.loads(raw)
    if isinstance(data, str):
        data = [data]
    stable = [v for v in data if isinstance(v, str) and "-" not in v]

    def key(v):
        return tuple(int(part) for part in v.split("."))

    if not stable:
        raise SystemExit("npm returned no stable versions")
    print(max(stable, key=key))
else:
    raise SystemExit("unknown helper " + cmd)
PY
py() { python3 "$HELPER" "$@"; }

export A2A_DOMAIN="$DOMAIN" A2A_NIC_IP="$NIC_IP" A2A_PORT="$LISTEN_PORT"
export NGINX_TLS_PORT XRAY_LOCAL_PORT A2A_WEBROOT="$ACME_WEBROOT"
case "${1:-}" in
  --self-test|--print-site|--print-site-sni|--print-stream|--print-http)
    export A2A_IPV6=1 A2A_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    case "$1" in
      --self-test) py self-test ;;
      --print-site) py print-site ;;
      --print-site-sni) py print-site-sni ;;
      --print-stream) py print-stream ;;
      --print-http) py print-http ;;
    esac
    exit 0
    ;;
esac

[[ "$(id -u)" -eq 0 ]] || die "run as root on the VPS"
[[ "$NIC_IP" == "38.209.68.244" && "$LISTEN_PORT" == "3080" ]] || die "this playbook pins the upstream to 38.209.68.244:3080"
case "$EDGE_MODE" in
  auto|move|sni) ;;
  *) die "EDGE_MODE must be auto, move, or sni" ;;
esac

if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
else
  die "missing /etc/os-release"
fi
[[ "${ID:-}" == "debian" && "${VERSION_ID:-}" == "12" ]] || die "this playbook is for Debian 12 (found ${ID:-unknown} ${VERSION_ID:-})"

export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
if ! command -v python3 >/dev/null || ! command -v openssl >/dev/null || ! command -v curl >/dev/null || ! command -v ss >/dev/null; then
  apt-get update -y
  apt-get install -y python3 openssl curl ca-certificates iproute2
fi

if [[ -s /proc/net/if_inet6 ]]; then
  export A2A_IPV6=1
else
  export A2A_IPV6=0
  log "IPv6 is disabled; nginx will not listen on [::]"
fi

ss_port() {
  ss -H -ltnp "sport = :$1" 2>/dev/null || true
}

classify_port() {
  ss_port "$1" | py classify
}

explain_choice() {
  cat <<EOF
[a2a-edge] TCP/443 is not free for nginx:
$(ss_port 443)

Nothing was changed (node.json, nginx, and ufw are untouched).

Xray Reality is almost certainly the listener. Do not point a2a-net at
127.0.0.1 and do not kill xray from this script. Pick one and re-run:

  EDGE_MODE=move
    Move the Reality inbound off public 443 (a new public port plus a
    client-port change, and a matching ufw allow). When
    \`ss -ltnp 'sport = :443'\` is empty:
      EDGE_MODE=move ROTATE_KEY=1 bash /root/vps-harden-a2a-net.sh

  EDGE_MODE=sni
    Keep Reality clients on port 443. This run obtains the certificate,
    terminates this domain on 127.0.0.1:${NGINX_TLS_PORT}, and proxy_passes
    to http://${NIC_IP}:${LISTEN_PORT}. You then move ONLY the xray listen
    address to 127.0.0.1:${XRAY_LOCAL_PORT} (clients stay on 443) and re-run
    the same command without ROTATE_KEY so nginx's stream SNI router can
    bind 443. Reality serverNames must not include ${DOMAIN}.
      EDGE_MODE=sni ROTATE_KEY=1 bash /root/vps-harden-a2a-net.sh
EOF
}

port443="$(classify_port 443)"
log "TCP/443 classified as ${port443}"
case "${EDGE_MODE}:${port443}" in
  auto:foreign*)
    explain_choice
    exit 2
    ;;
  move:foreign*)
    explain_choice
    exit 2
    ;;
  auto:free|auto:nginx)
    EDGE_MODE=move
    ;;
esac

[[ -f "$NODE_JSON" ]] || die "missing ${NODE_JSON}"
node_bin="$(command -v node || true)"
if [[ -z "$node_bin" ]]; then
  die "node is not installed. Node.js must be >= 22 with node:zlib zstdDecompressSync (src/session-transcript.ts). Node 20 cannot load this package."
fi
if ! "$node_bin" -e 'const z=require("node:zlib"); const maj=Number(process.versions.node.split(".")[0]); if(!(maj>=22 && typeof z.zstdDecompressSync==="function")) process.exit(1)'; then
  die "node $($node_bin -v) has no zstdDecompressSync. Install Node.js >= 22 (this host was on 22.23.4) before re-running. Nothing was changed."
fi

marker_exists=0
[[ -f "$KEY_MARKER" ]] && marker_exists=1
key_action="$(A2A_ROTATE="$ROTATE_KEY" A2A_MARKER="$marker_exists" py key-gate)"
case "$key_action" in
  rotate) DO_ROTATE=1 ;;
  keep) DO_ROTATE=0 ;;
  refuse)
    log "Refusing to continue: no dedicated-key marker at ${KEY_MARKER}."
    log "Re-run with ROTATE_KEY=1. That runs openssl rand -hex 32 into node.json and ${KEY_FILE} (mode 600) and does not print the key."
    log "Nothing was changed."
    exit 1
    ;;
  *) die "key gate returned ${key_action}" ;;
esac

exec 9>/var/lock/a2a-net-edge.lock
flock -n 9 || die "another run holds /var/lock/a2a-net-edge.lock"

log "registry: resolving the newest stable ${PKG}"
mapfile -t versions_json < <(npm view "$PKG" versions --json)
target="$(printf '%s\n' "${versions_json[@]}" | py max-stable)"
installed="none"
if [[ -f "${PKG_DIR}/package.json" ]]; then
  installed="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).version" "${PKG_DIR}/package.json")"
fi
log "npm stable max ${target}; installed before ${installed}"
if [[ "$installed" == "$target" ]]; then
  log "pinning ${target} (already the newest published stable) plus SERVE_DEPS from cli/serve.mjs"
else
  log "upgrading ${installed} -> ${target}; runtime deps come from that package's installLine"
fi

if [[ ! -f "${A2A_ROOT}/package.json" ]]; then
  printf '%s\n' '{"name":"a2a-net","private":true}' > "${A2A_ROOT}/package.json"
fi
(
  cd "$A2A_ROOT"
  npm i --omit=dev --no-fund --no-audit --no-update-notifier "${PKG}@${target}"
)
[[ -f "${PKG_DIR}/cli/serve.mjs" ]] || die "installed package has no cli/serve.mjs"

extract="$(mktemp --suffix=.mjs)"
cat > "$extract" <<'JS'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
const root = process.env.PKG_DIR
const version = JSON.parse(readFileSync(root + '/package.json', 'utf8')).version
let specs
try {
  const mod = await import(pathToFileURL(root + '/cli/serve.mjs').href)
  specs = mod.installLine(version).replace(/^npm i\s+/, '').split(/\s+/)
} catch (error) {
  const src = readFileSync(root + '/cli/serve.mjs', 'utf8')
  const body = src.match(/export const SERVE_DEPS = \{([\s\S]*?)\n\}/)
  if (!body) {
    console.error(String(error))
    process.exit(1)
  }
  const deps = [...body[1].matchAll(/['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g)].map((m) => m[1] + '@' + m[2])
  specs = ['@nelsonlongxiang/dsh-open-a2a-net@' + version, ...deps]
}
process.stdout.write(specs.filter(Boolean).join('\n'))
JS
mapfile -t specs < <(PKG_DIR="$PKG_DIR" node "$extract")
rm -f "$extract"
[[ "${#specs[@]}" -ge 2 ]] || die "installLine produced no runtime specs"
log "npm i ${specs[*]}"
(
  cd "$A2A_ROOT"
  npm i --omit=dev --no-fund --no-audit --no-update-notifier "${specs[@]}"
)
now="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).version" "${PKG_DIR}/package.json")"
[[ "$now" == "$target" ]] || die "installed ${now} after pinning ${target}"

log "patching ${NODE_JSON} (apiKey is not printed)"
A2A_NODE_JSON="$NODE_JSON" \
  A2A_ORIGIN_URL="$ORIGIN_URL" \
  A2A_PORT="$LISTEN_PORT" \
  A2A_HOME_DEFAULT="${A2A_ROOT}/home" \
  A2A_DO_ROTATE="$DO_ROTATE" \
  A2A_KEY_FILE="$KEY_FILE" \
  A2A_KEY_MARKER="$KEY_MARKER" \
  py patch-node

svc_user="$(systemctl show -p User --value "$UNIT" 2>/dev/null || true)"
svc_group="$(systemctl show -p Group --value "$UNIT" 2>/dev/null || true)"
if [[ -n "$svc_user" && "$svc_user" != "root" ]]; then
  chown "${svc_user}:${svc_group:-$svc_user}" "$NODE_JSON"
fi
chmod 600 "$NODE_JSON"
if [[ -f "$KEY_FILE" ]]; then
  chown root:root "$KEY_FILE"
  chmod 600 "$KEY_FILE"
fi

if systemctl cat "$UNIT" >/dev/null 2>&1; then
  execstart="$(systemctl show -p ExecStart --value "$UNIT" || true)"
  conflict="$(printf '%s' "$execstart" | py exec-conflict)"
  unit_node="$(printf '%s' "$execstart" | py node-bin)"
  [[ -n "$unit_node" ]] && node_bin="$unit_node"
  if [[ "$conflict" == "yes" ]]; then
    log "systemd ExecStart overrides host or port; installing a drop-in for 0.0.0.0:${LISTEN_PORT}"
    mkdir -p "/etc/systemd/system/${UNIT}.d"
    cat > "/etc/systemd/system/${UNIT}.d/10-bind.conf" <<EOF
# a2a-net-edge bind
[Service]
ExecStart=
ExecStart=${node_bin} ${PKG_DIR}/cli/a2a.mjs serve --config ${NODE_JSON} --host 0.0.0.0 --port ${LISTEN_PORT}
EOF
    systemctl daemon-reload
  fi
else
  log "creating ${UNIT}"
  cat > "/etc/systemd/system/${UNIT}" <<EOF
[Unit]
Description=a2a-net standalone node
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=${A2A_ROOT}
ExecStart=${node_bin} ${PKG_DIR}/cli/a2a.mjs serve --config ${NODE_JSON} --host 0.0.0.0 --port ${LISTEN_PORT}
Restart=always
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable "$UNIT"
fi

systemctl restart "$UNIT"
ready=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 -o /dev/null "http://${NIC_IP}:${LISTEN_PORT}/.well-known/agent-card.json"; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  ss -ltnp "sport = :${LISTEN_PORT}" || true
  journalctl -u "$UNIT" -n 40 --no-pager || true
  die "node did not answer http://${NIC_IP}:${LISTEN_PORT}/.well-known/agent-card.json"
fi
bind_line="$(ss -H -ltn "sport = :${LISTEN_PORT}" || true)"
if [[ "$bind_line" != *"0.0.0.0:${LISTEN_PORT}"* && "$bind_line" != *"*:${LISTEN_PORT}"* ]]; then
  die "node is not listening on 0.0.0.0:${LISTEN_PORT}: ${bind_line}"
fi
log "node is listening on 0.0.0.0:${LISTEN_PORT} and answers on the NIC address"

card_body="$(mktemp)"
card_code="$(curl -sS --max-time 10 -o "$card_body" -w '%{http_code}' "http://${NIC_IP}:${LISTEN_PORT}/.well-known/agent-card.json")"
[[ "$card_code" == "200" ]] || die "NIC agent-card returned ${card_code}"
python3 - "$card_body" "$now" <<'PY'
import json, sys
body = json.load(open(sys.argv[1], encoding="utf-8"))
want = sys.argv[2]
if body.get("version") != want:
    raise SystemExit("agent-card version %r, want %s" % (body.get("version"), want))
PY
rm -f "$card_body"

state_body="$(mktemp)"
state_code="$(A2A_NODE_JSON="$NODE_JSON" A2A_CURL_URL="http://${NIC_IP}:${LISTEN_PORT}/__dsh_a2a/state" A2A_CURL_BODY="$state_body" py authed-curl)"
[[ "$state_code" == "200" ]] || die "NIC state with X-API-Key returned ${state_code}"
A2A_NODE_JSON="$NODE_JSON" A2A_CURL_BODY="$state_body" A2A_ORIGIN_URL="$ORIGIN_URL" A2A_EXPECT_VERSION="$now" py check-state
rm -f "$state_body"
plain_state="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "http://${NIC_IP}:${LISTEN_PORT}/__dsh_a2a/state" || true)"
[[ "$plain_state" == "401" ]] || die "state without X-API-Key returned ${plain_state}, want 401"
log "NIC health ok: agent-card 200 version ${now}; state 401 without key and 200 with key; ownerHost ${ORIGIN_URL}"

if ! command -v nginx >/dev/null || ! command -v certbot >/dev/null || ! command -v ufw >/dev/null; then
  apt-get update -y
  apt-get install -y nginx certbot ufw ca-certificates
fi
if [[ "$EDGE_MODE" == "sni" ]] && ! dpkg -s libnginx-mod-stream >/dev/null 2>&1; then
  apt-get install -y libnginx-mod-stream
fi

port80="$(classify_port 80)"
case "$port80" in
  free|nginx) ;;
  *)
    pending "TCP/80 is held by ${port80}. certbot HTTP-01 needs port 80. Not closing 3080. Node config is already applied."
    ;;
esac

ufw_status() { ufw status verbose; }

ensure_allow() {
  local label="$1"
  shift
  if ufw status | grep -F "$label" | grep -q ALLOW; then
    return 0
  fi
  ufw allow "$@"
}

# Allow SSH before any enable. Match every sshd listen port we can see.
while read -r sport; do
  [[ -n "$sport" ]] || continue
  ensure_allow "${sport}/tcp" "${sport}/tcp" comment "ssh"
done < <(ss -H -ltnp | python3 -c 'import sys,re
ports=set()
for line in sys.stdin:
    if "sshd" not in line:
        continue
    m=re.search(r":(\d+)\s", line)
    if m:
        ports.add(m.group(1))
print("\n".join(sorted(ports)))')
if ss -H -ltn "sport = :22" | grep -q .; then
  if ! ufw status | grep -E 'OpenSSH|22/tcp' | grep -q ALLOW; then
    ufw allow OpenSSH comment "ssh"
  fi
fi

ensure_allow "80/tcp" 80/tcp comment "acme http-01"
ensure_allow "443/tcp" 443/tcp comment "https nginx"
if ufw status | grep -q "Status: inactive"; then
  if ! ufw status | grep -E 'OpenSSH|22/tcp' | grep -q ALLOW; then
    pending "ufw is inactive and no SSH allow is visible. Not enabling it. 3080 stays as it was."
  fi
  log "enabling ufw; SSH, 80, and 443 are allowed"
  ufw --force enable
fi

write_site() {
  local kind="$1"
  mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled /var/www/a2a-net
  case "$kind" in
    http) py print-http ;;
    move) py print-site ;;
    sni) py print-site-sni ;;
  esac > "$SITE_AVAIL"
  python3 - "$SITE_AVAIL" "$LISTEN_PORT" <<'PY'
import sys
text = open(sys.argv[1], encoding="utf-8").read()
port = sys.argv[2]
if ("127.0.0.1:%s" % port) in text or ("localhost:%s" % port) in text:
    raise SystemExit("refusing to install a config that targets loopback:%s" % port)
if "proxy_pass http://a2a_net_node/;" in text:
    raise SystemExit("proxy_pass would rewrite the OriginClaim path")
PY
  ln -sfn "$SITE_AVAIL" "$SITE_LINK"
  if ! grep -Rqs --exclude='*.bak' -E '^[[:space:]]*server_names_hash_bucket_size' /etc/nginx/nginx.conf /etc/nginx/conf.d /etc/nginx/sites-enabled 2>/dev/null; then
    printf '%s\n' 'server_names_hash_bucket_size 64;' > /etc/nginx/conf.d/a2a-server-names.conf
  fi
}

nginx_ok() {
  nginx -t
}

reload_nginx() {
  if [[ "${1:-reload}" == "restart" ]]; then
    systemctl restart nginx
  elif systemctl is-active --quiet nginx; then
    systemctl reload nginx
  else
    systemctl enable --now nginx
  fi
}

cert_file="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
key_file="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
cert_ready=0
if [[ -s "$cert_file" ]] && openssl x509 -checkend 86400 -noout -in "$cert_file" >/dev/null 2>&1; then
  cert_ready=1
fi

issue_cert() {
  if [[ "${ACME_STAGING:-0}" == "1" ]]; then
    log "ACME_STAGING=1 uses the Let's Encrypt staging CA (browsers will not trust it)"
  fi
  local -a email_args=()
  local -a staging_args=()
  if [[ -n "${ACME_EMAIL:-}" ]]; then
    [[ "$ACME_EMAIL" == *@* ]] || die "ACME_EMAIL must look like an email address"
    email_args=(-m "$ACME_EMAIL")
  else
    email_args=(--register-unsafely-without-email)
    log "no ACME_EMAIL; registering with Let's Encrypt without a contact address"
  fi
  if [[ "${ACME_STAGING:-0}" == "1" ]]; then
    staging_args=(--test-cert)
  fi
  certbot certonly --webroot -w "$ACME_WEBROOT" -d "$DOMAIN" \
    --agree-tos --non-interactive --keep-until-expiring \
    "${email_args[@]}" "${staging_args[@]}"
  install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal-hooks/deploy/a2a-net-nginx <<'EOF'
#!/bin/sh
systemctl reload nginx
EOF
  chmod 755 /etc/letsencrypt/renewal-hooks/deploy/a2a-net-nginx
  if systemctl list-unit-files certbot.timer >/dev/null 2>&1; then
    systemctl enable --now certbot.timer
  fi
}

www_can_read() {
  if command -v runuser >/dev/null 2>&1; then
    runuser -u www-data -- test -r "$key_file"
  else
    su -s /bin/sh www-data -c "test -r $(printf '%q' "$key_file")"
  fi
}

ensure_key_readable() {
  if www_can_read; then
    return 0
  fi
  if getent group ssl-cert >/dev/null; then
    usermod -aG ssl-cert www-data
  fi
  chmod 755 /etc/letsencrypt "/etc/letsencrypt/live" "/etc/letsencrypt/archive" \
    "/etc/letsencrypt/live/${DOMAIN}" "/etc/letsencrypt/archive/${DOMAIN}" 2>/dev/null || true
  if www_can_read; then
    echo restart
    return 0
  fi
  namei -l "$key_file" || true
  die "www-data cannot read ${key_file}"
}

activate_https() {
  local kind="$1"
  local how prev=""
  how="$(ensure_key_readable)"
  if [[ -f "$SITE_AVAIL" ]]; then
    prev="$(mktemp)"
    cp -a "$SITE_AVAIL" "$prev"
  fi
  write_site "$kind"
  if ! nginx_ok; then
    if [[ -n "$prev" ]]; then
      cp -a "$prev" "$SITE_AVAIL"
    else
      rm -f "$SITE_LINK"
    fi
    rm -f "$prev"
    pending "nginx -t failed for the ${kind} site. Previous site file restored. Node config is already applied. Public 3080 was not closed."
  fi
  rm -f "$prev"
  if [[ "$how" == "restart" ]]; then
    reload_nginx restart
  else
    reload_nginx reload
  fi
}

if [[ "$cert_ready" -ne 1 ]]; then
  write_site http
  nginx_ok || pending "nginx -t failed on the HTTP-01 site. Node config is already applied. Public 3080 was not closed."
  reload_nginx reload
  issue_cert || pending "certbot failed. Node config is already applied. Public 3080 was not closed."
fi
[[ -s "$cert_file" && -s "$key_file" ]] || pending "certbot did not write ${cert_file}. Public 3080 was not closed."

if [[ "$EDGE_MODE" == "move" ]]; then
  now443="$(classify_port 443)"
  case "$now443" in
    free|nginx) ;;
    *) pending "EDGE_MODE=move but 443 is ${now443}. Not taking the port. Node config is already applied. Public 3080 was not closed." ;;
  esac
  rm -f "${STREAM_LINK_DIR}/a2a-reality-sni.conf"
  activate_https move
  printf '%s\n' move > /etc/nginx/.a2a-edge-mode
else
  if [[ "$(classify_port 443)" == "nginx" ]]; then
    xpre="$(ss_port "$XRAY_LOCAL_PORT" | py xray-local)"
    if [[ "$xpre" != "ok" ]]; then
      pending "443 is already nginx and 127.0.0.1:${XRAY_LOCAL_PORT} is ${xpre}. Not swapping that listener. Node config is already applied. Public 3080 was not closed."
    fi
  fi
  tls_owner="$(classify_port "$NGINX_TLS_PORT")"
  case "$tls_owner" in
    free|nginx) ;;
    *) pending "127.0.0.1:${NGINX_TLS_PORT} is held by ${tls_owner}. Set NGINX_TLS_PORT to a free port and re-run. Public 3080 was not closed." ;;
  esac
  activate_https sni
  mkdir -p /etc/nginx/stream-available "$STREAM_LINK_DIR"
  py print-stream > "$STREAM_AVAIL"
  printf '%s\n' sni > /etc/nginx/.a2a-edge-mode
  # Prove nginx → NIC:3080 before touching xray's 443.
  sni_html="$(mktemp)"
  sni_code="$(curl -sS --max-time 20 --resolve "${DOMAIN}:${NGINX_TLS_PORT}:127.0.0.1" \
    -o "$sni_html" -w '%{http_code}' "https://${DOMAIN}:${NGINX_TLS_PORT}/.well-known/agent-card.json" || true)"
  [[ "$sni_code" == "200" ]] || pending "https://127.0.0.1:${NGINX_TLS_PORT} agent-card returned ${sni_code}. nginx is not reaching ${NIC_IP}:${LISTEN_PORT}. Public 3080 was not closed."
  rm -f "$sni_html"
  xray_ss="$(ss_port "$XRAY_LOCAL_PORT")"
  xray_state="$(printf '%s\n' "$xray_ss" | py xray-local)"
  now443="$(classify_port 443)"
  if [[ "$now443" == foreign* ]]; then
    cat <<EOF
[a2a-edge] Certificate and nginx TLS on 127.0.0.1:${NGINX_TLS_PORT} are up.
[a2a-edge] proxy_pass is http://${NIC_IP}:${LISTEN_PORT}. Public 443 is still ${now443}, so it was left alone.
[a2a-edge] Public 3080 stays open until the SNI router owns 443.

Next, on the xray inbound only (do not change client ports, do not ufw-allow ${XRAY_LOCAL_PORT}):
  "listen": "127.0.0.1",
  "port": ${XRAY_LOCAL_PORT}
Reality serverNames must not include ${DOMAIN}. Restart xray, then immediately:
  EDGE_MODE=sni bash /root/vps-harden-a2a-net.sh
EOF
    pending "SNI cutover is staged, not finished."
  fi
  if [[ "$xray_state" != "ok" ]]; then
    pending "443 is ${now443} but Xray on 127.0.0.1:${XRAY_LOCAL_PORT} is ${xray_state}. Not binding the SNI router (it would black-hole Reality). Public 3080 was not closed."
  fi
  if [[ "$now443" != "free" && "$now443" != "nginx" ]]; then
    pending "443 is ${now443}. Not binding the SNI router. Public 3080 was not closed."
  fi
  ln -sfn "$STREAM_AVAIL" "${STREAM_LINK_DIR}/a2a-reality-sni.conf"
  added_stream=0
  if ! grep -q 'a2a-net-edge-stream' /etc/nginx/nginx.conf; then
    cp -a /etc/nginx/nginx.conf "/etc/nginx/nginx.conf.bak.$(date +%Y%m%d%H%M%S)"
    cat >> /etc/nginx/nginx.conf <<'EOF'

# a2a-net-edge-stream
stream {
	include /etc/nginx/stream-enabled/*.conf;
}
EOF
    added_stream=1
  fi
  if ! nginx_ok; then
    rm -f "${STREAM_LINK_DIR}/a2a-reality-sni.conf"
    if [[ "$added_stream" -eq 1 ]]; then
      python3 - <<'PY'
from pathlib import Path
p = Path("/etc/nginx/nginx.conf")
text = p.read_text(encoding="utf-8")
mark = "\n# a2a-net-edge-stream\n"
at = text.rfind(mark)
if at >= 0:
    p.write_text(text[:at].rstrip() + "\n", encoding="utf-8")
PY
    fi
    pending "nginx -t failed after adding the stream SNI router. The new stream site was unlinked. Node config is already applied. Public 3080 was not closed. If xray is no longer on 443, start it again or fix the stream config and re-run."
  fi
  reload_nginx reload
fi

if [[ "${ACME_STAGING:-0}" == "1" ]]; then
  pending "Staging certificate is installed. Not closing public 3080. Re-issue without ACME_STAGING=1."
fi

log "checking public HTTPS"
pub_code=""
for _ in $(seq 1 15); do
  pub_code="$(curl -sS --max-time 15 -o /tmp/a2a-card.json -w '%{http_code}' "https://${DOMAIN}/.well-known/agent-card.json" || true)"
  [[ "$pub_code" == "200" ]] && break
  sleep 2
done
[[ "$pub_code" == "200" ]] || pending "https://${DOMAIN}/.well-known/agent-card.json returned ${pub_code}. Public 3080 was not closed."
python3 - /tmp/a2a-card.json "$now" <<'PY'
import json, sys
body = json.load(open(sys.argv[1], encoding="utf-8"))
if body.get("version") != sys.argv[2]:
    raise SystemExit("public agent-card version %r, want %s" % (body.get("version"), sys.argv[2]))
PY

html="$(mktemp)"
html_code="$(curl -sS -L --max-time 20 -o "$html" -w '%{http_code}' "https://${DOMAIN}/__dsh_a2a_nexus/" || true)"
[[ "$html_code" == "200" ]] || pending "workbench https://${DOMAIN}/__dsh_a2a_nexus/ returned ${html_code}; cannot prove the apiKey is not injected. Public 3080 was not closed."
A2A_HTML="$html" A2A_NODE_JSON="$NODE_JSON" py check-html
rm -f "$html"
log "workbench HTML does not contain the apiKey"

pub_state="$(mktemp)"
pub_state_code="$(A2A_NODE_JSON="$NODE_JSON" A2A_CURL_URL="https://${DOMAIN}/__dsh_a2a/state" A2A_CURL_BODY="$pub_state" py authed-curl)"
[[ "$pub_state_code" == "200" ]] || pending "HTTPS state with X-API-Key returned ${pub_state_code}"
A2A_NODE_JSON="$NODE_JSON" A2A_CURL_BODY="$pub_state" A2A_ORIGIN_URL="$ORIGIN_URL" A2A_EXPECT_VERSION="$now" py check-state
rm -f "$pub_state"
pub_plain="$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "https://${DOMAIN}/__dsh_a2a/state" || true)"
[[ "$pub_plain" == "401" ]] || pending "HTTPS state without key returned ${pub_plain}, want 401"

log "closing public 3080/tcp; keeping the NIC source allowed for nginx"
# Delete every 3080 rule, then allow only the NIC address. Default-deny
# makes that the whole public block. A default-allow policy also needs a deny.
for _ in $(seq 1 40); do
  num="$(ufw status numbered | py next-3080 || true)"
  [[ -z "$num" ]] && break
  ufw --force delete "$num"
done
ufw allow from "$NIC_IP" to any port "$LISTEN_PORT" proto tcp comment "a2a-net nginx via nic"
policy="$(ufw_status | py policy || true)"
if [[ "$policy" == "allow" ]]; then
  ufw deny "$LISTEN_PORT"/tcp comment "a2a-net block public"
fi
if [[ "$(ufw_status | py public-3080)" == "yes" ]]; then
  ufw_status || true
  die "3080/tcp is still ALLOW from Anywhere"
fi

# nginx must still reach the node after the firewall change.
still="$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "https://${DOMAIN}/.well-known/agent-card.json" || true)"
[[ "$still" == "200" ]] || die "HTTPS agent-card returned ${still} after the firewall change"
local_nic="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "http://${NIC_IP}:${LISTEN_PORT}/.well-known/agent-card.json" || true)"
[[ "$local_nic" == "200" ]] || die "nginx path http://${NIC_IP}:${LISTEN_PORT} returned ${local_nic} after ufw"

cat <<EOF
[a2a-edge] cutover done. package ${now}. originClaimUrl ${ORIGIN_URL}. originClaimWindow false.
[a2a-edge] apiKey is in ${KEY_FILE} (mode 600) when this run rotated it. It was not printed.
[a2a-edge] On this VPS, http://${NIC_IP}:${LISTEN_PORT} still answers (nginx and ufw allow that source).
[a2a-edge] From any other machine, this must time out (curl exit 28) and must not print 200:
  curl --connect-timeout 5 --max-time 8 -sS -o /dev/null -w '%{http_code}\\n' http://${NIC_IP}:${LISTEN_PORT}/.well-known/agent-card.json
[a2a-edge] Clients of this edge:
  export A2A_HOME=${ORIGIN_URL}
  export A2A_KEY=\$(sudo cat ${KEY_FILE})
  # The CLI does not follow redirects. Use the https URL, not http, and not :${LISTEN_PORT}.
EOF
ufw_status | sed -n '1,40p'
