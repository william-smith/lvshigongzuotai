/**
 * 案件费用（expenses）的写入/删除（云端 PostgREST + 本地 demo 双模式）
 *
 * 与 caseOps / intakeOps 保持同一套「双写」约定：
 *   detail     ← 脱敏明文（手机号/身份证打码），可明文上云，供列表展示
 *   detail_enc ← 原文密文（v1:iv:ct），只有解锁后才能解开
 *
 * 金额类字段（amount / personal）**也是敏感数据**，同样走端到端加密：
 *   amount_enc / personal_enc ← 金额密文，密钥与 detail_enc 同一把（主口令派生）。
 * 灰度：默认「明文 + 密文」双写（方便核对与回滚）；迁移脚本把历史数据加密回填、
 *   确认无误并清空明文列后，把 .env 的 VITE_EXPENSE_ENC_ONLY 置 1，
 *   前端就只写密文，不再把金额明文送进数据库。
 * 保留策略：若用户没改动「摘要」，原密文原样保留；金额同理——未解锁（key=null）时
 *   无法重新加密，必须原样保留旧密文，绝不能覆盖成 null（否则金额永久丢失）。
 *
 * 删除时：expenses 表已声明 on delete cascade（随案件），但删除单条是显式 DELETE。
 */
import { authedFetch } from './auth'
import { isCloud } from './data'
import { decryptString, encryptString, maskSensitive } from './crypto'
import type { ExpenseRow } from './types'

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, '')

/**
 * 只写密文模式：明文列清空后必须打开，否则前端会把金额明文又写回去。
 * 用环境变量而不是硬编码，切换无需改代码、也便于回滚。
 */
const ENC_ONLY = (import.meta.env.VITE_EXPENSE_ENC_ONLY as string | undefined) === '1'
/**
 * 只声明「额外请求头」：apikey 与 Authorization 由 authedFetch 统一注入——
 * 它在 401 时会用最新 token 自动重试一次，且只有当前这枚 token 确实失效才登出，
 * 避免「上一枚过期 token 的迟到 401」把刚登录成功的新会话清掉。
 */
const JSON_HEADERS = {
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

export interface ExpenseDraft {
  id?: number | null
  case_id: number
  direction?: string | null
  category?: string | null
  at?: string | null
  amount?: number | null
  personal?: number | null
  /** 「摘要」的当前文本（解锁时为原文，未解锁时为脱敏文本） */
  detail?: string | null
  /** 用户是否改动过「摘要」；未改动则保留原密文 */
  detailChanged?: boolean
  /** 编辑前的原密文，用于未改动时保留 */
  originalEnc?: string | null
  /** 编辑前的金额原密文：未解锁时无法重新加密，必须原样保留 */
  originalAmountEnc?: string | null
  originalPersonalEnc?: string | null
}

export interface ExpenseSaveResult {
  row: ExpenseRow
  isNew: boolean
}

/** 计算 detail / detail_enc（遵循迁移脚本的双写规则） */
async function resolveDetail(
  draft: ExpenseDraft,
  key: CryptoKey | null,
): Promise<{ mask: string | null; enc: string | null }> {
  const text = (draft.detail ?? '').trim()

  // 未改动 → 原样保留
  if (!draft.detailChanged) {
    return {
      mask: text ? maskSensitive(text) : null,
      enc: draft.originalEnc ?? null,
    }
  }

  if (!text) return { mask: null, enc: null }
  return {
    mask: maskSensitive(text),
    enc: key ? await encryptString(key, text) : null,
  }
}

/** 金额 → 密文（"1234.56" 这样的字符串）；无密钥返回 null 由调用方决定保留策略 */
async function encAmount(v: number | null | undefined, key: CryptoKey | null): Promise<string | null> {
  if (v === null || v === undefined || Number.isNaN(v)) return null
  if (!key) return null
  return encryptString(key, String(v))
}

/**
 * 计算 amount / personal 的密文。
 * 关键：key 为空（未解锁）时**不能**把密文写成 null——那会丢数据。
 * 此时原样返回旧密文，等解锁后再由用户编辑重新加密（金额没变则密文依旧有效）。
 */
async function resolveAmounts(draft: ExpenseDraft, key: CryptoKey | null) {
  const amountEnc = (await encAmount(draft.amount, key)) ?? draft.originalAmountEnc ?? null
  const personalEnc = (await encAmount(draft.personal, key)) ?? draft.originalPersonalEnc ?? null
  return { amountEnc, personalEnc }
}

function buildRow(
  draft: ExpenseDraft,
  detail: { mask: string | null; enc: string | null },
  amounts: { amountEnc: string | null; personalEnc: string | null },
  newId?: number,
): ExpenseRow {
  return {
    id: draft.id ?? newId ?? 0,
    case_id: draft.case_id,
    direction: draft.direction ?? null,
    category: draft.category ?? null,
    at: draft.at ?? null,
    // 灰度期明文照写；ENC_ONLY 打开后不再送明文（列已清空，写了也没意义）
    amount: ENC_ONLY ? null : (draft.amount ?? null),
    personal: ENC_ONLY ? null : (draft.personal ?? null),
    detail: detail.mask,
    detail_enc: detail.enc,
    amount_enc: amounts.amountEnc,
    personal_enc: amounts.personalEnc,
  }
}

/** expenses 表主键是 bigint（非 bigserial），新建前先取 max(id)+1 */
async function nextExpenseId(): Promise<number> {
  if (!BASE) throw new Error('API 未配置')
  const res = await authedFetch(`${BASE}/expenses?select=id&order=id.desc&limit=1`)
  if (res.status === 401 || res.status === 403) {
    throw new Error('登录已失效')
  }
  if (!res.ok) throw new Error(`查询 id 失败：${res.status}`)
  const arr = (await res.json()) as { id: number }[]
  return (arr[0]?.id ?? 0) + 1
}

function assertOk(res: Response): void {
  if (res.status === 401 || res.status === 403) {
    throw new Error('登录已失效，请重新登录')
  }
}

export async function saveExpense(draft: ExpenseDraft, key: CryptoKey | null): Promise<ExpenseSaveResult> {
  const detail = await resolveDetail(draft, key)
  const amounts = await resolveAmounts(draft, key)
  const isNew = !draft.id
  const row = buildRow(draft, detail, amounts)

  if (!isCloud) return { row, isNew }

  if (isNew) {
    row.id = await nextExpenseId()
    const res = await authedFetch(`${BASE}/expenses`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        id: row.id,
        case_id: row.case_id,
        direction: row.direction,
        category: row.category,
        at: row.at,
        amount: row.amount,
        personal: row.personal,
        detail: row.detail,
        detail_enc: row.detail_enc,
        amount_enc: row.amount_enc,
        personal_enc: row.personal_enc,
        created_at: new Date().toISOString(),
      }),
    })
    assertOk(res)
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`新建费用失败：${res.status} ${t.slice(0, 200)}`)
    }
    const arr = (await res.json()) as ExpenseRow[]
    return { row: arr[0] ?? row, isNew: true }
  }

  // 未解锁 + 该行本来就有金额密文 → 金额相关字段一个都不写，保留数据库原值。
  // 原因：未解锁时界面拿不到明文，若按 null 写回会把金额清空（不可逆）。
  const keepAmounts = !key && Boolean(draft.originalAmountEnc || draft.originalPersonalEnc)
  const amountFields = keepAmounts
    ? {}
    : {
        amount: row.amount,
        personal: row.personal,
        amount_enc: row.amount_enc,
        personal_enc: row.personal_enc,
      }

  const res = await authedFetch(`${BASE}/expenses?id=eq.${draft.id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      case_id: row.case_id,
      direction: row.direction,
      category: row.category,
      at: row.at,
      detail: row.detail,
      detail_enc: row.detail_enc,
      ...amountFields,
    }),
  })
  assertOk(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`更新费用失败：${res.status} ${t.slice(0, 200)}`)
  }
  const arr = (await res.json()) as ExpenseRow[]
  return { row: arr[0] ?? { ...row, id: draft.id! }, isNew: false }
}

/**
 * 把费用行的金额密文还原成数字，供列表、合计、排序使用。
 *
 * 为什么在这里统一解密、而不是让每个组件各自解：
 *   - 金额要参与求和/排序，必须是 number，不能在渲染层「显示时解密」；
 *   - 解密后回填到 amount / personal，下游（ExpenseTable 的合计、CaseDetail 的 SecretMoney）
 *     一行都不用改，等于把加密的复杂度关在这一个函数里。
 *
 * 未解锁（key=null）：金额一律置 null——界面上 SecretMoney 显示 ¥ ••••，
 * 不会因为「密文还在内存里」而误以为数据丢了。
 * 解密失败（口令不对/密文损坏）：同样置 null 并标记，避免把乱码当金额算进合计。
 */
export async function decryptExpenses(
  rows: ExpenseRow[],
  key: CryptoKey | null,
): Promise<ExpenseRow[]> {
  if (!key) {
    return rows.map((r) => ({ ...r, amount: null, personal: null }))
  }
  const num = async (enc: string | null | undefined): Promise<number | null> => {
    if (!enc) return null
    try {
      const s = await decryptString(key, enc)
      const n = Number(s)
      return Number.isFinite(n) ? n : null
    } catch {
      return null // 解不开就当没有，绝不拿错误值参与合计
    }
  }
  const out: ExpenseRow[] = []
  for (const r of rows) {
    // 有密文就用密文；没有密文（灰度期还没回填）就沿用明文列
    const amount = r.amount_enc ? await num(r.amount_enc) : (r.amount ?? null)
    const personal = r.personal_enc ? await num(r.personal_enc) : (r.personal ?? null)
    out.push({ ...r, amount, personal })
  }
  return out
}

export async function deleteExpense(id: number): Promise<void> {
  if (!isCloud) return
  const res = await authedFetch(`${BASE}/expenses?id=eq.${id}`, {
    method: 'DELETE',
    headers: JSON_HEADERS,
  })
  assertOk(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`删除费用失败：${res.status} ${t.slice(0, 200)}`)
  }
}
