/**
 * Supabase（PostgREST）数据快照备份。
 *
 * 为什么自己备份：
 *   Supabase 免费版没有每日备份，付费版才有 PITR；而且本项目的商业秘密明文、
 *   脱敏副本、密文都在这几张表里，出服务端事故或被误删就没有退路。
 *   本脚本只依赖 PostgREST 标准 REST（和前端同一套），换平台不用改代码。
 *
 * 关键前提：RLS 只允许 authenticated 读写，**anon key 一条都读不到**。
 *   所以全量备份必须用 service_role key（或能换出它的 Management token）。
 *
 * 用法：
 *   node scripts/backup_supabase.mjs                    # 全量快照到 backups/<时间戳>/
 *   node scripts/backup_supabase.mjs --dry-run          # 只报行数，不落盘
 *   node scripts/backup_supabase.mjs --keep 30          # 只保留最近 30 份
 *   node scripts/backup_supabase.mjs --to D:\\NAS\\备份   # 指定输出根目录
 *   node scripts/backup_supabase.mjs --verify backups/20260923_0030
 *
 * 凭据（按优先级，取到第一个可用即止）：
 *   1) --service-role eyJ...        或环境变量 SUPABASE_SERVICE_ROLE
 *   2) .env / .env.local 里的 SUPABASE_SERVICE_ROLE（推荐：写一次长期生效，已被 .gitignore 忽略）
 *   3) Management token：--token sbp_xxx 或 SUPABASE_ACCESS_TOKEN → 用它换出 service_role（不落盘）
 *   4) 兜底：.env 里的 anon key —— ⚠️ 只能导出 RLS 放行的行，通常是 0 条，脚本会红字告警
 *
 * 产出：
 *   <root>/<YYYYMMDD_HHMM>/<table>.json     每表一个 JSON 数组（原样还原字段）
 *   <root>/<YYYYMMDD_HHMM>/_auth_users.json 登录账号清单（需 service_role，不含密码）
 *   <root>/<YYYYMMDD_HHMM>/_manifest.json   行数 / 字节数 / SHA-256 清单（校验与恢复都读它）
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureProxy } from './net-proxy.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

const C = { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', x: '\x1b[0m' }
const ok = (m) => console.log(`${C.green}✓${C.x} ${m}`)
const warn = (m) => console.log(`${C.yellow}⚠${C.x} ${m}`)
const err = (m) => console.error(`${C.red}✗${C.x} ${m}`)
const step = (m) => console.log(`${C.dim}→${C.x} ${m}`)

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

/**
 * --verify：纯离线校验已有快照的 SHA-256 与行数，确认没被改坏。
 * 刻意放在所有联网/凭据逻辑之前——校验一份备份不该依赖数据库连得上。
 */
const verifyDir = arg('verify')
if (verifyDir) {
  const dir = resolve(process.cwd(), verifyDir)
  if (!existsSync(dir)) {
    err(`目录不存在：${dir}`)
    process.exit(1)
  }
  const manFile = join(dir, '_manifest.json')
  if (!existsSync(manFile)) {
    err(`缺少 _manifest.json：${dir}（这可能是导出到一半失败留下的残缺快照）`)
    process.exit(1)
  }
  const man = JSON.parse(readFileSync(manFile, 'utf8'))
  let bad = 0
  for (const t of man.tables) {
    const p = join(dir, `${t.table}.json`)
    if (!existsSync(p)) {
      err(`${t.table}.json 缺失`)
      bad++
      continue
    }
    const txt = readFileSync(p, 'utf8')
    const hash = sha256(txt)
    const rows = JSON.parse(txt).length
    if (hash !== t.sha256) {
      err(`${t.table}: 校验和不符（文件可能被改过或已损坏）`)
      bad++
    } else if (rows !== t.rows) {
      err(`${t.table}: 行数不符 清单 ${t.rows} / 实际 ${rows}`)
      bad++
    } else {
      ok(`${t.table.padEnd(14)} ${String(rows).padStart(6)} 行  ✓ 完整`)
    }
  }
  const rowsTotal = man.tables.reduce((s, t) => s + t.rows, 0)
  const bytesTotal = man.tables.reduce((s, t) => s + t.bytes, 0)
  if (bad) {
    err(`校验失败：${bad} 张表有问题，这份快照不可用于恢复`)
    process.exit(1)
  }
  ok(`快照完整：${dir}`)
  console.log(`   ${man.tables.length} 张表 / ${rowsTotal} 行 / ${(bytesTotal / 1024).toFixed(1)} KB   导出于 ${man.exported_at}`)
  process.exit(0)
}

/** 读 .env / .env.local，返回键值（不会泄漏到子进程环境之外的输出里） */
function readDotEnv(name) {
  for (const f of ['.env.local', '.env']) {
    const p = join(repoRoot, f)
    if (!existsSync(p)) continue
    try {
      const txt = readFileSync(p, 'utf8')
      const m = txt.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, 'm'))
      if (m) return m[1].replace(/^["']|["']$/g, '')
    } catch {
      /* 忽略读失败：可能没权限 */
    }
  }
  return undefined
}

const envApiBase = readDotEnv('VITE_API_BASE') || process.env.VITE_API_BASE
const envAnon = readDotEnv('VITE_API_KEY') || process.env.VITE_API_KEY
if (!envApiBase) {
  err('拿不到 VITE_API_BASE：请检查 .env，或用 --base https://xxx.supabase.co/rest/v1')
  process.exit(1)
}
const BASE = (arg('base') || envApiBase).replace(/\/+$/, '')
const refMatch = BASE.match(/https?:\/\/([^./]+)\./)
const PROJECT_REF = refMatch ? refMatch[1] : 'unknown'

// Node 的 fetch 默认不走 HTTPS_PROXY；本机常靠代理出网，这里先探一次直连
await ensureProxy(BASE)

/* ---------------- 1. 凭据链 ---------------- */

async function fetchServiceRoleViaMgmt(token) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    err(`Management API 取 key 失败 ${res.status}：${(await res.text()).slice(0, 300)}`)
    process.exit(1)
  }
  const arr = await res.json()
  const found = (Array.isArray(arr) ? arr : []).find((k) => k.name === 'service_role')
  if (!found?.api_key) {
    err('拿不到 service_role key')
    process.exit(1)
  }
  return found.api_key
}

// Management token：既可以用来换 service_role，也可以在 REST 不通时直接执行 SQL 取数
const mgmtToken =
  arg('token') || process.env.SUPABASE_ACCESS_TOKEN || readDotEnv('SUPABASE_ACCESS_TOKEN') || ''

let keyRole = 'service_role'
let serviceKey =
  arg('service-role') || process.env.SUPABASE_SERVICE_ROLE || readDotEnv('SUPABASE_SERVICE_ROLE') || ''

if (!serviceKey && mgmtToken) {
  step('用 Management token 换 service_role（仅本次内存使用，不落盘）')
  serviceKey = await fetchServiceRoleViaMgmt(mgmtToken)
}

let headers
if (serviceKey) {
  headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json' }
} else {
  warn('没有 service_role —— 退回 anon key，RLS 会挡住绝大多数表（导出很可能是空表）')
  headers = { apikey: envAnon || '', Authorization: `Bearer ${envAnon || ''}`, Accept: 'application/json' }
  keyRole = 'anon（受限）'
}

/**
 * 服务端执行 SQL（Supabase Management API）。
 * 用途：REST 端点被网络挡住时的备用取数通道；Management token 是账户级权限，不受 RLS 限制。
 * 注意：成功状态码可能是 200 也可能是 201（该接口的实际行为）。
 */
async function mgmtSql(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mgmtToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Management SQL ${res.status}: ${text.slice(0, 200)}`)
  }
  return JSON.parse(text)
}

async function discoverTablesMgmt() {
  const rows = await mgmtSql(
    "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name"
  )
  const names = rows.map((r) => r.table_name).filter(Boolean)
  return names.length ? names : null
}

async function fetchTableMgmt(table) {
  const cnt = await mgmtSql(`select count(*)::int as n from public.${table}`)
  const total = cnt[0]?.n ?? 0
  const rows = []
  const PAGE = 1000
  for (let offset = 0; offset < Math.max(total, 1); offset += PAGE) {
    const part = await mgmtSql(
      `select coalesce(json_agg(x), '[]'::json) as data from (select * from public.${table} order by ctid limit ${PAGE} offset ${offset}) x`
    )
    const arr = part[0]?.data || []
    rows.push(...arr)
    if (arr.length < PAGE) break
  }
  return { rows, total }
}

/* ---------------- 2.5 通道选择：REST 优先，不通就降级到 Management SQL ---------------- */

async function probeRest() {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    const res = await fetch(BASE, { headers, signal: ctrl.signal })
    clearTimeout(timer)
    return res.status < 500
  } catch {
    return false
  }
}

const viaArg = arg('via')
let transport = 'rest'
if (viaArg === 'mgmt') {
  transport = 'mgmt'
} else if (viaArg === 'rest') {
  transport = 'rest'
} else {
  const reachable = await probeRest()
  if (!reachable && mgmtToken) {
    transport = 'mgmt'
    warn(`REST 端点连不上（可能被网络/代理挡了），改用 Management SQL 通道取数`)
  } else if (!reachable) {
    warn('REST 端点连不上，且没有 Management token 可降级——导出很可能失败')
  }
}

/* ---------------- 2. 自动发现表 ---------------- */

async function discoverTables() {
  if (transport === 'mgmt') {
    try {
      return await discoverTablesMgmt()
    } catch (e) {
      warn(`Management SQL 发现表失败：${String(e.message).slice(0, 120)}`)
      return null
    }
  }
  try {
    const res = await fetch(BASE, { headers: { ...headers, Accept: 'application/openapi+json' } })
    if (!res.ok) return null
    const doc = await res.json()
    const fromPaths = Object.keys(doc.paths || {})
      .filter((p) => /^\/[^/]+$/.test(p))
      .filter((p) => (doc.paths[p] || {}).get)
      .map((p) => p.slice(1))
    const fromDefs = Object.keys(doc.definitions || {})
    const all = [...new Set([...fromPaths, ...fromDefs])].filter(Boolean)
    return all.length ? all.sort() : null
  } catch {
    return null
  }
}

// OpenAPI 不可用时的兜底：schema.sql 里的业务表
const FALLBACK_TABLES = [
  'cases',
  'intakes',
  'contacts',
  'timeline',
  'expenses',
  'materials',
  'vault_meta',
  'case_folders',
]

const onlyArg = arg('tables')
const discovered = await discoverTables()
let tables
if (onlyArg) {
  tables = onlyArg.split(',').map((s) => s.trim()).filter(Boolean)
} else if (discovered) {
  // 用 OpenAPI 自动发现的表（新增表会自动进来，不用改脚本）
  tables = discovered
} else {
  warn('OpenAPI 不可用，按 schema.sql 的固定表清单备份')
  tables = FALLBACK_TABLES
}
// 过滤掉明显不是数据表的路径（视图/edge 函数不会出现在 definitions 里，这里再做一层保险）
tables = tables.filter((t) => /^[a-z_][a-z0-9_]*$/i.test(t))

/* ---------------- 3. 分页导出 ---------------- */

const PAGE = 1000

async function fetchTable(table) {
  const rows = []
  let start = 0
  let total = null
  for (let guard = 0; guard < 10000; guard++) {
    const res = await fetch(`${BASE}/${encodeURIComponent(table)}?select=*`, {
      headers: { ...headers, Range: `${start}-${start + PAGE - 1}`, Prefer: 'count=exact' },
    })
    if (!res.ok) {
      const t = await res.text()
      throw new Error(`HTTP ${res.status} ${t.slice(0, 200)}`)
    }
    const cr = res.headers.get('content-range')
    if (cr && cr.includes('/')) {
      const n = Number(cr.split('/')[1])
      if (!Number.isNaN(n)) total = n
    }
    const chunk = await res.json()
    if (!Array.isArray(chunk)) throw new Error('返回不是数组，可能被网关改写了')
    rows.push(...chunk)
    if (chunk.length < PAGE) break
    start += PAGE
    if (total !== null && rows.length >= total) break
  }
  return { rows, total: total ?? rows.length }
}

/** 按通道分发：REST（默认）或 Management SQL（降级） */
async function fetchAnyTable(table) {
  return transport === 'mgmt' ? fetchTableMgmt(table) : fetchTable(table)
}

/** 登录账号清单（仅 service_role 可用；Supabase 自托管才有的 auth 端点） */
async function fetchAuthUsers() {
  // REST 通道 + service_role 才有 Supabase Auth 管理端点；走 Management SQL 降级时直接跳过
  if (transport !== 'rest' || keyRole !== 'service_role') return null
  const root = BASE.replace(/\/rest\/v1$/, '')
  try {
    if (!/\.supabase\.co$/i.test(new URL(root).host)) return null
    const users = []
    for (let page = 1; page <= 50; page++) {
      const res = await fetch(`${root}/auth/v1/admin/users?page=${page}&per_page=200`, { headers })
      if (!res.ok) return page === 1 ? null : users
      const data = await res.json()
      const arr = Array.isArray(data) ? data : data.users || []
      const clean = arr.map((u) => ({
        id: u.id,
        email: u.email,
        phone: u.phone ?? null,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        email_confirmed_at: u.email_confirmed_at ?? null,
        // 刻意不导出 password_hash / mfa / recovery_token：备份不需要凭据材料
      }))
      users.push(...clean)
      if (arr.length < 200) break
    }
    return users
  } catch {
    // auth 端点不通不该让整份快照功亏一篑——表数据才是主体
    return null
  }
}

const nowStamp = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

/* ---------------- 4. 主流程 ---------------- */

const dryRun = hasFlag('dry-run')
// 输出根目录优先级：--to > .env.local 的 BACKUP_TO > 环境变量 > 仓库内 backups/
// 想做异地冗余就把 BACKUP_TO 指到 Verysync / NAS 的同步目录（一次性配好在 .env.local）
const outRoot =
  arg('to') || readDotEnv('BACKUP_TO') || process.env.BACKUP_TO || join(repoRoot, 'backups')


step(`项目 ${PROJECT_REF}  身份 ${keyRole}`)
step(`待导出表：${tables.join(', ')}`)

if (dryRun) {
  warn('dry-run 模式：只统计行数，不写文件')
  let totalRows = 0
  for (const t of tables) {
    try {
      const { rows, total } = await fetchAnyTable(t)
      totalRows += rows.length
      console.log(`   ${t.padEnd(16)} ${String(rows.length).padStart(6)} 行 ${C.dim}(服务端计数 ${total})${C.x}`)
    } catch (e) {
      console.log(`   ${t.padEnd(16)} ${C.red}失败${C.x} ${String(e.message).slice(0, 120)}`)
    }
  }
  console.log(`\n合计 ${totalRows} 行。去掉 --dry-run 即真正导出。`)
  process.exit(0)
}

const snapDir = join(outRoot, nowStamp())
mkdirSync(snapDir, { recursive: true })

const manifest = {
  tool: 'scripts/backup_supabase.mjs',
  exported_at: new Date().toISOString(),
  project_ref: PROJECT_REF,
  api_base: BASE,
  key_role: keyRole,
  tables: [],
}

let failed = 0
for (const t of tables) {
  try {
    const { rows } = await fetchAnyTable(t)
    const txt = JSON.stringify(rows, null, 2)
    writeFileSync(join(snapDir, `${t}.json`), txt, 'utf8')
    manifest.tables.push({
      table: t,
      rows: rows.length,
      bytes: Buffer.byteLength(txt, 'utf8'),
      sha256: sha256(txt),
    })
    ok(`${t.padEnd(16)} ${String(rows.length).padStart(6)} 行`)
  } catch (e) {
    failed++
    err(`${t}: ${String(e.message).slice(0, 200)}`)
  }
}

const users = await fetchAuthUsers()
if (users) {
  const txt = JSON.stringify(users, null, 2)
  writeFileSync(join(snapDir, '_auth_users.json'), txt, 'utf8')
  manifest.auth_users = { rows: users.length, sha256: sha256(txt) }
  ok(`auth_users       ${String(users.length).padStart(6)} 个账号`)
}

writeFileSync(join(snapDir, '_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

/* ---------------- 5. 保留策略 ---------------- */

const keep = Number(arg('keep') || process.env.BACKUP_KEEP || 14)
const isSnapshot = (n) => /^\d{8}_\d{4}$/.test(n)
const dirs = readdirSync(outRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory() && isSnapshot(d.name))
  .map((d) => d.name)
  .sort()
  .reverse()

let pruned = 0
for (const name of dirs.slice(keep)) {
  rmSync(join(outRoot, name), { recursive: true, force: true })
  pruned++
}

const totalRows = manifest.tables.reduce((s, t) => s + t.rows, 0)
const totalBytes = manifest.tables.reduce((s, t) => s + t.bytes, 0)

console.log('')
if (failed) {
  warn(`完成，但 ${failed} 张表导出失败（见上方红字），快照不完整`)
} else {
  ok(`备份完成：${snapDir}`)
}
console.log(
  `   ${manifest.tables.length} 张表 / ${totalRows} 行 / ${(totalBytes / 1024).toFixed(1)} KB` +
    `   保留最近 ${keep} 份${pruned ? `（本次清理 ${pruned} 份旧快照）` : ''}`
)
process.exit(failed ? 1 : 0)
