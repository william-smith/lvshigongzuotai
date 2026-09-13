#!/usr/bin/env node
/**
 * 把 dist/ 同步到发布目录（../lawyer-workbench-site）。
 *
 * 用法：
 *   npm run build && npm run sync:site
 * 然后在对话里说「发布」，公网链接就会更新（链接地址不变）。
 *
 * 只复制构建产物：源码、.env、supabase/*.sql 都不会被带出去。
 */
import { rmSync, mkdirSync, cpSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const dist = join(root, 'dist')
// 两个发布目录都要同步：lawyer-workbench-site（备用副本）
// 与 lawyer-workbench-site-v3（线上部署实际使用的目录）
const siteDirs = [
  resolve(root, '..', 'lawyer-workbench-site'),
  resolve(root, '..', 'lawyer-workbench-site-v3'),
]

// 安全检查：这些文件绝不能被发布
const FORBIDDEN = ['.env', '.env.local', '.env.production']

try {
  statSync(dist)
} catch {
  console.error('✗ 找不到 dist/，先跑：npm run build')
  process.exit(1)
}

// 检查 dist 里没有混入敏感文件（Vite 不会复制 .env，但多一道保险）
const found = readdirSync(dist).filter((f) => FORBIDDEN.includes(f))
if (found.length) {
  console.error(`✗ dist/ 里发现敏感文件，已中止：${found.join(', ')}`)
  process.exit(1)
}

let files = []
for (const site of siteDirs) {
  rmSync(site, { recursive: true, force: true })
  mkdirSync(site, { recursive: true })
  cpSync(dist, site, { recursive: true })
  files = walk(site)
  console.log(`✓ 已同步 ${files.length} 个文件到 ${site}`)
}

function walk(dir, prefix = '') {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    const rel = prefix ? `${prefix}/${name}` : name
    return statSync(p).isDirectory() ? walk(p, rel) : [rel]
  })
}

for (const f of files) console.log('   ', f)
console.log('\n现在回到对话里说「发布」即可更新线上版本。')
