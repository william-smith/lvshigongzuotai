/**
 * 案件费用（expenses）的写入/删除（云端 PostgREST + 本地 demo 双模式）
 *
 * 与 caseOps / intakeOps 保持同一套「双写」约定：
 *   detail     ← 脱敏明文（手机号/身份证打码），可明文上云，供列表展示
 *   detail_enc ← 原文密文（v1:iv:ct），只有解锁后才能解开
 *
 * 金额类字段（amount / personal）是数字，保持明文，不涉及加密。
 * 保留策略：若用户没改动「摘要」，原密文原样保留，不会被覆盖成 null。
 *
 * 删除时：expenses 表已声明 on delete cascade（随案件），但删除单条是显式 DELETE。
 */
import { getAccessToken, notifyExpired } from './auth'
import { isCloud } from './data'
import { encryptString, maskSensitive } from './crypto'
import type { ExpenseRow } from './types'

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, '')
const KEY = import.meta.env.VITE_API_KEY as string | undefined

async function authHeaders(): Promise<Record<string, string>> {
  const token = (await getAccessToken()) ?? (KEY as string)
  return {
    apikey: KEY as string,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
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

function buildRow(
  draft: ExpenseDraft,
  detail: { mask: string | null; enc: string | null },
  newId?: number,
): ExpenseRow {
  return {
    id: draft.id ?? newId ?? 0,
    case_id: draft.case_id,
    direction: draft.direction ?? null,
    category: draft.category ?? null,
    at: draft.at ?? null,
    amount: draft.amount ?? null,
    personal: draft.personal ?? null,
    detail: detail.mask,
    detail_enc: detail.enc,
  }
}

/** expenses 表主键是 bigint（非 bigserial），新建前先取 max(id)+1 */
async function nextExpenseId(): Promise<number> {
  if (!BASE) throw new Error('API 未配置')
  const res = await fetch(`${BASE}/expenses?select=id&order=id.desc&limit=1`, {
    headers: {
      apikey: KEY as string,
      Authorization: `Bearer ${(await getAccessToken()) ?? KEY}`,
    },
  })
  if (res.status === 401 || res.status === 403) {
    notifyExpired()
    throw new Error('登录已失效')
  }
  if (!res.ok) throw new Error(`查询 id 失败：${res.status}`)
  const arr = (await res.json()) as { id: number }[]
  return (arr[0]?.id ?? 0) + 1
}

function assertOk(res: Response): void {
  if (res.status === 401 || res.status === 403) {
    notifyExpired()
    throw new Error('登录已失效，请重新登录')
  }
}

export async function saveExpense(draft: ExpenseDraft, key: CryptoKey | null): Promise<ExpenseSaveResult> {
  const detail = await resolveDetail(draft, key)
  const isNew = !draft.id
  const row = buildRow(draft, detail)

  if (!isCloud) return { row, isNew }

  if (isNew) {
    row.id = await nextExpenseId()
    const res = await fetch(`${BASE}/expenses`, {
      method: 'POST',
      headers: await authHeaders(),
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

  const res = await fetch(`${BASE}/expenses?id=eq.${draft.id}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify({
      case_id: row.case_id,
      direction: row.direction,
      category: row.category,
      at: row.at,
      amount: row.amount,
      personal: row.personal,
      detail: row.detail,
      detail_enc: row.detail_enc,
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

export async function deleteExpense(id: number): Promise<void> {
  if (!isCloud) return
  const res = await fetch(`${BASE}/expenses?id=eq.${id}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  })
  assertOk(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`删除费用失败：${res.status} ${t.slice(0, 200)}`)
  }
}
