/**
 * 把 expenses 表里已有的明文金额加密回填到 amount_enc / personal_enc。
 *
 * 为什么要单独一个脚本：加密需要「主口令派生的密钥」，而密钥只在你脑子里，
 * 不能由服务器代劳——所以这一步必须在本机跑，且要你输入主口令。
 *
 * 前置：
 *   1. 已执行 supabase/migrate_2026-09-23_expenses_amount_enc.sql 建好两个密文列
 *   2. 已跑过一次备份（npm run backup）——写库操作，先留后路
 *
 * 原理：与浏览器端 src/lib/crypto.ts 完全一致的算法参数
 *   KDF: PBKDF2-HMAC-SHA256, 210000 轮, salt = 'lawyer-workbench-v1'
 *   加密: AES-256-GCM, 12 字节随机 IV → 格式 v1:<iv_b64>:<ct_b64>
 * 所以浏览器能直接解开，反之亦然。
 *
 * 用法：
 *   node scripts/migrate_expense_amounts.mjs --token sbp_xxx --pass '你的主口令'
 *   node scripts/migrate_expense_amounts.mjs --token sbp_xxx --pass '口令' --yes    # 真正写库
 * 默认只 dry-run 预演（打印将要写入的行，不动数据库）。
 *
 * 取数/写数走 Management SQL（服务端执行 SQL），本机连不上 REST 也能做。
 */

import { webcrypto } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

const C = { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', x: '\x1b[0m' }
const err = (m) => console.error(`${C.red}✗${C.x} ${m}`)
const warn = (m) => console.log(`${C.yellow}⚠${C.x} ${m}`)
const ok = (m) => console.log(`${C.green}✓${C.x} ${m}`)
const step = (m) => console.log(`${C.dim}→${C.x} ${m}`)

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}
const hasFlag = (n) => process.argv.includes(`--${n}`)

const token = arg('token') || process.env.SUPABASE_ACCESS_TOKEN
const pass = arg('pass') || process.env.VAULT_PASSPHRASE
const dryRun = !hasFlag('yes')

// 项目 ref：从 .env 的 VITE_API_BASE 取
const envRef = (() => {
  try {
    const txt = readFileSync(resolve(repoRoot, '.env'), 'utf8')
    return (txt.match(/VITE_API_BASE\s*=\s*https?:\/\/([^./]+)\./) || [])[1] || ''
  } catch {
    return ''
  }
})()
const ref = arg('ref') || envRef

if (!token) {
  err('缺少 --token sbp_xxx（或用环境变量 SUPABASE_ACCESS_TOKEN）')
  process.exit(1)
}
if (!pass) {
  err('缺少 --pass "主口令"（或用环境变量 VAULT_PASSPHRASE）。口令不会落盘、也不打印。')
  process.exit(1)
}
if (!ref) {
  err('拿不到项目 ref，用 --ref 指定')
  process.exit(1)
}

/* ---------- 与 src/lib/crypto.ts 一致的实现 ---------- */
const SALT = 'lawyer-workbench-v1'
const ITER = 210000
const VERIFIER_PLAIN = 'lawyer-workbench-ok'

async function deriveKey(passphrase) {
  const enc = new TextEncoder()
  const base = await webcrypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(SALT), iterations: ITER, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function b64(u8) {
  return Buffer.from(u8).toString('base64')
}

async function encryptString(key, plain) {
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const ct = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain))
  return `v1:${b64(iv)}:${b64(new Uint8Array(ct))}`
}

async function decryptString(key, tokenStr) {
  const parts = String(tokenStr).split(':')
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('密文格式不正确')
  const ct = Buffer.from(parts[2], 'base64')
  const plain = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(parts[1], 'base64') },
    key,
    ct,
  )
  return new TextDecoder().decode(plain)
}

/* ---------- Management SQL ---------- */
async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Management SQL ${res.status}: ${text.slice(0, 300)}`)
  }
  return JSON.parse(text)
}

const esc = (s) => String(s).replace(/'/g, "''")

step(`项目 ${ref}   模式 ${dryRun ? C.yellow + 'DRY-RUN（不写库）' + C.x : C.green + '写入' + C.x}`)

/* 1. 校验口令（用 vault_meta 的校验串，防止口令输错把数据加密成解不开的垃圾） */
let verifier = null
try {
  const v = await sql("select verifier_enc from public.vault_meta order by id limit 1")
  verifier = v[0]?.verifier_enc ?? null
} catch (e) {
  warn(`读 vault_meta 失败：${String(e.message).slice(0, 120)}`)
}
if (!verifier) {
  warn('数据库里没有口令校验串，无法验证口令是否正确——请务必确认口令输对，否则金额将永久无法解开')
} else {
  const key0 = await deriveKey(pass)
  try {
    const plain = await decryptString(key0, verifier)
    if (plain !== VERIFIER_PLAIN) {
      err('口令不正确（校验串解出来不对）。已中止，未改动任何数据。')
      process.exit(1)
    }
    ok('口令校验通过')
  } catch {
    err('口令不正确（校验串解不开）。已中止，未改动任何数据。')
    process.exit(1)
  }
}

const key = await deriveKey(pass)

/**
 * --verify：用当前口令解开全部金额密文，并与明文列比对。
 * 只打印「一致 / 不一致 / 解不开」的条数，不打印金额，避免日志里留下真实数额。
 * 写入前后各跑一次：写入前看存量密文是不是同一把钥匙，写入后确认全部可解。
 */
if (hasFlag('verify')) {
  const all = await sql('select id, amount, personal, amount_enc, personal_enc from public.expenses order by id')
  let okA = 0
  let badA = 0
  let okP = 0
  let badP = 0
  let emptyA = 0
  let emptyP = 0
  const problems = []
  const chk = async (enc, plain) => {
    if (!enc) return 'empty'
    try {
      const s = await decryptString(key, enc)
      const n = Number(s)
      if (!Number.isFinite(n)) return 'bad'
      if (plain === null || plain === undefined) return 'ok' // 明文已清空，能解开就算过
      return Math.abs(n - Number(plain)) < 0.005 ? 'ok' : 'bad'
    } catch {
      return 'bad'
    }
  }
  for (const r of all) {
    const a = await chk(r.amount_enc, r.amount)
    const p = await chk(r.personal_enc, r.personal)
    if (a === 'ok') okA++
    else if (a === 'bad') {
      badA++
      problems.push(`id=${r.id} amount 解不开或与明文不符`)
    } else emptyA++
    if (p === 'ok') okP++
    else if (p === 'bad') {
      badP++
      problems.push(`id=${r.id} personal 解不开或与明文不符`)
    } else emptyP++
  }
  console.log(`   开票金额：可解且一致 ${okA} 条，异常 ${badA} 条，无密文 ${emptyA} 条`)
  console.log(`   个人得  ：可解且一致 ${okP} 条，异常 ${badP} 条，无密文 ${emptyP} 条`)
  for (const p of problems) console.log(`   ✗ ${p}`)
  if (badA || badP) {
    err('校验未通过：存在解不开或不符的金额，不要急着清空明文列')
    process.exit(1)
  }
  ok('校验通过：所有已加密金额都能被当前口令解开')
  process.exit(0)
}

/* 2. 取数据 */
const rows = await sql(
  'select id, amount, personal, amount_enc, personal_enc from public.expenses order by id'
)
step(`共 ${rows.length} 条费用记录`)

const todo = []
for (const r of rows) {
  const needAmount = r.amount !== null && r.amount !== undefined && !r.amount_enc
  const needPersonal = r.personal !== null && r.personal !== undefined && !r.personal_enc
  if (!needAmount && !needPersonal) continue
  const a = needAmount ? await encryptString(key, String(r.amount)) : null
  const p = needPersonal ? await encryptString(key, String(r.personal)) : null
  todo.push({ id: r.id, needAmount, needPersonal, a, p })
  // 金额明文不打印，只显示密文长度，避免日志里留下真实数额
  const whyA = needAmount ? `明文金额 → 密文(${a.length} 字符)` : r.amount == null ? '（无金额，跳过）' : '（已有密文，跳过）'
  const whyP = needPersonal ? `明文金额 → 密文(${p.length} 字符)` : r.personal == null ? '（无金额，跳过）' : '（已有密文，跳过）'
  const showA = whyA
  const showP = whyP
  console.log(`   id=${String(r.id).padEnd(6)} amount: ${showA}   personal: ${showP}`)
}

if (!todo.length) {
  ok('所有记录的金额都已经有密文了，无需回填')
  process.exit(0)
}

if (dryRun) {
  warn(`dry-run 结束：${todo.length} 条待写入（金额明文不会打印，上面只显示长度）。确认无误后加 --yes 执行`)
  process.exit(0)
}

/* 3. 写回 */
let okCount = 0
let failCount = 0
for (const item of todo) {
  const sets = []
  if (item.needAmount && item.a) sets.push(`amount_enc = '${esc(item.a)}'`)
  if (item.needPersonal && item.p) sets.push(`personal_enc = '${esc(item.p)}'`)
  if (!sets.length) continue
  try {
    await sql(`update public.expenses set ${sets.join(', ')} where id = ${Number(item.id)}`)
    okCount++
    console.log(`   ✓ id=${item.id} 已加密`)
  } catch (e) {
    failCount++
    err(`id=${item.id} 失败：${String(e.message).slice(0, 160)}`)
  }
}

console.log('')
if (failCount) {
  err(`回填结束：成功 ${okCount} 条，失败 ${failCount} 条 —— 失败的仍保留明文，可重跑本脚本`)
  process.exit(1)
}
ok(`回填完成：${okCount} 条金额已加密`)
step('下一步：用 npm run backup:dry 或直接看列表核对金额 → 无误后执行 SQL 里第二步清空明文，并把 .env 的 VITE_EXPENSE_ENC_ONLY 置 1 重新构建')
