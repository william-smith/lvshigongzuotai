#!/usr/bin/env node
/**
 * 打开 Supabase 邮箱登录并收紧数据权限，让前端可以安全部署到公网。
 *
 * 做四件事：
 *   1. 用 Admin API 建一个已验证邮箱的登录账号（不需要收确认邮件）
 *   2. 关闭公开注册（否则任何人都能注册进来读走全部案件）
 *   3. 把 7 张表的 RLS 从「持有 key 即可读写」改成「必须已登录」
 *   4. 写入 .env 中的登录邮箱
 *
 * 用法：
 *   node scripts/setup_auth.mjs --token sbp_xxx [--email you@example.com] [--password xxx]
 *   node scripts/setup_auth.mjs --token sbp_xxx --skip-user      # 只改策略，不建账号
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MGMT = 'https://api.supabase.com/v1'

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2)
function arg(name, def) {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}
const has = (n) => argv.includes(`--${n}`)
const TOKEN = arg('token', process.env.SUPABASE_ACCESS_TOKEN || '')
const PROJECT_REF = arg('project', process.env.SUPABASE_PROJECT_REF || '')
const SKIP_USER = has('skip-user')

/* ---------- 读 .env ---------- */
const envPath = path.join(ROOT, '.env')
const env = {}
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2]
  }
}
const REST_BASE = env.VITE_API_BASE || ''
if (!REST_BASE) {
  console.error('✗ 未找到 .env 里的 VITE_API_BASE，先跑 node scripts/deploy_supabase.mjs')
  process.exit(1)
}
const ref = PROJECT_REF || (REST_BASE.match(/https:\/\/([^.]+)\./) || [])[1]
const SITE = `https://${ref}.supabase.co`
const AUTH = `${SITE}/auth/v1`

function updateEnv(key, value) {
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    const i = lines.findIndex((l) => l.startsWith(`${key}=`))
    if (i >= 0) lines[i] = `${key}=${value}`
    else lines.push(`${key}=${value}`)
    fs.writeFileSync(envPath, lines.filter((l) => l !== '').join('\n') + '\n', 'utf8')
  } else {
    fs.writeFileSync(envPath, `${key}=${value}\n`, 'utf8')
  }
}

const step = (n, msg) => console.log(`\n[${n}] ${msg}`)
const ok = (msg) => console.log(`    ✓ ${msg}`)
const warn = (msg) => console.log(`    ! ${msg}`)

/* ---------- 1. 拿 service_role key ---------- */
step(1, `连接项目 ${ref} …`)
if (!TOKEN) {
  console.error('✗ 缺少 Management API token：--token sbp_xxx')
  process.exit(1)
}
const mgmt = async (p, init) => {
  const res = await fetch(MGMT + p, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${txt.slice(0, 200)}`)
  return txt ? JSON.parse(txt) : {}
}

let serviceKey = ''
try {
  const keys = await mgmt(`/projects/${ref}/api-keys`)
  const arr = Array.isArray(keys) ? keys : keys.data || []
  serviceKey = (arr.find((k) => k.name === 'service_role') || {}).api_key || ''
} catch (e) {
  warn(`读取密钥失败：${e.message}`)
}
if (!serviceKey) {
  console.error('✗ 拿不到 service_role key，无法建账号')
  process.exit(1)
}
ok('已获取 service_role（仅用于本次建账号，不写入前端）')

/* ---------- 2. 建登录账号 ---------- */
let email = arg('email', env.VITE_AUTH_EMAIL || 'lawyer@workbench.local')
let password = arg('password', '')
if (!password) {
  const words = ['Kai', 'Tuo', 'Ming', 'Rui', 'An', 'Yue', 'Chen', 'Xi']
  const pick = (a) => a[Math.floor(Math.random() * a.length)]
  password = `${pick(words)}${pick(words)}-${Math.floor(1000 + Math.random() * 9000)}`
}

if (SKIP_USER) {
  step(2, '跳过建账号（--skip-user）')
} else {
  step(2, `建登录账号 ${email} …`)
  const admin = async (p, init) => {
    const res = await fetch(AUTH + p, {
      ...init,
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json', ...(init?.headers || {}) },
    })
    const txt = await res.text()
    let body = {}
    try { body = txt ? JSON.parse(txt) : {} } catch { body = { raw: txt } }
    return { status: res.status, body }
  }

  // 已存在则改密码
  const list = await admin('/admin/users?page=1&per_page=100')
  const exist = Array.isArray(list.body?.users)
    ? list.body.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase())
    : (list.body.users || []).find?.((u) => (u.email || '').toLowerCase() === email.toLowerCase())

  if (exist) {
    const r = await admin(`/admin/users/${exist.id}`, {
      method: 'PUT',
      body: JSON.stringify({ password, email_confirm: true }),
    })
    if (r.status >= 400) warn(`更新账号失败：${r.status} ${JSON.stringify(r.body).slice(0, 120)}`)
    else ok('账号已存在，密码已重置')
  } else {
    const r = await admin('/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { role: 'lawyer' } }),
    })
    if (r.status >= 400) {
      console.error(`✗ 建账号失败：${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
      process.exit(1)
    }
    ok('账号已创建（邮箱已预验证，无需收确认邮件）')
  }

  // 验证能登录
  const login = await fetch(`${AUTH}/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.VITE_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const lb = await login.json().catch(() => ({}))
  if (!login.ok || !lb.access_token) {
    console.error(`✗ 账号建了但登录失败：${login.status} ${JSON.stringify(lb).slice(0, 200)}`)
    console.error('  多半是项目里关掉了邮箱登录：控制台 Authentication → Providers → Email 打开')
    process.exit(1)
  }
  ok('试登录通过，access_token 正常签发')
  updateEnv('VITE_AUTH_EMAIL', email)
}

/* ---------- 3. 关闭公开注册 ---------- */
step(3, '关闭公开注册 …')
try {
  await mgmt(`/projects/${ref}/config/auth`, { method: 'PATCH', body: JSON.stringify({ disable_signup: true }) })
  ok('已关闭（陌生人无法自己注册）')
} catch (e) {
  warn(`自动关闭失败：${e.message.slice(0, 120)}`)
  warn('请手动：控制台 Authentication → Sign In / Providers → 关闭 Allow new users to sign up')
}

/* ---------- 4. 收紧 RLS ---------- */
step(4, '收紧 RLS：改成「必须已登录」…')
const sql = `
do $$
declare t text;
begin
  foreach t in array array['cases','intakes','contacts','timeline','expenses','materials','vault_meta']
  loop
    execute format('drop policy if exists p_all_%1$s on public.%1$I', t);
    execute format('drop policy if exists p_auth_%1$s on public.%1$I', t);
    execute format(
      'create policy p_auth_%1$s on public.%1$I for all to authenticated using (auth.role() = %2$L) with check (auth.role() = %2$L)',
      t, 'authenticated');
  end loop;
end $$;
`
try {
  await mgmt(`/projects/${ref}/database/query`, { method: 'POST', body: JSON.stringify({ query: sql }) })
  ok('7 张表已收紧')
} catch (e) {
  console.error(`✗ 改策略失败：${e.message.slice(0, 200)}`)
  process.exit(1)
}

/* ---------- 5. 复查：匿名是否真的读不到 ---------- */
step(5, '复查：用 anon key（未登录）读数据，应当读不到 …')
const anon = await fetch(`${REST_BASE}/cases?select=id&limit=1`, {
  headers: { apikey: env.VITE_API_KEY, Authorization: `Bearer ${env.VITE_API_KEY}` },
})
const cnt = (await anon.json()).length
if (cnt === 0) ok('匿名读到 0 条 —— 公开部署已安全')
else {
  console.error(`✗ 匿名仍能读到 ${cnt} 条！策略没生效，先别部署公网`)
  process.exit(1)
}

console.log('\n' + '─'.repeat(56))
console.log('完成。登录账号：')
console.log(`  邮箱：${email}`)
console.log(`  密码：${password}`)
console.log('─'.repeat(56))
console.log('把上面两行记到密码管理器。改密码：控制台 Authentication → Users。')
console.log('前端启动 npm run dev，会先出现登录页。')
