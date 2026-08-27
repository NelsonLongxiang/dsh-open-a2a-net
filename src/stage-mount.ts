/**
 * Stage-mount pathname resolution: both static stages (canvas office floor,
 * Three.js nexus viewer) serve one built Vite tree behind a mount prefix,
 * and both used to answer the bare `/mount` form directly with index.html.
 * That shell then resolved its `./assets/…` script reference against `/`,
 * fetched `/assets/index-*.js` from the web root — a 404 — and rendered a
 * silent black shell (`main.ts` returns early when state fetches fail). The
 * fix is the directory-classic one: a bare mount request redirects to
 * `mount/`, every other relative resolution then lands inside the tree.
 * @module @nelsonlongxiang/dsh-open-a2a-net/stage-mount
 */

/** Outcome of resolving one request pathname against a stage mount. */
export interface StageResolution {
  /** `301` target — present exactly when the client addressed the bare mount. */
  readonly redirectTo?: string
  /**
   * Mount-stripped file path, still percent-encoded and un-decoded, ready
   * for the handler's traversal guard and decode. `'/index.html'` when the
   * client addressed the mount itself.
   */
  readonly rel: string
}

/**
 * Resolve one request pathname against a stage mount prefix.
 * @param pathname - `req.url` verbatim (query string allowed, split here).
 * @param mount - the registered mount prefix, e.g. `/__dsh_a2a_nexus`.
 * @returns the redirect target plus the within-tree relative path.
 */
export function resolveStageMount(pathname: string, mount: string): StageResolution {
  const raw = pathname.split('?')[0] ?? '/'
  if (raw === mount) return { redirectTo: `${mount}/`, rel: '' }
  if (raw === `${mount}/`) return { rel: '/index.html' }
  let rel: string
  if (raw.startsWith(`${mount}/`)) rel = raw.slice(mount.length)
  else if (raw.startsWith('/')) rel = raw
  else rel = `/${raw}`
  return { rel }
}
