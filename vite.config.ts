// @ts-nocheck
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 本次构建的唯一标识：用于 SW 缓存名 + 版本自检，确保部署后用户必拉新包。
const BUILD_HASH = Date.now().toString(36)

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'inject-build-version',
      apply: 'build',
      enforce: 'post',
      closeBundle() {
        const dist = path.resolve(__dirname, 'dist')
        if (!fs.existsSync(dist)) return
        // 写版本清单（应用启动自检用；SW 已设为对该路径网络优先不缓存）
        fs.writeFileSync(
          path.join(dist, 'version.json'),
          JSON.stringify({ version: BUILD_HASH, time: new Date().toISOString() }),
        )
        // 把 sw.js 里的占位符换成构建哈希：每次部署缓存名不同 → 旧缓存自动失效
        const swPath = path.join(dist, 'sw.js')
        if (fs.existsSync(swPath)) {
          const s = fs.readFileSync(swPath, 'utf8').replace(/\{\{BUILD_HASH\}\}/g, BUILD_HASH)
          fs.writeFileSync(swPath, s)
        }
      },
    },
  ],
  define: {
    // 暴露给应用做版本自检；esbuild 在构建期直接文本替换为字符串字面量。
    __APP_VERSION__: JSON.stringify(BUILD_HASH),
  },
  server: { host: true, port: 5173 },
  build: { outDir: 'dist', sourcemap: false },
})
