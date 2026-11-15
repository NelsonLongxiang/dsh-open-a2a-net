import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // A plugin instance in a test makes the superagent team's ygl-trees workspace and projects (ygl-home.ts); without this it
    // would write them into the developer's real ~/.ygl-trees-superagent. The global setup owns that home for the run and
    // removes it at the end (a config-time mkdtemp outlived every run).
    globalSetup: ['tests/global-ygl-home.ts'],
    // jsdom is requested per-file through @vitest-environment docblocks.
    server: {
      deps: {
        // The primitives package ships a bare CSS import (katex) in its
        // built lib; inlining it routes that import through Vite's css
        // stub instead of Node's ESM loader.
        inline: ['@deepseek-ai/dsh-client-ui-primitives'],
      },
    },
    exclude: [
      // Node's built-in runner owns the storefront metadata gate.
      'tests/market-metadata.test.mjs',
      // nexus-stage carries its own suite, consumed by the root gate via
      // `npm --prefix nexus-stage run test` — never double-scan it here.
      '**/nexus-stage/**',
      // Worktrees live under the main checkout's .claude/ and carry full
      // copies of this suite (often without rebuilt lib/ artifacts), which
      // turned `pnpm test` into hundreds of ghost failures on master.
      // Path filters resolve against the process cwd, so runs from inside a
      // worktree never match this pattern and keep seeing their own tests.
      '**/.claude/**',
      // Scratch space (supervisor/review repro drops, probe logs). The
      // review repro spec is intentionally NOT part of the gate: it pins
      // the pre-fix violation shape and expects the fixed tree to diverge.
      '**/tmp/**',
      ...configDefaults.exclude,
    ],
  },
})
