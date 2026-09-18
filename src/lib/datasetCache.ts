/**
 * 登录后数据集的本地缓存：让「返回 / 再次登录」秒开。
 *
 * 设计要点：
 *  - 只存同源本地 IndexedDB，**绝不缓存跨域的 Supabase 响应**（敏感数据只在内存里、
 *    Service Worker 对跨域请求一律透传网络）。缓存的是「已加载完成的数据快照」。
 *  - 用途是首屏即时渲染，后台再拉最新数据覆盖（stale-while-revalidate）。
 *  - 单用户律师应用：案件/时间线/费用量级很小，IndexedDB 写入开销可忽略；
 *    即便隐私模式或配额不足导致写入失败，也只是「不缓存」，不影响功能。
 */

const DB = 'lw-cache'
const STORE = 'kv'
const KEY = 'dataset'

interface Entry<T> {
  v: T
  t: number
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 读取上次成功加载的数据集；没有或损坏时返回 null（调用方会走网络） */
export async function getCachedDataset<T = unknown>(): Promise<T | null> {
  try {
    const db = await open()
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve((req.result as Entry<T> | undefined)?.v ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

/** 写入最新数据集快照（带时间戳，便于将来做过期策略） */
export async function setCachedDataset(v: unknown): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ v, t: Date.now() } as Entry<unknown>, KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    /* 非致命：不缓存而已 */
  }
}

/** 登出 / 切换账号时清掉缓存，避免把上一个用户的数据留在本机 */
export async function clearCachedDataset(): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    /* ignore */
  }
}
