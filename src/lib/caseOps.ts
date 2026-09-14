/**
 * 案件的写入/删除（云端 PostgREST + 本地 demo 双模式）
 *
 * 与 scripts/migrate_noco.py 保持同一套「双写」约定：
 *   detail_mask  ← 脱敏明文（手机号/身份证打码），可明文上云，供列表展示与搜索
 *   detail_enc   ← 原文密文（v1:iv:ct），只有解锁后才能解开
 *
 * 保留策略：若用户没有改动「详细情况」，原密文原样保留，不会被覆盖成 null。
 */
import { authedFetch } from './auth'
import { isCloud } from './data'
import { encryptString, maskSensitive } from './crypto'
import { normalizeStage, type CaseRow } from './types'

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, '')
/**
 * 只声明「额外请求头」：apikey 与 Authorization 由 authedFetch 统一注入——
 * 它在 401 时会用最新 token 自动重试一次，且只有当前这枚 token 确实失效才登出，
 * 避免「上一枚过期 token 的迟到 401」把刚登录成功的新会话清掉。
 */
const JSON_HEADERS = {
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

export interface CaseDraft {
  id?: number | null
  client: string
  cause?: string | null
  stage?: string | null
  next_action?: string | null
  next_due?: string | null
  first_contact?: string | null
  signed_at?: string | null
  /** 「详细情况」的当前文本（解锁时为原文，未解锁时为脱敏文本） */
  detail?: string | null
  /** 用户是否改动过「详细情况」；未改动则保留原密文 */
  detailChanged?: boolean
  /** 编辑前的原密文，用于未改动时保留 */
  originalEnc?: string | null
}

export interface SaveResult {
  row: CaseRow
  isNew: boolean
}

/** 计算 detail_mask / detail_enc（遵循迁移脚本的双写规则） */
async function resolveDetail(
  draft: CaseDraft,
  key: CryptoKey | null,
): Promise<{ mask: string | null; enc: string | null }> {
  const text = (draft.detail ?? '').trim()

  // 未改动 → 原样保留（避免「只改了案由」却把详细情况密文清空）
  if (!draft.detailChanged) {
    return {
      mask: text ? maskSensitive(text) : null,
      enc: draft.originalEnc ?? null,
    }
  }

  if (!text) return { mask: null, enc: null }
  // 脱敏明文永远写；密文只在解锁时写
  return {
    mask: maskSensitive(text),
    enc: key ? await encryptString(key, text) : null,
  }
}

function buildRow(
  draft: CaseDraft,
  detail: { mask: string | null; enc: string | null },
  newId?: number,
): CaseRow {
  const stage = draft.stage ?? ''
  return {
    id: draft.id ?? newId ?? 0,
    client: draft.client,
    cause: draft.cause ?? '',
    stage,
    stage_norm: normalizeStage(stage),
    next_action: draft.next_action ?? null,
    next_due: draft.next_due ?? null,
    first_contact: draft.first_contact ?? null,
    signed_at: draft.signed_at ?? null,
    detail_mask: detail.mask,
    detail_enc: detail.enc,
    has_secret: !!detail.enc,
  }
}

/** cases 表主键是 bigint（非 bigserial），新建前先取 max(id)+1 */
async function nextCaseId(): Promise<number> {
  if (!BASE) throw new Error('API 未配置')
  const res = await authedFetch(`${BASE}/cases?select=id&order=id.desc&limit=1`)
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

export async function saveCase(draft: CaseDraft, key: CryptoKey | null): Promise<SaveResult> {
  const detail = await resolveDetail(draft, key)
  const isNew = !draft.id
  const row = buildRow(draft, detail)

  if (!isCloud) return { row, isNew }

  if (isNew) {
    row.id = await nextCaseId()
    const res = await authedFetch(`${BASE}/cases`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...row, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    })
    assertOk(res)
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`新建案件失败：${res.status} ${t.slice(0, 200)}`)
    }
    const arr = (await res.json()) as CaseRow[]
    return { row: arr[0] ?? row, isNew: true }
  }

  const res = await authedFetch(`${BASE}/cases?id=eq.${draft.id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      client: row.client,
      cause: row.cause,
      stage: row.stage,
      stage_norm: row.stage_norm,
      next_action: row.next_action,
      next_due: row.next_due,
      first_contact: row.first_contact,
      signed_at: row.signed_at,
      detail_mask: row.detail_mask,
      detail_enc: row.detail_enc,
      has_secret: row.has_secret,
      updated_at: new Date().toISOString(),
    }),
  })
  assertOk(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`更新案件失败：${res.status} ${t.slice(0, 200)}`)
  }
  const arr = (await res.json()) as CaseRow[]
  return { row: arr[0] ?? { ...row, id: draft.id! }, isNew: false }
}

export async function deleteCase(id: number): Promise<void> {
  if (!isCloud) return
  const res = await authedFetch(`${BASE}/cases?id=eq.${id}`, {
    method: 'DELETE',
    headers: JSON_HEADERS,
  })
  assertOk(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`删除案件失败：${res.status} ${t.slice(0, 200)}`)
  }
}
