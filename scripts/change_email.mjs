#!/usr/bin/env node
/**
 * 改 Supabase Auth 登录邮箱（=登录用户名）。
 * 复用 setup_auth.mjs 的 Admin API 写法：service_role 密钥 → 列出用户 → 改 email（直接确认，免收验证邮件）。
 *
 * 需要的凭据（二选一，仅运行时内存使用，不写盘）：
 *   --token sbp_xxx            Supabase Management API token（控制台 Account → Access Tokens）
 *   --service-role eyJ...     或直接给 service_role key（控制台 Project → Settings → API）
 *
 * 用法：
 *   node scripts/change_email.mjs --token sbp_xxx
 *   node scripts/change_email.mjs --service-role eyJ... --email william-smith@live.cn
 *
 * 默认：旧邮箱 lawyer@workbench.local → 新邮箱 william-smith@live.cn
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const has = (n) => argv.includes(`--${n}`)

const TOKEN = arg('token', process.env.SUPABASE_ACCESS_TOKEN || '')
const SERVICE_ROLE = arg('service-role', process.env.SUPABASE_SERVICE_ROLE || '')
const REF = arg('project-ref', 'zqqzrzznbdvynmznbipr')
const OLD_EMAIL = arg('old-email', 'lawyer@workbench.local')
const NEW_EMAIL = arg('email', 'william-smith@live.cn')
const SITE = `https://${REF}.supabase.co`
const AUTH = `${SITE}/auth/v1`
const MGMT = 'https://api.supabase.com/v1'

const ok = (m) => console.log(`  ✓ ${m}`)
const warn = (m) => console.log(`  ! ${m}`)
const err = (m) => { console.error(`  ✗ ${m}`); process.exit(1) }

// 从已构建的前端包里取 anon key（仅用于最后一步登录验证）
function anonKey() {
  const f = path.join(ROOT, 'dist/assets/index-DYJ_xA0-.js')
  if (!fs.existsSync(f)) return ''
  const t = fs.readFileSync(f, 'utf8').match(/eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}/)
  return t ? t[0] : ''
}

async function main() {
  if (!TOKEN && !SERVICE_ROLE) err('缺少凭据：传 --token sbp_xxx 或 --service-role eyJ...')

  let serviceKey = SERVICE_ROLE
  if (!serviceKey) {
    const mgmt = async (p) => {
      const r = await fetch(MGMT + p, { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } })
      const txt = await r.text()
      if (!r.ok) throw new Error(`${r.status} ${txt.slice(0, 160)}`)
      return txt ? JSON.parse(txt) : {}
    }
    const keys = await mgmt(`/projects/${REF}/api-keys`)
    const arr = Array.isArray(keys) ? keys : keys.data || []
    serviceKey = (arr.find((k) => k.name === 'service_role') || {}).api_key || ''
    if (!serviceKey) err('从 Management API 拿不到 service_role key')
    ok('已取得 service_role（仅本次使用，不落盘）')
  }

  const admin = async (p, init = {}) => {
    const r = await fetch(AUTH + p, {
      ...init,
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json', ...(init.headers || {}) },
    })
    const txt = await r.text()
    let body = {}
    try { body = txt ? JSON.parse(txt) : {} } catch { body = { raw: txt } }
    return { status: r.status, body }
  }

  // 1. 找到旧邮箱对应的用户 id
  const list = await admin('/admin/users?page=1&per_page=200')
  if (list.status >= 400) err(`列用户失败：${list.status} ${JSON.stringify(list.body).slice(0, 160)}`)
  const users = list.body.users || []
  const target = users.find((u) => (u.email || '').toLowerCase() === OLD_EMAIL.toLowerCase())
  if (!target) err(`没找到邮箱 ${OLD_EMAIL} 的用户（当前共 ${users.length} 个账号）`)
  ok(`找到用户：${OLD_EMAIL} (id=${target.id})`)

  // 2. 新邮箱是否已存在
  if (users.some((u) => (u.email || '').toLowerCase() === NEW_EMAIL.toLowerCase() && u.id !== target.id))
    err(`新邮箱 ${NEW_EMAIL} 已被本项目其它账号占用`)

  // 3. 改邮箱 + 直接确认（免收验证邮件）
  const r = await admin(`/admin/users/${target.id}`, {
    method: 'PUT',
    body: JSON.stringify({ email: NEW_EMAIL, email_confirm: true }),
  })
  if (r.status >= 400) err(`改邮箱失败：${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
  ok(`邮箱已改为 ${NEW_EMAIL}（已确认，可立即登录）`)

  // 4. 验证：用新邮箱 + 现有密码试登录（best-effort）
  const anon = anonKey()
  if (anon) {
    const knownPw = 'KaiRui-6406'
    const login = await fetch(`${AUTH}/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: NEW_EMAIL, password: knownPw }),
    })
    const lb = await login.json().catch(() => ({}))
    if (login.ok && lb.access_token) ok('新邮箱 + 原密码 登录验证通过')
    else warn(`登录验证未通过（${login.status}）——可能密码不同，但邮箱已改成功。请记得用新密码或控制台重置`)
  } else {
    warn('未找到本地 anon key，跳过登录验证；邮箱已改成功')
  }

  console.log('\n' + '─'.repeat(56))
  console.log('完成。新的登录账号：')
  console.log(`  邮箱：${NEW_EMAIL}`)
  console.log('  密码：保持原密码不变（如遗忘请控制台重置）')
  console.log('─'.repeat(56))
  console.log('注意：旧设备已登录的会话会失效，需用新邮箱重新登录。')
}

main().catch((e) => err(e.message))
