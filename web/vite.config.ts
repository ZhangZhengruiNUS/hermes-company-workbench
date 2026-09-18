import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base 设为 /next/ — 预览入口, 静态资源相对路径
export default defineConfig({
  base: '/next/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/motion')) return 'motion'
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'vendor'
        },
      },
    },
  },
})
