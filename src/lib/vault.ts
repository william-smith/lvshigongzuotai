import { API_BASE, authHeaders, isCloud } from './data'
import { decryptString, encryptString, verifyKey, VERIFIER_PLAIN } from './crypto'
import { notifyExpired } from './auth'

export interface ReEncProgress {
  done: number
  total: number
}

export interface ReEncResult {
  reencrypted: number
  failed: number
  newVerifier: string
  total: number
}

type Row = { id: number; [k: string]: unknown }

interface TablePlan {
  table: string
  select: string
  cols: string[]
  rows?: Row[]
}

async function fetchAll(select: string, table: string): Promise<Row[]> {
  if (!API_BASE) throw new Error('未接云端')
  const url = new URL(`${API_BASE}/${table}`)
  url.searchParams.set('select', select)
  const res = await fetch(url.toString(), { headers: await authHeaders() })
  if (res.status === 401 || res.status === 403) {
    notifyExpired()
    throw new Error('登录已失效，请重新登录')
  }
  if (!res.ok) throw new Error(`读取 ${table} 失败：${res.status}`)
  return (await res.json()) as Row[]
}

async function patchRow(table: string, id: number, patch: Record<string, unknown>): Promise<void> {
  if (!API_BASE) return
  const res = await fetch(`${API_BASE}/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  })
  if (res.status === 401 || res.status === 403) {
    notifyExpired()
    throw new Error('登录已失效，请重新登录')
  }
  if (!res.ok)
    throw new Error(`更新 ${table} ${id} 失败：${res.status}：${(await res.text().catch(() => '')).slice(0, 120)}`)
}

/** 把一批异步任务按并发上限执行，避免一次性打爆连接 */
async function runLimited(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (i < tasks.length) {
      const t = tasks[i++]
      await t()
    }
  })
  await Promise.all(workers)
}

/**
 * 用旧密钥解开所有敏感字段，再用新密钥重新加密写回云端。
 * 全程在浏览器本地完成，口令与明文绝不上传服务器。
 *
 * 设计要点：
 *  - 先用 verifier 校验旧口令正确，再动手，避免「改到一半才发现原口令错」。
 *  - 逐字段先试旧密钥解密：能解开说明还是旧密文 → 重加密；解不开再试新密钥，
 *    能解开说明这行已经迁移过 → 跳过。因此本函数可安全重试（部分失败重跑不会把
 *    已迁移的记录再加密一遍导致解不开）。
 *  - 两张密钥都解不开 → 该行数据已损坏，计入 failed 并跳过，不阻断其余记录。
 */
export async function reencryptVault(
  oldKey: CryptoKey,
  newKey: CryptoKey,
  onProgress?: (p: ReEncProgress) => void,
): Promise<ReEncResult> {
  if (!isCloud || !API_BASE) throw new Error('本地演示数据没有保险箱口令，无需修改')

  const ok = await verifyKey(oldKey)
  if (!ok) throw new Error('原口令不正确，无法改密')

  const plan: TablePlan[] = [
    { table: 'cases', select: 'id,detail_enc', cols: ['detail_enc'] },
    { table: 'intakes', select: 'id,note_enc', cols: ['note_enc'] },
    { table: 'contacts', select: 'id,phone_enc,note_enc', cols: ['phone_enc', 'note_enc'] },
    { table: 'timeline', select: 'id,content_enc', cols: ['content_enc'] },
    { table: 'expenses', select: 'id,detail_enc', cols: ['detail_enc'] },
  ]

  let total = 0
  for (const p of plan) {
    p.rows = await fetchAll(p.select, p.table)
    total += p.rows.length
  }
  total += 1 // vault_meta.verifier

  const newVerifier = await encryptString(newKey, VERIFIER_PLAIN)

  let done = 0
  let reencrypted = 0
  let failed = 0
  onProgress?.({ done, total })

  const tasks: (() => Promise<void>)[] = []
  for (const p of plan) {
    for (const row of p.rows!) {
      tasks.push(async () => {
        const patch: Record<string, unknown> = {}
        let needWrite = false
        for (const col of p.cols) {
          const tok = row[col] as string | null
          if (!tok) continue
          try {
            // 仍是旧密钥加密 → 改成新密钥
            const plain = await decryptString(oldKey, tok)
            patch[col] = await encryptString(newKey, plain)
            needWrite = true
          } catch {
            // 旧密钥解不开：试新密钥判断是否已经迁移过
            try {
              await decryptString(newKey, tok)
              // 已迁移，保持原样，不写
            } catch {
              // 两种密钥都解不开 → 数据损坏，整行跳过统计
              failed++
              done++
              onProgress?.({ done, total })
              return
            }
          }
        }
        if (needWrite) {
          try {
            await patchRow(p.table, row.id, patch)
            reencrypted++
          } catch {
            failed++
          }
        }
        done++
        onProgress?.({ done, total })
      })
    }
  }

  tasks.push(async () => {
    try {
      await patchRow('vault_meta', 1, { verifier_enc: newVerifier })
    } catch {
      failed++
    }
    done++
    onProgress?.({ done, total })
  })

  await runLimited(tasks, 8)

  return { reencrypted, failed, newVerifier, total }
}
