/**
 * Registers the right bar's request view (docs/design/superagent-multi-team.md, M7). The right bar is an optional part of the
 * DSH client, and its slots are not in this package's type map, so it is reached by name; a client without it shows nothing.
 */
import { createElement } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { TeamRequestTab } from './TeamRequestTab.tsx'
import type { A2aNetKey } from './locales.ts'

export const TEAM_REQUEST_KIND = 'a2a-team-request'
const TEAM_REQUEST_ID = '@nelsonlongxiang/dsh-open-a2a-net/team-request'

/** The guide card's picture: a speech bubble. */
function RequestIcon() {
  return createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    createElement('path', { d: 'M4 5h16v11H9l-5 4z' }), createElement('path', { d: 'M8 9h8M8 12h5' }))
}

interface RightBarScope {
  readonly sidebarRightTabs: { register(definition: Record<string, unknown>): () => void }
  readonly slots: { inject(name: string, build: () => () => void): () => void; register(options: Record<string, unknown>, component: unknown): () => void }
  readonly locale: { bind(namespace: string): (key: A2aNetKey, values?: Record<string, string>) => string }
  effect(run: () => () => void, label?: string): void
}

/**
 * Add the view on a host that runs superagent and a client that has the right bar.
 * @param ctx - the client plugin's context.
 * @param namespace - this plugin's dictionary namespace.
 */
export function registerTeamRequest(ctx: ClientContext, namespace: string): void {
  const late = ctx as unknown as { inject?(services: string[], run: (scope: RightBarScope) => void): void }
  void fetch('/__dsh_a2a/superagent', { cache: 'no-store' })
    .then((response) => {
      // A 401 means the team exists and this page lacks the key: the view says so.
      if (response.status === 404) return
      late.inject?.(['sidebarRightTabs', 'slots', 'locale'], (scope) => {
        const t = scope.locale.bind(namespace)
        scope.effect(() => scope.sidebarRightTabs.register({
          id: TEAM_REQUEST_ID, kind: TEAM_REQUEST_KIND, priority: 'builtin', title: () => t('team.tab'),
          guide: [{ id: 'new', order: 40, title: () => t('team.tab'), description: () => t('team.guide'), icon: RequestIcon }],
        }), 'a2a-net: request tab type')
        scope.effect(() => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({ name: 'sidebar.right.pane.tab', key: TEAM_REQUEST_ID, locale: namespace }, TeamRequestTab)), 'a2a-net: request tab body')
      })
    })
    .catch(() => {})
}
