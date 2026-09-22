/**
 * 从 scripts/backup_supabase.mjs 产出的快照恢复数据。
 *
 * 为什么单独一个脚本：恢复是「写」操作，默认必须 --dry-run 预演、显式确认才落库，
 * 避免手滑把线上数据覆盖掉（反向覆盖 = 把最新的改坏数据写回去）。
 *
 * 语义默认是「合并」而非「清空重灌」：
 *   按主键 id 做 upsert（缺的记录补回来，已存在的记录被快照内容覆盖）。
 *   不会删除库里多出来的新数据——除非显式加 --replace（先删该表全部行，慎用）。
 *
 * 用法：
 *   node scripts/restore_supabase.mjs --from backups/20260923_0030 --dry-run
 *   node scripts/restore_supabase.mjs --from backups/20260923_0030 --yes
 *   node scripts/restore_supabase.mjs --from <dir> --tables cases,timeline --yes
 *   node scripts/restore_supabase.mjs --from <dir> --replace --yes     # 危险：清空后重灌
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
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
const hasFlag = (n) => process.argv.includes(`--${n}`)

function readDotEnv(name) {
  for (const f of ['.env.local', '.env']) {
    const p = join(repoRoot, f)
    if (!existsSync(p)) continue
    try {
      const m = readFileSync(p, 'utf8').match(new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, 'm'))
      if (m) return m[1].replace(/^["']|["']$/g, '')
    } catch {
      /* 忽略读失败 */
    }
  }
  return undefined
}

const from = arg('from')
if (!from) {
  err('缺少 --from <快照目录>')
  process.exit(1)
}
const snapDir = resolve(process.cwd(), from)
if (!existsSync(join(snapDir, '_manifest.json'))) {
  err(`不是有效快照（缺 _manifest.json）：${snapDir}`)
  process.exit(1)
}

const dryRun = hasFlag('dry-run')
const replace = hasFlag('replace')
const confirm = hasFlag('yes')
if (!dryRun && !confirm) {
  err('这是写库操作：请先跑 `--dry-run` 预演，确认无误后再加 `--yes` 真正执行')
  process.exit(1)
}

const BASE = (readDotEnv('VITE_API_BASE') || process.env.VITE_API_BASE || '').replace(/\/+$/, '')
if (!BASE) {
  err('拿不到 VITE_API_BASE')
  process.exit(1)
}

const serviceKey =
  arg('service-role') || process.env.SUPABASE_SERVICE_ROLE || readDotEnv('SUPABASE_SERVICE_ROLE')
if (!serviceKey) {
  err('恢复需要 service_role key：--service-role eyJ... 或环境变量 SUPABASE_SERVICE_ROLE')
  process.exit(1)
}
const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
}

// 同备份脚本：需要时代理接管（Node 的 fetch 默认不走 HTTPS_PROXY）
await ensureProxy(BASE)

const manifest = JSON.parse(readFileSync(join(snapDir, '_manifest.json'), 'utf8'))
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

const wanted = arg('tables')
  ? arg('tables').split(',').map((s) => s.trim())
  : null
let tables = manifest.tables.filter((t) => !wanted || wanted.includes(t.table))

// 外键顺序：父表在前，子表在后；同一层内部顺序无所谓
const ORDER = ['cases', 'intakes', 'vault_meta', 'contacts', 'timeline', 'expenses', 'materials', 'case_folders']
tables = [...tables].sort((a, b) => {
  const ia = ORDER.indexOf(a.table)
  const ib = ORDER.indexOf(b.table)
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
})

console.log(`快照 ${snapDir}`)
console.log(`导出时间 ${manifest.exported_at}  项目 ${manifest.project_ref}`)
console.log(`模式 ${dryRun ? C.yellow + 'DRY-RUN（不写库）' + C.x : (replace ? C.red + 'REPLACE（先清空该表！）' + C.x : C.green + 'UPSERT（按 id 合并）' + C.x)}`)
console.log('')

let plan = 0
for (const t of tables) {
  const p = join(snapDir, `${t.table}.json`)
  if (!existsSync(p)) {
    err(`${t.table}.json 缺失，跳过`)
    continue
  }
  const txt = readFileSync(p, 'utf8')
  if (sha256(txt) !== t.sha256) {
    err(`${t.table}: 校验和不符，文件可能被改过 —— 拒绝恢复该表`)
    continue
  }
  const rows = JSON.parse(txt)
  plan += rows.length
  console.log(`   ${t.table.padEnd(16)} 将写入 ${String(rows.length).padStart(6)} 行`)
}
console.log('')

if (dryRun) {
  warn(`dry-run 结束：共 ${plan} 行待写入。确认无误后加 --yes 执行`)
  process.exit(0)
}

let okCount = 0
let failCount = 0
for (const t of tables) {
  const p = join(snapDir, `${t.table}.json`)
  if (!existsSync(p)) continue
  const txt = readFileSync(p, 'utf8')
  if (sha256(txt) !== t.sha256) continue
  const rows = JSON.parse(txt)

  try {
    if (replace) {
      // 子表外键都是 on delete cascade，按 ORDER 正序先删父表会自动级联掉子表，
      // 反过来删反而可能撞到还在被引用的行
      const del = await fetch(`${BASE}/${encodeURIComponent(t.table)}?id=gt.0`, {
        method: 'DELETE',
        headers,
      })
      if (!del.ok && del.status !== 404) {
        const d = await del.text()
        warn(`${t.table}: 清空失败 ${del.status} ${d.slice(0, 120)}`)
      }
    }
    if (!rows.length) {
      ok(`${t.table.padEnd(16)} 0 行（空表跳过）`)
      continue
    }
    // PostgREST upsert 必须显式指定冲突列，否则会报「无法推断唯一约束」
    const url = `${BASE}/${encodeURIComponent(t.table)}?on_conflict=id`
    const batchSize = 500
    let written = 0
    for (let i = 0; i < rows.length; i += batchSize) {
      const part = rows.slice(i, i + batchSize)
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(part),
      })
      if (!res.ok) {
        const d = await res.text()
        throw new Error(`HTTP ${res.status} ${d.slice(0, 200)}`)
      }
      written += part.length
    }
    ok(`${t.table.padEnd(16)} 已写入 ${String(written).padStart(6)} 行`)
    okCount++
  } catch (e) {
    failCount++
    err(`${t.table}: ${String(e.message).slice(0, 200)}`)
  }
}

console.log('')
if (failCount) {
  err(`恢复结束：${okCount} 张表成功，${failCount} 张表失败 —— 请查看上方原因`)
  process.exit(1)
}
ok(`恢复完成：${okCount} 张表全部写入（${replace ? 'REPLACE' : 'UPSERT'}）`)
step('建议刷新页面核对数据，必要时先备份当前库再操作')
