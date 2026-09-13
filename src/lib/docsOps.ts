import { API_BASE, authHeaders, isCloud } from './data'
import { notifyExpired } from './auth'
import { classifyByFilename } from './docCategory'
import type { CaseFolder, DocFile } from './types'
import type { LocalFile } from './fsAccess'

/**
 * 文书与证据的数据读写。
 *
 * 只跟云端交换「索引」：文件名、相对路径、大小、分类。
 * 文件本体永远留在本机 + 手机，靠 Verysync 点对点加密同步，不经过这里。
 *
 * 路径存 rel_path（相对案件文件夹），设备无关：
 *   PC 完整路径  = case_folders.pc_folder     + rel_path
 *   手机完整路径 = case_folders.mobile_folder + rel_path
 */

async function call(path: string, init: RequestInit & { json?: unknown } = {}) {
  if (!isCloud || !API_BASE) throw new Error('未接云端，索引不会保存')
  const { json, ...rest } = init
  const res = await fetch(`${API_BASE}/${path}`, {
    ...rest,
    headers: {
      ...(await authHeaders()),
      'Content-Type': 'application/json',
      ...(rest.headers ?? {}),
    },
    body: json === undefined ? rest.body : JSON.stringify(json),
  })
  if (res.status === 401 || res.status === 403) {
    notifyExpired()
    throw new Error('登录已失效，请重新登录')
  }
  if (!res.ok) throw new Error(`请求失败 ${res.status}：${(await res.text().catch(() => '')).slice(0, 120)}`)
  return res
}

// ---------------- 案件 ↔ 文件夹绑定 ----------------

export async function loadCaseFolders(): Promise<CaseFolder[]> {
  if (!isCloud || !API_BASE) return []
  const res = await call('case_folders?select=*&order=case_id.asc')
  return (await res.json()) as CaseFolder[]
}

/**
 * 有则改、无则插。
 * ⚠️ 必须显式给 on_conflict=case_id：PostgREST 的 merge-duplicates 默认按**主键**判冲突，
 *    而我们的唯一约束建在 case_id 上，不指定就会变成纯 INSERT，第二次写入直接 409。
 */
export async function saveCaseFolder(row: {
  case_id: number
  folder_name?: string | null
  pc_folder?: string | null
  mobile_folder?: string | null
  matched_by?: string | null
}): Promise<CaseFolder | null> {
  if (!isCloud || !API_BASE) return null
  const res = await call('case_folders?on_conflict=case_id', {
    method: 'POST',
    json: { ...row, updated_at: new Date().toISOString() },
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
  })
  const arr = (await res.json()) as CaseFolder[]
  return arr[0] ?? null
}

// ---------------- 文件索引 ----------------

export async function loadDocFiles(): Promise<DocFile[]> {
  if (!isCloud || !API_BASE) return []
  const res = await call('materials?select=*&rel_path=not.is.null&order=id.asc')
  return (await res.json()) as DocFile[]
}

function toRow(caseId: number, f: { relPath: string; name: string; size: number }, prev?: DocFile) {
  const manual = prev?.category_src === 'manual'
  return {
    case_id: caseId,
    name: f.name,
    rel_path: f.relPath,
    size_bytes: f.size,
    storage: 'local', // 原件只在本机，永不上云
    // 手动改判过的分类不被自动规则覆盖
    category: manual ? prev?.category ?? classifyByFilename(f.name) : classifyByFilename(f.name),
    category_src: manual ? 'manual' : 'auto',
    updated_at: new Date().toISOString(),
    indexed_at: new Date().toISOString(),
  }
}

export interface Reconcile {
  inserts: ReturnType<typeof toRow>[]
  updates: { id: number; patch: Record<string, unknown> }[]
  deletes: number[]
  renamed: number
}

/**
 * 把本机扫到的文件与云端索引对账。
 * 关键：照片导入后常被重命名，靠「大小唯一匹配」识别为同一个文件，
 * 避免同一张照片在索引里变成两条（一条失效、一条未分类）。
 */
export function reconcile(caseId: number, local: LocalFile[], existing: DocFile[]): Reconcile {
  const byRelLocal = new Map(local.map((f) => [f.relPath, f]))
  const byRelOld = new Map(existing.filter((r) => r.rel_path).map((r) => [r.rel_path as string, r]))

  const inserts: ReturnType<typeof toRow>[] = []
  const updates: { id: number; patch: Record<string, unknown> }[] = []
  const matchedLocal = new Set<string>()

  // 本机有、云上没有 → 新增；两边都有 → 看名字/大小有没有变
  for (const f of local) {
    const old = byRelOld.get(f.relPath)
    if (!old) continue
    matchedLocal.add(f.relPath)
    if (old.name !== f.name || old.size_bytes !== f.size) {
      updates.push({ id: old.id, patch: toRow(caseId, f, old) })
    }
  }

  const newOnes = local.filter((f) => !byRelOld.has(f.relPath))
  const gone = existing.filter((r) => r.rel_path && !byRelLocal.has(r.rel_path))

  // 用「大小」给消失的和新出现的配对，认出重命名
  const bySize = new Map<number, LocalFile[]>()
  for (const f of newOnes) {
    const arr = bySize.get(f.size) ?? []
    arr.push(f)
    bySize.set(f.size, arr)
  }
  const renamedIds = new Set<number>()
  let renamed = 0

  for (const old of gone) {
    const cands = bySize.get(old.size_bytes ?? -1) ?? []
    if (cands.length === 1 && old.size_bytes) {
      const f = cands[0]
      updates.push({ id: old.id, patch: toRow(caseId, f, old) })
      matchedLocal.add(f.relPath)
      renamedIds.add(old.id)
      renamed += 1
      bySize.set(f.size, cands.filter((c) => c !== f))
    }
  }

  for (const f of newOnes) {
    if (!matchedLocal.has(f.relPath)) inserts.push(toRow(caseId, f))
  }

  // 云上有、本机确实没了、又不是重命名 → 删除索引（原件删了，索引跟着走）
  const deletes = gone.filter((r) => !renamedIds.has(r.id)).map((r) => r.id)

  return { inserts, updates, deletes, renamed }
}

/** 把对账结果写回云端 */
export async function applyReconcile(r: Reconcile, shouldAbort?: () => boolean): Promise<void> {
  if (!isCloud || !API_BASE) return
  if (r.inserts.length) {
    if (shouldAbort?.()) return
    await call('materials', {
      method: 'POST',
      json: r.inserts,
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    })
  }
  for (const u of r.updates) {
    if (shouldAbort?.()) return
    await call(`materials?id=eq.${u.id}`, {
      method: 'PATCH',
      json: u.patch,
      headers: { Prefer: 'return=minimal' },
    })
  }
  if (r.deletes.length) {
    if (shouldAbort?.()) return
    await call(`materials?id=in.(${r.deletes.join(',')})`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    })
  }
}

/** 手动改判分类（category_src 置为 manual，之后自动规则不再覆盖） */
export async function setFileCategory(id: number, category: number): Promise<void> {
  if (!isCloud || !API_BASE) return
  await call(`materials?id=eq.${id}`, {
    method: 'PATCH',
    json: { category, category_src: 'manual', updated_at: new Date().toISOString() },
    headers: { Prefer: 'return=minimal' },
  })
}

/** 批量归类（把选中文件统一改到某一类） */
export async function setFileCategoryBatch(ids: number[], category: number): Promise<void> {
  if (!isCloud || !API_BASE || !ids.length) return
  await call(`materials?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    json: { category, category_src: 'manual', updated_at: new Date().toISOString() },
    headers: { Prefer: 'return=minimal' },
  })
}
