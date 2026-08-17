import { defineConfig } from 'vitest/config'

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
  },
})
