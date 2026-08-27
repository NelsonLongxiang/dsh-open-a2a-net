import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

const distDir = fileURLToPath(new URL('../assets/nexusDist', import.meta.url))

export default defineConfig({
  plugins: [],
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: distDir,
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})