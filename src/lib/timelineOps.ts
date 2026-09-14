/**
 * 案件时间线（timeline）的写入/删除（云端 PostgREST + 本地 demo 双模式）
 *
 * 与 caseOps / intakeOps 保持同一套「双写」约定：
 *   content_mask ← 脱敏明文（手机号/身份证打码），可明文上云，供列表展示
 *   content_enc  ← 原文密文（v1:iv:ct），只有解锁后才能解开
 *
 * 保留策略：若用户没改动「内容」，原密文原样保留，不会被覆盖成 null。
 *
 * 删除时：timeline 表已声明 on delete cascade（随案件），但删除单条是显式 DELETE。
 */
import { authedFetch } from './auth'
import { isCloud } from './data'
import { encryptString, maskSensitive } from './crypto'
import type { TimelineRow } from './types'

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

export interface TimelineDraft {
  id?: number | null
  case_id: number
  at?: string | null
  /** 「内容」的当前文本（解锁时为原文，未解锁时为脱敏文本） */
  content?: string | null
  /** 用户是否改动过「内容」；未改动则保留原密文 */
  contentChanged?: boolean
  /** 编辑前的原密文，用于未改动时保留 */
  originalEnc?: string | null
}

export interface TimelineSaveResult {
  row: TimelineRow
  isNew: boolean
}

/** 计算 content_mask / content_enc（遵循迁移脚本的双写规则） */
async function resolveContent(
  draft: TimelineDraft,
  key: CryptoKey | null,
): Promise<{ mask: string | null; enc: string | null }> {
  const text = (draft.content ?? '').trim()

  // 未改动 → 原样保留（避免「只改了日期」却把内容密文清空）
  if (!draft.contentChanged) {
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
  draft: TimelineDraft,
  content: { mask: string | null; enc: string | null },
  newId?: number,
): TimelineRow {
  return {
    id: draft.id ?? newId ?? 0,
    case_id: draft.case_id,
    at: draft.at ?? null,
    content_mask: content.mask,
    content_enc: content.enc,
  }
}

/** timeline 表主键是 bigint（非 bigserial），新建前先取 max(id)+1 */
async function nextTimelineId(): Promise<number> {
  if (!BASE) throw new Error('API 未配置')
  const res = await authedFetch(`${BASE}/timeline?select=id&order=id.desc&limit=1`)
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

export async function saveTimeline(draft: TimelineDraft, key: CryptoKey | null): Promise<TimelineSaveResult> {
  const content = await resolveContent(draft, key)
  const isNew = !draft.id
  const row = buildRow(draft, content)

  if (!isCloud) return { row, isNew }

  if (isNew) {
    row.id = await nextTimelineId()
    const res = await authedFetch(`${BASE}/timeline`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        id: row.id,
        case_id: row.case_id,
        at: row.at,
        content_mask: row.content_mask,
        content_enc: row.content_enc,
        created_at: new Date().toISOString(),
      }),
    })
    assertOk(res)
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`新建时间线失败：${res.status} ${t.slice(0, 200)}`)
    }
    const arr = (await res.json()) as TimelineRow[]
    return { row: arr[0] ?? row, isNew: true }
  }

  const res = await authedFetch(`${BASE}/timeline?id=eq.${draft.id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      case_id: row.case_id,
      at: row.at,
      content_mask: row.content_mask,
      content_enc: row.content_enc,
    }),
  })
  assertOk(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`更新时间线失败：${res.status} ${t.slice(0, 200)}`)
  }
  const arr = (await res.json()) as TimelineRow[]
  return { row: arr[0] ?? { ...row, id: draft.id! }, isNew: false }
}

export async function deleteTimeline(id: number): Promise<void> {
  if (!isCloud) return
  const res = await authedFetch(`${BASE}/timeline?id=eq.${id}`, {
    method: 'DELETE',
    headers: JSON_HEADERS,
  })
  assertOk(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`删除时间线失败：${res.status} ${t.slice(0, 200)}`)
  }
}
