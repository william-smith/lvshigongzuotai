#!/usr/bin/env node
/**
 * 云端接口连通性自检
 *
 *   npm run check:api
 *
 * 读根目录 .env，逐表请求一次，把常见问题直接翻译成人话：
 *   401/403 → 密钥填错
 *   404     → 地址少了 /rest/v1 或表没建
 *   200 但空 → 表建了但没导数据（或 RLS 拦住了）
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_PATH = join(ROOT, '.env')

function readEnv() {
  const env = { ...process.env }
  if (!existsSync(ENV_PATH)) return env
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

const argv = process.argv.slice(2)
const cliArg = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}

const env = readEnv()
const base = (env.VITE_API_BASE || '').replace(/\/+$/, '')
const key = env.VITE_API_KEY || ''
const authBase = base ? base.replace(/\/rest\/v1\/?$/, '') + '/auth/v1' : ''
// 密码不写进 .env，用命令行传：npm run check:api -- --email a@b.c --password xxx
const email = cliArg('email', env.VITE_AUTH_EMAIL || '')
const password = cliArg('password', '')

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', x: '\x1b[0m' }

if (!base || !key) {
  console.log(`${C.y}尚未配置云端${C.x}`)
  console.log(`  在 ${ENV_PATH} 填入 VITE_API_BASE 与 VITE_API_KEY 后再跑一次。`)
  console.log(`  不填也能用——程序会走本地演示数据。`)
  process.exit(0)
}

console.log(`接口地址 ${C.d}${base}${C.x}`)
console.log(`密钥     ${C.d}${key.slice(0, 8)}…${key.slice(-6)}${C.x}\n`)

/**
 * RLS 收紧成「必须已登录」之后，anon key 只能读到 0 条。
 * 所以先试着用邮箱密码换一个 access_token 再探测。
 */
async function login() {
  if (!authBase || !email || !password) return { token: null, note: '' }
  const res = await fetch(`${authBase}/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const b = await res.json().catch(() => ({}))
  if (!res.ok || !b.access_token) {
    return { token: null, note: `登录失败（HTTP ${res.status}）：${b.error_description || b.msg || '检查邮箱密码'}` }
  }
  return { token: b.access_token, note: '' }
}

let loginState
if (authBase) {
  if (email && password) {
    loginState = await login()
    if (loginState.token) console.log(`已用 ${email} 登录，逐表探测：\n`)
    else console.log(`${C.y}登录失败${C.x} ${loginState.note}`)
  } else {
    loginState = { token: null, note: '' }
    console.log(
      `${C.y}未传登录密码${C.x} — 只做匿名探测（收紧 RLS 后应当全部 0 条，属正常）\n` +
        `  想验证登录态读取：npm run check:api -- --email 你的邮箱 --password 你的密码\n`,
    )
  }
} else {
  loginState = { token: null, note: '' }
}
const token = loginState.token

const TABLES = [
  ['cases', '案件'],
  ['intakes', '接案线索'],
  ['contacts', '加密号码'],
  ['timeline', '时间线'],
  ['expenses', '费用'],
  ['materials', '材料'],
  ['vault_meta', '口令校验'],
]

async function probe(table) {
  const h = { apikey: key, Authorization: `Bearer ${token || key}`, Accept: 'application/json' }
  const url = `${base}/${table}?select=*&limit=1`
  const res = await fetch(url, { headers: h })
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 160)
    return { ok: false, status: res.status, detail }
  }
  // 总数：PostgREST 支持 Prefer: count=exact
  const cntRes = await fetch(`${base}/${table}?select=*&limit=1`, {
    headers: { ...h, Prefer: 'count=exact' },
  })
  const range = cntRes.headers.get('content-range') || ''
  const total = range.split('/')[1] ?? '?'
  return { ok: true, status: res.status, total }
}

let bad = 0
for (const [table, label] of TABLES) {
  let r
  try {
    r = await probe(table)
  } catch (e) {
    console.log(`${C.r}✗${C.x} ${label.padEnd(6)} ${table.padEnd(11)} 连不上：${e.message}`)
    console.log(`   ${C.y}→${C.x} 地址或网络有问题，确认地址以 /rest/v1 结尾且能公网访问`)
    bad++
    continue
  }
  if (!r.ok) {
    const hint =
      r.status === 401 || r.status === 403
        ? '密钥不对：复制完整的 anon/publishable key，别带空格'
        : r.status === 404
          ? '表不存在：先执行 supabase/schema.sql；或地址末尾少了 /rest/v1'
          : '见下方返回内容'
    console.log(`${C.r}✗${C.x} ${label.padEnd(6)} ${table.padEnd(11)} HTTP ${r.status} — ${hint}`)
    if (r.detail) console.log(`   ${C.d}${r.detail}${C.x}`)
    bad++
  } else if (r.total === '0') {
    const note = token
      ? '表是空的，去执行 supabase/seed.sql'
      : '匿名读到 0 条 —— RLS 已生效，未登录看不到数据（正常）'
    console.log(`${C.y}!${C.x} ${label.padEnd(6)} ${table.padEnd(11)} 0 条 — ${note}`)
  } else {
    console.log(`${C.g}✓${C.x} ${label.padEnd(6)} ${table.padEnd(11)} ${r.total} 条`)
  }
}

console.log()
if (bad === 0) {
  console.log(`${C.g}全部通过${C.x} — 重启 npm run dev 即可切到云端数据`)
} else {
  console.log(`${C.r}${bad} 项未通过${C.x}，按上面提示逐条处理`)
  process.exitCode = 1
}
