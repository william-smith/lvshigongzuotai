import { getAccessToken, notifyExpired } from './auth'
import type { CaseRow, Dataset, ExpenseRow, IntakeRow, MaterialRow, TimelineRow } from './types'

/**
 * 数据层：只依赖 PostgREST 标准 REST 接口，不绑定任何厂商 SDK。
 *
 * 因此下面这些平台填同一个地址 + 密钥即可，切换零改代码：
 *   - 腾讯云 CloudBase for Supabase 版（上海地域，境内合规）
 *   - MemFire Cloud（国产 Supabase 架构）
 *   - Supabase（境外）
 *   - 自建 PostgREST / Supabase 开源版
 *
 * 不填 VITE_API_BASE 时，使用本地演示数据，无需建库。
 */

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, '')
const KEY = import.meta.env.VITE_API_KEY as string | undefined

export const isCloud = Boolean(BASE && KEY)

/** 演示数据的口令；生产环境请在 .env 里改掉 */
export const DEMO_PASSPHRASE = (import.meta.env.VITE_DEMO_PASSPHRASE as string) || 'demo-2026'

interface Query {
  select?: string
  order?: string
  eq?: [string, string | number][]
  limit?: number
}

/** 供其他模块复用同一套鉴权（文书与证据等） */
export const API_BASE = BASE

/** 带上登录态；没登录时退回匿名 key（会被 RLS 挡住，用于自检报错） */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = (await getAccessToken()) ?? (KEY as string)
  return { apikey: KEY as string, Authorization: `Bearer ${token}`, Accept: 'application/json' }
}

async function request<T>(table: string, q: Query = {}): Promise<T[]> {
  if (!BASE || !KEY) throw new Error('未配置 VITE_API_BASE / VITE_API_KEY')
  const url = new URL(`${BASE}/${table}`)
  url.searchParams.set('select', q.select ?? '*')
  if (q.order) url.searchParams.set('order', q.order)
  if (q.limit) url.searchParams.set('limit', String(q.limit))
  for (const [col, val] of q.eq ?? []) url.searchParams.set(col, `eq.${val}`)

  const res = await fetch(url.toString(), { headers: await authHeaders() })
  if (res.status === 401 || res.status === 403) {
    notifyExpired() // 登录态失效，回到登录页
    throw new Error('登录已失效，请重新登录')
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`读取 ${table} 失败：${res.status} ${detail.slice(0, 120)}`)
  }
  return (await res.json()) as T[]
}

function normalizeDemo(raw: unknown): Dataset {
  const d = raw as Omit<Dataset, 'materials'> & { materials?: MaterialRow[] }
  return {
    version: d.version,
    generated_at: d.generated_at,
    crypto: d.crypto,
    cases: d.cases ?? [],
    intakes: d.intakes ?? [],
    timeline: d.timeline ?? [],
    expenses: d.expenses ?? [],
    materials: d.materials ?? [],
  }
}

/**
 * 两阶段加载：先拿到案件列表就让界面出来（首屏只等一个最快的查询），
 * 其余数据（接案/时间线/费用/材料/联系人）后台补齐，由 onProgress 渐进渲染。
 * onProgress 会被调用 1~2 次：第一次是「仅案件」的中间态，第二次是完整数据。
 */
export async function loadDataset(onProgress?: (d: Dataset) => void): Promise<Dataset> {
  // 动态载入：让演示数据单独成块，不拖慢首屏
  if (!isCloud) {
    const d = normalizeDemo((await import('../data/demo.json')).default)
    onProgress?.(d)
    return d
  }

  // 一次性并行发出全部请求（HTTP/2 多路复用，共用一条到 Supabase 的连接）。
  // 原来阶段一 await 完成后才发阶段二，等于白多一次到境外的 RTT；
  // 现在 7 个请求同时起飞，cases+vault 到位就先出界面，其余在背后补齐。
  const casesP = request<CaseRow>('cases', { order: 'next_due.asc.nullslast' })
  const vaultP = request<{ verifier_enc: string | null; iterations: number | null; salt: string | null }>(
    'vault_meta',
    { limit: 1 },
  ).catch(() => [] as { verifier_enc: string | null; iterations: number | null; salt: string | null }[])
  const intakesP = request<IntakeRow>('intakes', { order: 'id.asc' }).catch(() => [] as IntakeRow[])
  const timelineP = request<TimelineRow>('timeline', { order: 'at.desc' }).catch(() => [] as TimelineRow[])
  const expensesP = request<ExpenseRow>('expenses', { order: 'at.desc' }).catch(() => [] as ExpenseRow[])
  const materialsP = request<{ id: number; case_id: number }>('materials', {
    select: 'id,case_id',
    order: 'id.asc',
  }).catch(() => [] as { id: number; case_id: number }[])
  const contactsP = request<{ intake_id: number; phone_enc: string | null; phone_mask: string }>('contacts').catch(
    () => [] as { intake_id: number; phone_enc: string | null; phone_mask: string }[],
  )

  // 阶段一：案件 + 加密元信息到位即先出界面（cases 是核心，失败仍向上抛错）
  const [cases, vault] = await Promise.all([casesP, vaultP])
  const vm = vault[0]
  const partial: Dataset = {
    version: 1,
    generated_at: new Date().toISOString(),
    crypto: {
      alg: 'AES-256-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: vm?.iterations ?? 210000,
      salt: vm?.salt ?? 'lawyer-workbench-v1',
      verifier: vm?.verifier_enc ?? null,
    },
    cases,
    intakes: [],
    timeline: [],
    expenses: [],
    materials: [],
  }
  onProgress?.(partial)

  // 阶段二：其余数据补齐（Promise 已发出，这里只是等结果，不新增网络往返）
  // 每个请求都独立容错：任一张表查询失败只丢掉那张表，绝不让整批 reject 把
  // intakes/timeline/expenses 全部吞掉（曾经 contacts 失败会让接案列表永远停在 0 条）。
  const [intakes, timeline, expenses, materials, contacts] = await Promise.all([
    intakesP,
    timelineP,
    expensesP,
    materialsP,
    contactsP,
  ])

  const byIntake = new Map<number, { enc: string | null; mask: string }[]>()
  for (const r of contacts) {
    const arr = byIntake.get(r.intake_id) ?? []
    arr.push({ enc: r.phone_enc, mask: r.phone_mask })
    byIntake.set(r.intake_id, arr)
  }

  return {
    ...partial,
    intakes: intakes.map((i) => ({ ...i, phones: byIntake.get(i.id) ?? [] })),
    timeline,
    expenses,
    materials: materials as unknown as MaterialRow[],
  }
}

/** 写入一条加密联系方式（演示模式下为空操作） */
export async function saveContact(intakeId: number, enc: string, mask: string) {
  if (!isCloud || !BASE || !KEY) return
  const res = await fetch(`${BASE}/contacts`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ intake_id: intakeId, phone_enc: enc, phone_mask: mask }),
  })
  if (res.status === 401 || res.status === 403) {
    notifyExpired()
    throw new Error('登录已失效，请重新登录')
  }
  if (!res.ok) throw new Error(`保存失败：${res.status}`)
}
