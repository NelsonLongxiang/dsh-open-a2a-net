const fs = require('fs');
const NL = String.fromCharCode(10);
const AP = String.fromCharCode(39);

// ---- host ----
let p = 'D:/workspace/dsh-open-a2a-net/src/index.ts';
let s = fs.readFileSync(p, 'utf8');
const a3 = [
  '    whenWebServerSettled((webServer) => {',
  "      ctx.effect(() => webServer.register({",
  "        kind: 'exact',",
  "        path: '/__dsh_a2a/state',",
].join(NL);
if (!s.includes(a3)) { console.error('H3 MISSING'); process.exit(1) }
const cache = [
  '    // Peer-side rows for the panel, grouped there by origin: the sweep is',
  '    // real network work, so one shared 5s cache serves the 2s panel poll',
  '    // without hammering peers.',
  '    let remoteRowsCache: { at: number; rows: { team: string; name: string; origin?: string; workspace?: string }[] } | undefined',
  '    const remoteRows = async (): Promise<{ team: string; name: string; origin?: string; workspace?: string }[]> => {',
  '      const now = Date.now()',
  '      if (remoteRowsCache !== undefined && now - remoteRowsCache.at < 5_000) return remoteRowsCache.rows',
  '      try {',
  '        const rows = (await listDirectoryTeams(false))',
  '          .filter(row => row.local !== true)',
  '          .map(row => ({ team: row.team, name: row.name, ...(row.origin !== undefined ? { origin: row.origin } : {}), ...(row.workspace !== undefined ? { workspace: row.workspace } : {}) }))',
  '        remoteRowsCache = { at: now, rows }',
  '        return rows',
  '      } catch {',
  '        return remoteRowsCache?.rows ?? []',
  '      }',
  '    }',
  '    whenWebServerSettled((webServer) => {',
  "      ctx.effect(() => webServer.register({",
  "        kind: 'exact',",
  "        path: '/__dsh_a2a/state',",
].join(NL);
s = s.replace(a3, cache);
const a4 = [
  "              peers: peerStore.list().map(url => ({ url, score: peerStore.score(url) })),",
  '              activity: recentActivity.slice(),',
].join(NL);
if (!s.includes(a4)) { console.error('H4 MISSING'); process.exit(1) }
s = s.replace(a4, [
  "              peers: peerStore.list().map(url => ({ url, score: peerStore.score(url) })),",
  '              remote: await remoteRows(),',
  '              activity: recentActivity.slice(),',
].join(NL));
fs.writeFileSync(p, s);

// ---- client ----
p = 'D:/workspace/dsh-open-a2a-net/src/client/A2aControl.tsx';
s = fs.readFileSync(p, 'utf8');
const c1 = '/** One tracked peer as the state route reports it. */';
if (!s.includes(c1)) { console.error('C1 MISSING'); process.exit(1) }
s = s.replace(c1, [
  '/** One peer-side team row as the state route reports it (origin is its natural group). */',
  'export interface A2aRemoteRow {',
  '  readonly team: string',
  '  readonly name: string',
  '  readonly origin?: string',
  '  readonly workspace?: string',
  '}',
  '',
  c1,
].join(NL));
const c2 = '  const body = await response.json() as { nodes?: boolean; version?: string; sessions?: A2aSessionRow[]; groups?: string[]; peers?: A2aPeerRow[]; activity?: A2aActivityRow[]; inFlight?: A2aInFlightRow[] }';
if (!s.includes(c2)) { console.error('C2 MISSING'); process.exit(1) }
s = s.replace(c2, '  const body = await response.json() as { nodes?: boolean; version?: string; sessions?: A2aSessionRow[]; groups?: string[]; remote?: A2aRemoteRow[]; peers?: A2aPeerRow[]; activity?: A2aActivityRow[]; inFlight?: A2aInFlightRow[] }');
const c3 = '    inFlight: Array.isArray(body.inFlight) ? body.inFlight : [],';
if (!s.includes(c3)) { console.error('C3 MISSING'); process.exit(1) }
s = s.replace(c3, c3 + NL + '    remote: Array.isArray(body.remote) ? body.remote : [],');
const c4 = '/** The state route' + AP + 's full body. */' + NL + 'export interface A2aState {' + NL + '  readonly sessions: readonly A2aSessionRow[]' + NL + '  readonly groups: readonly string[]';
if (!s.includes(c4)) { console.error('C4 MISSING'); process.exit(1) }
s = s.replace(c4, '/** The state route' + AP + 's full body. */' + NL + 'export interface A2aState {' + NL + '  readonly sessions: readonly A2aSessionRow[]' + NL + '  readonly groups: readonly string[]' + NL + '  readonly remote: readonly A2aRemoteRow[]');
const c5 = "  const [state, setState] = useState<A2aState>({ sessions: [], groups: [], peers: [], activity: [], inFlight: [] })";
if (!s.includes(c5)) { console.error('C5 MISSING'); process.exit(1) }
s = s.replace(c5, "  const [state, setState] = useState<A2aState>({ sessions: [], groups: [], peers: [], activity: [], inFlight: [], remote: [] })");
const c6 = '  const { sessions, groups, peers, activity, inFlight } = state';
if (!s.includes(c6)) { console.error('C6 MISSING'); process.exit(1) }
s = s.replace(c6, '  const { sessions, groups, peers, activity, inFlight, remote } = state');
const c8 = "            <div className={css.sectionTitle}>{t('a2a.peers')}</div>";
if (!s.includes(c8)) { console.error('C8 MISSING'); process.exit(1) }
const filt = "(needle === '' ? remote : remote.filter(row => row.team.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle) || (row.origin ?? '').toLowerCase().includes(needle) || (row.workspace ?? '').toLowerCase().includes(needle)))";
const remoteBlock = [
  '            {' + filt + '.length > 0 && (',
  '              <>',
  "                <div className={css.sectionTitle}>{t('a2a.remote')}</div>",
  '                {Object.entries(',
  '                  ' + filt,
  "                    .reduce<Record<string, A2aRemoteRow[]>>((byOrigin, row) => {",
  "                      const key = row.origin ?? ''",
  '                      byOrigin[key] = [...(byOrigin[key] ?? []), row]',
  '                      return byOrigin',
  '                    }, {}),',
  '                ).map(([origin, rows]) => (',
  '                  <div className={css.sessionGroup} key={origin}>',
  '                    <button',
  '                      type="button"',
  '                      className={css.groupHead}',
  '                      onClick={() => {',
  '                        setCollapsed((current) => {',
  '                          const next = new Set(current)',
  "                          if (next.has('remote:' + origin)) next.delete('remote:' + origin)",
  "                          else next.add('remote:' + origin)",
  '                          return next',
  '                        })',
  '                      }}',
  '                    >',
  "                      <span className={clsx(css.groupChevron, collapsed.has('remote:' + origin) && css.groupChevronClosed)} aria-hidden>▾</span>",
  "                      {origin === '' ? t('a2a.remoteUnknownOrigin') : origin} · {String(rows.length)}",
  '                    </button>',
  "                    {!collapsed.has('remote:' + origin) && rows.map((row) => (",
  '                      <div className={css.row} key={row.team} title={row.workspace ?? undefined}>',
  '                        <div className={css.facts}>',
  '                          <span className={css.nameRow}>',
  '                            <span className={css.stateDot} data-peer aria-hidden />',
  "                            <span className={css.name}>{row.name === '' ? row.team : row.name}</span>",
  "                            {row.workspace !== undefined ? <span className={css.groupTag}>{row.workspace}</span> : null}",
  '                          </span>',
  '                          <span className={css.team}>{row.team}</span>',
  '                        </div>',
  '                      </div>',
  '                    ))}',
  '                  </div>',
  '                ))}',
  '              </>',
  '            )}',
  c8,
].join(NL);
s = s.replace(c8, remoteBlock);
fs.writeFileSync(p, s);

// ---- locales ----
p = 'D:/workspace/dsh-open-a2a-net/src/client/locales.ts';
s = fs.readFileSync(p, 'utf8');
s = s.replace("  | 'a2a.peers'", "  | 'a2a.remote'" + NL + "  | 'a2a.remoteUnknownOrigin'" + NL + "  | 'a2a.peers'");
s = s.replace("  'a2a.peers': 'Peers',", "  'a2a.remote': 'Remote teams (by host)'," + NL + "  'a2a.remoteUnknownOrigin': 'Unknown origin'," + NL + "  'a2a.peers': 'Peers',");
s = s.replace("  'a2a.peers': '对等节点',", "  'a2a.remote': '远程节点（按 host 分组）'," + NL + "  'a2a.remoteUnknownOrigin': '未知来源'," + NL + "  'a2a.peers': '对等节点',");
fs.writeFileSync(p, s);
console.log('remote grouping patched');
