#!/usr/bin/env node
/**
 * 一键部署到 Supabase（走官方 Management API，不需要在网页上手工点）
 *
 *   set SUPABASE_ACCESS_TOKEN=sbp_xxxx
 *   node scripts/deploy_supabase.mjs
 *
 * 会依次完成：
 *   1. 列出你名下的项目（多个时用 --project <ref> 指定）
 *   2. 执行 supabase/schema.sql 建表
 *   3. 分批执行 supabase/seed.sql 导数据（自动分块，避开体积限制）
 *   4. 取回 anon key，写入根目录 .env
 *
 * 拿 token：https://supabase.com/dashboard/account/tokens → Generate new token
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://api.supabase.com/v1'
const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }

// ---------- 参数 ----------
const argv = process.argv.slice(2)
function arg(name, def = null) {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : def
}
const TOKEN = arg('token') || process.env.SUPABASE_ACCESS_TOKEN || ''
const WANT_REF = arg('project')
const SKIP_SEED = argv.includes('--skip-seed')

if (!TOKEN) {
  console.log(`${C.y}缺少 SUPABASE_ACCESS_TOKEN${C.x}`)
  console.log(`  1. 打开 ${C.b}https://supabase.com/dashboard/account/tokens${C.x}`)
  console.log(`  2. Generate new token，复制（形如 sbp_xxxx）`)
  console.log(`  3. 回到终端执行：`)
  console.log(`     ${C.d}set SUPABASE_ACCESS_TOKEN=sbp_xxxx${C.x}`)
  console.log(`     ${C.d}node scripts/deploy_supabase.mjs${C.x}`)
  process.exit(1)
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
}

async function call(path, options = {}) {
  const res = await fetch(`${API}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } })
  const text = await res.text()
  let body = text
  try {
    body = JSON.parse(text)
  } catch {
    /* 非 JSON，保留原文 */
  }
  if (!res.ok) {
    const msg = body?.message || body?.error || text.slice(0, 200)
    throw new Error(`HTTP ${res.status} — ${msg}`)
  }
  return body
}

/** 执行一段 SQL（Supabase 的 database/query 端点） */
async function runSql(ref, sql) {
  const r = await call(`/projects/${ref}/database/query`, {
    method: 'POST',
    body: JSON.stringify({ query: sql }),
  })
  return r
}

/** 把 seed.sql 按语句边界切成若干块，每块不超过 maxBytes */
function chunkSql(lines, maxBytes = 90_000) {
  const chunks = []
  let buf = []
  let size = 0
  for (const line of lines) {
    buf.push(line)
    size += Buffer.byteLength(line, 'utf8') + 1
    const isEnd = line.trimEnd().endsWith(';')
    if (isEnd && size >= maxBytes) {
      chunks.push(buf.join('\n'))
      buf = []
      size = 0
    }
  }
  if (buf.length) chunks.push(buf.join('\n'))
  return chunks
}

async function main() {
  // ---------- 1. 选项目 ----------
  console.log(`${C.d}正在读取项目列表…${C.x}`)
  const projects = await call('/projects')
  if (!Array.isArray(projects) || projects.length === 0) {
    console.log(`${C.r}名下没有项目${C.x} — 先到 supabase.com 新建一个（选离你最近的地域，如 Singapore/Tokyo）`)
    return
  }
  let project
  if (WANT_REF) {
    project = projects.find((p) => p.id === WANT_REF || p.ref === WANT_REF)
    if (!project) {
      console.log(`${C.r}找不到项目 ${WANT_REF}${C.x}，可选：`)
      projects.forEach((p) => console.log(`  ${p.id}  ${p.name}`))
      return
    }
  } else if (projects.length === 1) {
    project = projects[0]
  } else {
    console.log(`${C.y}你有多个项目，用 --project <ref> 指定${C.x}：`)
    projects.forEach((p) => console.log(`  ${C.b}${p.id}${C.x}  ${p.name}  ${C.d}(${p.region})${C.x}`))
    return
  }

  const ref = project.id
  console.log(`${C.g}✓${C.x} 项目 ${C.b}${project.name}${C.x} ${C.d}(${ref} · ${project.region})${C.x}\n`)

  // ---------- 2. 建表 ----------
  const schema = readFileSync(join(ROOT, 'supabase', 'schema.sql'), 'utf8')
  process.stdout.write(`建表 schema.sql … `)
  try {
    await runSql(ref, schema)
    console.log(`${C.g}完成${C.x}`)
  } catch (e) {
    console.log(`${C.r}失败${C.x}\n  ${e.message}`)
    console.log(`  ${C.y}若提示表已存在，可忽略；否则到控制台 SQL Editor 手工执行该文件。${C.x}`)
    return
  }

  // ---------- 3. 导数据 ----------
  if (!SKIP_SEED) {
    const raw = readFileSync(join(ROOT, 'supabase', 'seed.sql'), 'utf8')
    const lines = raw
      .split(/\r?\n/)
      .filter((l) => l.trim() && !/^\s*(begin|commit)\s*;/i.test(l) && !l.startsWith('--'))
    const chunks = chunkSql(lines)
    console.log(`导数据 seed.sql（${chunks.length} 批）…`)
    for (let i = 0; i < chunks.length; i++) {
      process.stdout.write(`  第 ${i + 1}/${chunks.length} 批 … `)
      try {
        await runSql(ref, `begin;\n${chunks[i]}\ncommit;`)
        console.log(`${C.g}完成${C.x}`)
      } catch (e) {
        console.log(`${C.r}失败${C.x}\n    ${e.message.slice(0, 300)}`)
        return
      }
    }
  }

  // ---------- 4. 取 anon key ----------
  process.stdout.write(`读取 API 密钥 … `)
  let anonKey = null
  let projectUrl = `https://${ref}.supabase.co`
  try {
    const keys = await call(`/projects/${ref}/api-keys`)
    const arr = Array.isArray(keys) ? keys : keys?.keys ?? []
    anonKey = arr.find((k) => k.name === 'anon' || k.name === 'publishable' || k.type === 'anon')?.api_key
  } catch {
    /* 新接口不可用，走旧接口 */
  }
  if (!anonKey) {
    try {
      const s = await call(`/projects/${ref}/settings`)
      anonKey = s?.service_api_key ? null : null
      const legacy = s?.anon_key || s?.anonKey
      if (legacy) anonKey = legacy
    } catch {
      /* 忽略 */
    }
  }
  if (!anonKey) {
    console.log(`${C.y}自动取不到${C.x}`)
    console.log(`  到控制台 ${C.b}Project Settings → API${C.x} 复制 anon public，手工填进 .env`)
  } else {
    console.log(`${C.g}完成${C.x}`)
  }

  // ---------- 5. 写 .env ----------
  const envPath = join(ROOT, '.env')
  let passphrase = 'demo-2026'
  let existing = ''
  if (existsSync(envPath)) {
    existing = readFileSync(envPath, 'utf8')
    const m = existing.match(/^\s*VITE_DEMO_PASSPHRASE\s*=\s*(.*)$/m)
    if (m) passphrase = m[1].trim()
  }
  const next = [
    '# 由 scripts/deploy_supabase.mjs 自动生成',
    `VITE_API_BASE=${projectUrl}/rest/v1`,
    `VITE_API_KEY=${anonKey ?? '在这里填 anon public key'}`,
    `VITE_DEMO_PASSPHRASE=${passphrase}`,
    '',
  ].join('\n')
  writeFileSync(envPath, next, 'utf8')
  console.log(`\n${C.g}已写入 .env${C.x}`)
  console.log(`  VITE_API_BASE=${projectUrl}/rest/v1`)
  console.log(`  VITE_API_KEY=${anonKey ? anonKey.slice(0, 12) + '…' + anonKey.slice(-6) : '（待填）'}`)

  console.log(`\n下一步：\n  ${C.b}npm run check:api${C.x}  ${C.d}验证连通性${C.x}\n  ${C.b}npm run dev${C.x}       ${C.d}启动${C.x}`)
}

main().catch((e) => {
  console.error(`\n${C.r}出错了${C.x}`, e.message)
  process.exitCode = 1
})
