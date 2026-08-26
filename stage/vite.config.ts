import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const stageDist = fileURLToPath(new URL('../assets/stageDist', import.meta.url))

export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: stageDist,
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})