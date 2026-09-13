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
import { getAccessToken, notifyExpired } from './auth'
import { isCloud } from './data'
import { encryptString, maskSensitive } from './crypto'
import type { IntakeRow } from './types'

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

export interface IntakeDraft {
  id?: number | null
  client: string
  first_contact?: string | null
  signed_at?: string | null
  converted?: boolean
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
    note_mask: note.mask,
    note_enc: note.enc,
    phones: existingPhones ?? [],
  }
}

/** intakes 表主键是 bigint（非 bigserial），新建前先取 max(id)+1 */
async function nextIntakeId(): Promise<number> {
  if (!BASE) throw new Error('API 未配置')
  const res = await fetch(`${BASE}/intakes?select=id&order=id.desc&limit=1`, {
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
    row.id = await nextIntakeId()
    const res = await fetch(`${BASE}/intakes`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({
        id: row.id,
        client: row.client,
        first_contact: row.first_contact,
        signed_at: row.signed_at,
        converted: row.converted,
        note_mask: row.note_mask,
        note_enc: row.note_enc,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
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

  const res = await fetch(`${BASE}/intakes?id=eq.${draft.id}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify({
      client: row.client,
      first_contact: row.first_contact,
      signed_at: row.signed_at,
      converted: row.converted,
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
  const res = await fetch(`${BASE}/intakes?id=eq.${id}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  })
  assertOk(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`删除接案失败：${res.status} ${t.slice(0, 200)}`)
  }
}
