# HTTPS edge for `a2a-net serve` (Debian 12, nginx + certbot)

Standalone network node on `38.209.68.244`. The process keeps listening on `0.0.0.0:3080`. nginx reaches it at `http://38.209.68.244:3080` and nowhere else. Do not `proxy_pass` to `127.0.0.1:3080`.

On 0.6.39, `src/faces/admin.ts` injects `window.__DSH_A2A_KEY__` into the workbench HTML when `controlTrustedWithoutKey` is true (`src/index.ts`: the TCP peer is `127.0.0.1`, `::1`, or `::ffff:127.0.0.1`). A reverse proxy aimed at loopback makes every public visitor look local, and the page then contains the apiKey. `originClaimUrl` also turns loopback arrivals off as an OriginClaim audience (`src/index.ts`, `src/origin-claim.ts`).

`a2a-net serve` accepts `--host 127.0.0.1` or `0.0.0.0` only (`cli/serve.mjs`). Leave the bind at `0.0.0.0`. The NIC address is the dial address, not the bind address.

Checked against this repo and npm on 2026-11-05: `@nelsonlongxiang/dsh-open-a2a-net@0.6.39` is the newest published stable version. The script asks npm again at run time. If a newer stable version exists, it installs that version and the `installLine` printed by its `cli/serve.mjs` (`SERVE_DEPS`). npm `latest` tags of the DeepSeek runtime packages are older and do not work. For 0.6.39 the pin is:

```bash
npm i @nelsonlongxiang/dsh-open-a2a-net@0.6.39 @deepseek-ai/cordis@4.0.5 @deepseek-ai/cordis-plugin-timer@1.1.7 @deepseek-ai/dsh-host-webserver@0.1.7-rc.2 @deepseek-ai/dsh-tools@0.1.7-rc.2 @deepseek-ai/dsh-system-prompt@0.1.7-rc.2 @deepseek-ai/dsh-home-paths@0.1.7-rc.2 @deepseek-ai/dsh-llm@0.1.7-rc.2 @deepseek-ai/dsh-session@0.1.7-rc.2 @deepseek-ai/schemastery@3.18.5
```

Node.js must be ≥ 22 and must export `zstdDecompressSync` from `node:zlib` (`src/session-transcript.ts`). This host is on v22.23.4. Node 20 cannot load the package. There is no `/health` route; use the agent card and `/__dsh_a2a/state`.

Paths already on the box: `/opt/a2a-net`, home `/opt/a2a-net/home`, config `/opt/a2a-net/node.json`, unit `a2a-net.service`.

## 1. See who owns TCP/443

```bash
ss -ltnp 'sport = :443'
```

The script never stops xray and never takes 443 while a non-nginx process holds it. Exit code 2 means HTTPS is not finished and public `3080/tcp` was not closed. If the log says nothing was changed, `node.json` is untouched. If it says the node config is already applied, the restart already happened.

## 2. Port 443 is free (or only nginx)

Copy the script, then on the VPS:

```bash
ROTATE_KEY=1 bash /root/vps-harden-a2a-net.sh
```

Optional contact for Let's Encrypt expiry mail: `ACME_EMAIL=you@example.com`. Omit it and certbot registers without an email. Do not set `ACME_STAGING=1` on a real cutover; that certificate is not trusted, and the script will not close port 3080.

That run upgrades or re-pins the package, writes the node.json fields below, restarts `a2a-net`, installs Debian nginx and certbot, obtains a certificate, serves `artifacts/nginx-a2a-net.conf.example`, and only then removes the public ufw allow for `3080/tcp`.

## 3. Xray Reality already owns 443

Two supported cutovers. Clients of Reality use a serverName that must not be `a2a-net-zxchkjzgsajdgas.sindox.top`. If it is, change the Reality `serverNames` / client SNI before either option.

### Move Reality

Reality leaves public 443. Every Reality client must use the new port. Pick a free port that is not 22, 80, 443, 3080, 2096, 18080, 44000, or 57286. Example `24443`:

```json
"listen": "0.0.0.0",
"port": 24443
```

```bash
ufw allow 24443/tcp comment 'xray reality'
# restart xray with your unit name, then:
ss -ltnp 'sport = :443'    # must show nothing
EDGE_MODE=move ROTATE_KEY=1 bash /root/vps-harden-a2a-net.sh
```

nginx then listens on public 80 and 443. The site file is `nginx-a2a-net.conf.example`.

### SNI fallback (Reality clients stay on port 443)

nginx's stream module peeks at the TLS ClientHello and does not terminate it:

| ClientHello SNI | TCP upstream | What terminates TLS |
|---|---|---|
| `a2a-net-zxchkjzgsajdgas.sindox.top` | `127.0.0.1:8443` | nginx (then `proxy_pass http://38.209.68.244:3080`) |
| anything else, including no SNI | `127.0.0.1:2443` | xray Reality, original bytes |

`127.0.0.1:8443` and `127.0.0.1:2443` are not the a2a-net process. The only node upstream is `38.209.68.244:3080`. Do not `ufw allow 2443`.

```bash
EDGE_MODE=sni ROTATE_KEY=1 bash /root/vps-harden-a2a-net.sh
```

That obtains the certificate and starts nginx on port 80 and on `127.0.0.1:8443`, then exits 2 while xray still holds 443. Change only the Reality inbound listen (client ports stay 443):

```json
"listen": "127.0.0.1",
"port": 2443
```

Restart xray, then immediately, without rotating the key again:

```bash
EDGE_MODE=sni bash /root/vps-harden-a2a-net.sh
```

The second run refuses to bind 443 unless something is listening on `127.0.0.1:2443` and not on `0.0.0.0:2443`. It installs `nginx-sni-stream.conf.example` inside a `stream {}` include. Between the xray restart and that second run, Reality is down and a2a-net is still on public 3080.

## 4. What node.json gains

Existing keys (`team`, `session`, `agentName`, `peers`, `dshHome`) stay. The script sets:

```json
{
  "host": "0.0.0.0",
  "port": 3080,
  "originClaimUrl": "https://a2a-net-zxchkjzgsajdgas.sindox.top",
  "originClaimWindow": false
}
```

`originClaimWindow: false` rejects deliveries that have no OriginClaim envelope (`src/config.ts`, `docs/guides/standalone-node.md`). `originClaimUnboundWindow` is left as it is. Flags on the systemd command win over the file (`cli/serve.mjs`). If `ExecStart` passes another `--host` or `--port`, the script adds a drop-in that forces `0.0.0.0:3080`.

`peers` is not rewritten. This node's `apiKey` is sent on its own outbound peer requests and required on inbound `/a2a/direct`, `/a2a/log`, and `/__dsh_a2a/*` (`src/config.ts`, `src/a2a-client.ts`). A dedicated edge key will not authenticate to fleet hosts that still require a different key, and those hosts will not authenticate here. Do not paste an internal fleet key into this file.

## 5. Dedicated apiKey

`ROTATE_KEY=1` runs `openssl rand -hex 32` (the generator in `docs/guides/standalone-node.md`), writes it to `node.json` and `/opt/a2a-net/api-key` (mode 600, root), and does not print it. There is no second key and no grace period: the old key stops matching at the restart.

```bash
sudo cat /opt/a2a-net/api-key
```

Put that in the operator password store. Do not commit it. A later run without `ROTATE_KEY=1` keeps it, because `/opt/a2a-net/.dedicated-edge-key` exists. If that marker is missing and `ROTATE_KEY` is not `1`, the script exits 1 and changes nothing. Rotate again with `ROTATE_KEY=1`, then update every client of this edge only:

```bash
export A2A_HOME=https://a2a-net-zxchkjzgsajdgas.sindox.top
export A2A_KEY='<value from /opt/a2a-net/api-key>'
npx @nelsonlongxiang/dsh-open-a2a-net whoami
```

The CLI does not follow redirects (`cli/a2a.mjs`). Use the https origin, not `http://`, and not port 3080. The signed audience has to be `https://a2a-net-zxchkjzgsajdgas.sindox.top`, which is `originClaimUrl`.

Do not run the script under `bash -x`.

## 6. Certificate

certbot uses webroot `/var/www/a2a-net` (HTTP-01 on port 80). The DNS A record for `a2a-net-zxchkjzgsajdgas.sindox.top` must be `38.209.68.244` before the first issue. Port 80 and 443 must be open on ufw and on any cloud security group in front of the VPS. An AAAA record, if present, must point at this host or Let's Encrypt and clients will use the wrong address.

The certificate lands in `/etc/letsencrypt/live/a2a-net-zxchkjzgsajdgas.sindox.top/`. Debian's `certbot.timer` renews it. `/etc/letsencrypt/renewal-hooks/deploy/a2a-net-nginx` runs `systemctl reload nginx`. Re-running the script uses `--keep-until-expiring`, so it does not burn the duplicate-certificate rate limit.

Debian 12's nginx is 1.22. The site uses `listen 443 ssl http2;`. `http2 on;` is rejected there. `client_max_body_size 64m` matches `BLOB_FILE_MAX` in `src/blob-store.ts`. `proxy_read_timeout 1800s` matches the `routeTimeoutMs` default in `src/config.ts`. `proxy_pass http://a2a_net_node;` has no URI path; a trailing slash would rewrite the path OriginClaim signs.

The TLS server sends `Strict-Transport-Security: max-age=86400`.

## 7. Firewall

After HTTPS returns 200, ufw keeps SSH, `80/tcp`, and `443/tcp`, deletes every public `3080` allow, and adds only:

```bash
ufw allow from 38.209.68.244 to any port 3080 proto tcp comment 'a2a-net nginx via nic'
```

On this VPS, `curl http://38.209.68.244:3080/...` can still return 200: the source address is the NIC, and ufw's loopback rule also accepts local delivery. That is the nginx path. It is not the public test.

## 8. Verification

On the VPS, after a finished run (exit 0):

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://a2a-net-zxchkjzgsajdgas.sindox.top/.well-known/agent-card.json
# 200, and the JSON "version" is the installed package version

curl -sS -o /dev/null -w '%{http_code}\n' https://a2a-net-zxchkjzgsajdgas.sindox.top/__dsh_a2a/state
# 401

sudo python3 - <<'PY'
import json, subprocess, pathlib
key = json.loads(pathlib.Path("/opt/a2a-net/node.json").read_text())["apiKey"]
cfg = pathlib.Path("/tmp/a2a-curl.cfg")
cfg.write_text('header = "X-API-Key: %s"\n' % key)
cfg.chmod(0o600)
try:
    subprocess.check_call(["curl","-sS","-K",str(cfg),"-o","/tmp/a2a-state.json","-w","%{http_code}\\n","https://a2a-net-zxchkjzgsajdgas.sindox.top/__dsh_a2a/state"])
finally:
    cfg.unlink()
body = json.loads(pathlib.Path("/tmp/a2a-state.json").read_text())
assert body["ownerHost"] == "https://a2a-net-zxchkjzgsajdgas.sindox.top"
print("state", body["version"], body["ownerHost"])
PY
# 200, ownerHost is the https origin

curl -sS -L -o /tmp/nexus.html -w '%{http_code}\n' https://a2a-net-zxchkjzgsajdgas.sindox.top/__dsh_a2a_nexus/
# 200, and the file must not contain window.__DSH_A2A_KEY__=
grep -c 'window.__DSH_A2A_KEY__=' /tmp/nexus.html || true
# 0

ufw status verbose | grep 3080
# one ALLOW from 38.209.68.244, no ALLOW from Anywhere
```

From any other machine:

```bash
curl --connect-timeout 5 --max-time 8 -sS -o /dev/null -w '%{http_code}\n' http://38.209.68.244:3080/.well-known/agent-card.json
```

Expect curl exit 28 (timeout) or 7 (refused). A `200` means port 3080 is still public.

## 9. If you have to go back

```bash
cp -a /opt/a2a-net/node.json.bak.TIMESTAMP /opt/a2a-net/node.json
systemctl restart a2a-net
ufw allow 3080/tcp comment 'a2a-net-serve'
```

The backup is mode 600 and contains the previous apiKey. Public 3080 is the old plain-HTTP path. Prefer fixing nginx (`nginx -t`, `journalctl -u nginx`, `journalctl -u a2a-net`) over leaving 3080 open.
