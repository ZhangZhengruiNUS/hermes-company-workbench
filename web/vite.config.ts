import { execSync } from 'child_process';
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 构建期注入 git SHA 用于 Sidebar 版本显示
const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();

// base 设为 /next/ — 预览入口, 静态资源相对路径
export default defineConfig({
  base: '/next/',
  define: { '__WB_VERSION__': JSON.stringify(sha) },
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
