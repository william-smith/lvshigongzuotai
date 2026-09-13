/**
 * 用 Supabase Management API 执行 SQL（建表 / 改表用）。
 *
 * 为什么需要它：PostgREST（前端用的 /rest/v1）只能增删改查数据，
 * 建表这类 DDL 必须走 Management API，而它只认 Personal Access Token（sbp_ 开头）。
 *
 * 用法：
 *   node scripts/run_sql_mgmt.mjs --token sbp_xxx [--file supabase/docs_schema.sql]
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/run_sql_mgmt.mjs
 *
 * Token 获取：https://supabase.com/dashboard/account/tokens
 *   Account Settings → Access Tokens → Generate new token（只显示一次）
 *   若可选作用域，请给这一个项目 + Database 读写即可；用完可在同一页面 Revoke。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

// 项目 ref：优先命令行，其次从 .env 的 VITE_API_BASE 里取子域名
function projectRef() {
  const fromArg = arg('ref')
  if (fromArg) return fromArg
  try {
    const env = readFileSync(resolve(here, '..', '.env'), 'utf8')
    const m = env.match(/VITE_API_BASE\s*=\s*https?:\/\/([^./]+)\./)
    if (m) return m[1]
  } catch {
    /* 没 .env 就靠命令行 */
  }
  throw new Error('拿不到项目 ref，请用 --ref zqqzrzznbdvynmznbipr 指定')
}

const token = arg('token') || process.env.SUPABASE_ACCESS_TOKEN
if (!token) throw new Error('缺少 token：用 --token sbp_xxx 或环境变量 SUPABASE_ACCESS_TOKEN')
if (!token.startsWith('sbp_')) console.warn('⚠️ token 不是 sbp_ 开头，确认是 Personal Access Token 而非项目 API key')

const file = arg('file') || resolve(here, '..', 'supabase', 'docs_schema.sql')
const sql = readFileSync(file, 'utf8')
const ref = projectRef()

console.log(`→ 项目 ${ref} 执行 ${file}（${sql.length} 字符）`)

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
})

const text = await res.text()
if (!res.ok) {
  console.error(`✗ 失败 ${res.status}: ${text.slice(0, 800)}`)
  process.exit(1)
}
console.log('✓ 执行成功')
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2).slice(0, 1200))
} catch {
  console.log(text.slice(0, 800))
}
