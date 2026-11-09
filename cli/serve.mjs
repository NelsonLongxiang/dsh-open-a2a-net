/**
 * `a2a-net serve` — the A2A network layer as a standalone node, without a DSH instance
 * (owner request 2026-11-04: the network must not go down when a DSH host restarts).
 *
 * It boots the same plugin a DSH host runs, in a bare cordis context with only the four
 * services the network layer needs (system prompt, tool runtime, timer, web server) and no
 * sessions: cards and OriginClaim, the peer directory, CLI deposits and mailboxes, one-hop
 * forwarding, canvas ownership, the task ledger, the state face and the workbench. Delivering
 * to an AI session still needs a DSH host — this node forwards there like any home host.
 *
 *   a2a-net serve [--config node.json] [--host 127.0.0.1|0.0.0.0] [--port 13090] [--home DIR]
 *
 * node.json holds plugin Config keys (team, session, agentName, apiKey, peers,
 * originClaimUrl, originClaimAudiences, forwardDirect, …); flags win over the file.
 */
import { readFileSync, mkdirSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join, resolve } from 'node:path'

/** The tested runtime set (the repo lockfile's versions); npm's `latest` tags are older and do not work. */
export const SERVE_DEPS = {
  '@deepseek-ai/cordis': '4.0.5',
  '@deepseek-ai/cordis-plugin-timer': '1.1.7',
  '@deepseek-ai/dsh-host-webserver': '0.1.7-rc.2',
  '@deepseek-ai/dsh-tools': '0.1.7-rc.2',
  '@deepseek-ai/dsh-system-prompt': '0.1.7-rc.2',
  '@deepseek-ai/dsh-home-paths': '0.1.7-rc.2',
  '@deepseek-ai/dsh-llm': '0.1.7-rc.2',
  '@deepseek-ai/dsh-session': '0.1.7-rc.2',
  '@deepseek-ai/schemastery': '3.18.5',
}

export const SERVE_USAGE = 'usage: a2a-net serve [--config node.json] [--host 127.0.0.1|0.0.0.0] [--port 13090] [--home DIR]'

/** One `npm i` line that installs this package and the tested runtime set into a folder. */
export function installLine(version) {
  return 'npm i @nelsonlongxiang/dsh-open-a2a-net@' + version + ' ' + Object.entries(SERVE_DEPS).map(([name, v]) => name + '@' + v).join(' ')
}

/** Merge file config and flags into the plugin config; pure. */
export function nodeConfig(file, flags) {
  const raw = flags.port ?? file.port ?? 13090
  const port = typeof raw === 'number' ? raw : /^\d+$/.test(String(raw)) ? Number(raw) : NaN
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be an integer 0-65535')
  const home = resolve(flags.home ?? file.dshHome ?? join(homedir(), '.a2a-net', 'node'))
  const { port: _port, host: _host, ...rest } = file
  void _port; void _host
  return {
    host: flags.host ?? file.host ?? '127.0.0.1',
    port,
    config: {
      team: 'dsh',
      agentName: 'a2a-net node',
      session: 'a2a-node-' + hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 24),
      apiKey: '',
      peers: [],
      announce: true,
      ...rest,
      // The control faces (state, CLI deposits and mailboxes, canvas) are mounted with session nodes; this node
      // composes no agents service, so there is no session to track, expose or wake.
      sessionNodes: true,
      wakeJoinedOnBoot: false,
      // A superagent team runs on a host with sessions; this node has none.
      superagent: false,
      dshHome: home,
    },
  }
}

/** Boot the node; resolves to { url, close }. `load` is injectable for tests. */
export async function startNode({ host, port, config }, load = specifier => import(specifier)) {
  const [{ Context }, timer, webServer, tools, systemPrompt, plugin] = await Promise.all([
    load('@deepseek-ai/cordis'),
    load('@deepseek-ai/cordis-plugin-timer'),
    load('@deepseek-ai/dsh-host-webserver'),
    load('@deepseek-ai/dsh-tools'),
    load('@deepseek-ai/dsh-system-prompt'),
    load(new URL('../lib/index.js', import.meta.url).href),
  ])
  mkdirSync(config.dshHome, { recursive: true })
  const ctx = new Context()
  await ctx.plugin(systemPrompt.default)
  await ctx.plugin(tools.default)
  await ctx.plugin(timer.default)
  await ctx.plugin(webServer.default, { host, port })
  try {
    plugin.apply(ctx, plugin.Config(config))
  } catch (error) {
    await ctx.fiber.dispose() // the web server is already listening
    throw error
  }
  const bound = ctx.webServer.port
  const url = 'http://' + (host === '0.0.0.0' ? '127.0.0.1' : host) + ':' + String(bound)
  return { url, port: bound, close: async () => { await ctx.fiber.dispose() } }
}

/** CLI entry: parse argv, boot, log one line, stay up until SIGINT/SIGTERM. */
export async function serve(argv) {
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  const flags = {}
  if (argv.includes('--help') || argv.includes('-h')) { console.log(SERVE_USAGE); process.exit(0) }
  for (let i = 0; i < argv.length; i++) {
    const eq = argv[i].indexOf('=')
    const name = eq === -1 ? argv[i] : argv[i].slice(0, eq)
    const inline = eq === -1 ? undefined : argv[i].slice(eq + 1)
    if (!['--config', '--host', '--port', '--home'].includes(name)) { console.error(SERVE_USAGE); process.exit(2) }
    const value = inline ?? argv[++i]
    if (value === undefined || value === '' || value.startsWith('--')) { console.error(SERVE_USAGE); process.exit(2) }
    flags[name.slice(2)] = value
  }
  let file = {}
  if (flags.config !== undefined) {
    try { file = JSON.parse(readFileSync(flags.config, 'utf8')) } catch (error) { console.error('[serve] cannot read --config ' + flags.config + ': ' + error.message); process.exit(2) }
    if (file === null || typeof file !== 'object' || Array.isArray(file)) { console.error('[serve] --config must hold a JSON object of plugin config keys'); process.exit(2) }
  }
  let options
  try { options = nodeConfig(file, flags) } catch (error) { console.error('[serve] ' + error.message); process.exit(2) }
  let node
  try {
    node = await startNode(options)
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('[serve] a runtime dependency is missing: ' + error.message.split('\n')[0])
      console.error('[serve] install the tested set into a folder and run from there:\n  ' + installLine(version) + '\n  npx a2a-net serve --config node.json')
      process.exit(1)
    }
    console.error('[serve] failed to start: ' + (error?.stack ?? error))
    process.exit(1)
  }
  console.log('[serve] a2a-net node on ' + node.url + ' · zone ' + options.config.team + ' · session ' + options.config.session + ' · home ' + options.config.dshHome + ' (no DSH sessions; Ctrl+C to stop)')
  const stop = async () => { await node.close().catch(() => {}); process.exit(0) }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
