/**
 * 接案线索（intakes）的写入/删除（云端 PostgREST + 本地 demo 双模式）
 *
 * 与 caseOps.ts 保持同一套「双写」约定：
 *   note_mask  ← 脱敏明文（手机号/身份证打码），可明文上云，供列表展示与搜索
 *   note_enc   ← 原文密文（v1:iv:ct），只有解锁后才能解开
 *
 * 保留策略：若用户没有改动「跟踪记录」，原密文原样保留，不会被覆盖成 null。
 *
 * 删除时：contacts.intake_id 在 schema 里已声明 on delete cascade，
 *        关联联系人会被数据库自动清掉，无需手动级联。
 */
import { authedFetch } from './auth'
import { recordTombstone } from './syncOps'
import { isCloud } from './data'
import { encryptString, maskSensitive } from './crypto'
import type { IntakeRow } from './types'

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

export interface IntakeDraft {
  id?: number | null
  client: string
  first_contact?: string | null
  signed_at?: string | null
  converted?: boolean
  /** 接案节点时间（可选，精确到分钟）。设了才进日历；不设则不进日历 */
  next_due?: string | null
  /** 接案节点事项（可选）：要做什么，显示在日历标题里 */
  next_action?: string | null
  /** 接案提醒规则：ISO8601 duration 数组，空=不提醒 */
  remind_rules?: string[] | null
  /** 「跟踪记录」的当前文本（解锁时为原文，未解锁时为脱敏文本） */
  note?: string | null
  /** 用户是否改动过「跟踪记录」；未改动则保留原密文 */
  noteChanged?: boolean
  /** 编辑前的原密文，用于未改动时保留 */
  originalEnc?: string | null
}

export interface IntakeSaveResult {
  row: IntakeRow
  isNew: boolean
}

/** 计算 note_mask / note_enc（遵循迁移脚本的双写规则） */
async function resolveNote(
  draft: IntakeDraft,
  key: CryptoKey | null,
): Promise<{ mask: string | null; enc: string | null }> {
  const text = (draft.note ?? '').trim()

  // 未改动 → 原样保留（避免「只改了签单日」却把跟踪记录密文清空）
  if (!draft.noteChanged) {
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
  draft: IntakeDraft,
  note: { mask: string | null; enc: string | null },
  newId?: number,
  existingPhones?: IntakeRow['phones'],
): IntakeRow {
  return {
    id: draft.id ?? newId ?? 0,
    client: draft.client,
    first_contact: draft.first_contact ?? null,
    signed_at: draft.signed_at ?? null,
    converted: draft.converted ?? false,
    next_due: draft.next_due ?? null,
    next_action: draft.next_action ?? null,
    remind_rules: draft.remind_rules ?? null,
    note_mask: note.mask,
    note_enc: note.enc,
    phones: existingPhones ?? [],
  }
}

// 主键改为数据库 identity 自增（见 supabase/multitenant_schema.sql）：新建不再客户端算 id。

function assertOk(res: Response): void {
  if (res.status === 401 || res.status === 403) {
    throw new Error('登录已失效，请重新登录')
  }
}

export async function saveIntake(
  draft: IntakeDraft,
  key: CryptoKey | null,
  existingPhones?: IntakeRow['phones'],
): Promise<IntakeSaveResult> {
  const note = await resolveNote(draft, key)
  const isNew = !draft.id
  const row = buildRow(draft, note, undefined, existingPhones)

  if (!isCloud) return { row, isNew }

  if (isNew) {
    // 不传 id：identity 列由数据库自动发号
    const res = await authedFetch(`${BASE}/intakes`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        client: row.client,
        first_contact: row.first_contact,
        signed_at: row.signed_at,
        converted: row.converted,
        next_due: row.next_due,
        next_action: row.next_action,
        remind_rules: row.remind_rules,
        note_mask: row.note_mask,
        note_enc: row.note_enc,
      }),
    })
    assertOk(res)
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`新建接案失败：${res.status} ${t.slice(0, 200)}`)
    }
    const arr = (await res.json()) as IntakeRow[]
    return { row: { ...arr[0], phones: existingPhones ?? [] }, isNew: true }
  }

  const res = await authedFetch(`${BASE}/intakes?id=eq.${draft.id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      client: row.client,
      first_contact: row.first_contact,
      signed_at: row.signed_at,
      converted: row.converted,
      next_due: row.next_due,
      next_action: row.next_action,
      remind_rules: row.remind_rules,
      note_mask: row.note_mask,
      note_enc: row.note_enc,
      updated_at: new Date().toISOString(),
    }),
  })
  assertOk(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`更新接案失败：${res.status} ${t.slice(0, 200)}`)
  }
  const arr = (await res.json()) as IntakeRow[]
  return { row: { ...arr[0], phones: existingPhones ?? [] }, isNew: false }
}

export async function deleteIntake(id: number): Promise<void> {
  if (!isCloud) return
  // contacts.intake_id 已 on delete cascade，关联联系人自动清理
  const res = await authedFetch(`${BASE}/intakes?id=eq.${id}`, {
    method: 'DELETE',
    headers: JSON_HEADERS,
  })
  assertOk(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`删除接案失败：${res.status} ${t.slice(0, 200)}`)
  }
  // 记墓碑：让双向同步把这次删除传播到对端，避免下次同步又把它补回来
  void recordTombstone('intakes', id)
}
