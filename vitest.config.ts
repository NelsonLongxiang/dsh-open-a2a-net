import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
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
      // nexus-stage carries its own suite, consumed by the root gate via
      // `npm --prefix nexus-stage run test` — never double-scan it here.
      '**/nexus-stage/**',
      // Worktrees live under the main checkout's .claude/ and carry full
      // copies of this suite (often without rebuilt lib/ artifacts), which
      // turned `pnpm test` into hundreds of ghost failures on master.
      // Path filters resolve against the process cwd, so runs from inside a
      // worktree never match this pattern and keep seeing their own tests.
      '**/.claude/**',
      ...configDefaults.exclude,
    ],
  },
})
