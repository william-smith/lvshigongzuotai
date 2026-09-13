/**
 * 本地同步目录访问（File System Access API）
 *
 * 这是「电脑端点开就能看到证据原图、但文件一个字节都不出本机」的关键：
 * 用户在 Chrome / Edge 里授权一次同步根目录，浏览器拿到目录句柄（存 IndexedDB），
 * 之后网页可以本地枚举目录、本地读取文件并直接渲染 —— 全程不经过任何服务器。
 *
 * 限制：桌面版 Chromium 全支持；移动端上 Android Edge（Chromium 内核）同样支持目录授权与句柄枚举，
 * 但出于安全浏览器不暴露完整文件系统路径（只能拿到所选目录名）。iOS Safari 仍不支持。
 * 因此手机端也能本地枚举、本地预览证据原图；根目录「路径字符串」若用户未在本机设置手动填写，则退回所选目录名。
 */

/** 只声明用到的部分，避免不同 TS 版本 lib.dom 里同名类型冲突 */
export interface FsFileHandle {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
}

export interface FsDirHandle {
  readonly kind: 'directory'
  readonly name: string
  values(): AsyncIterableIterator<FsEntry>
  getDirectoryHandle(name: string): Promise<FsDirHandle>
  getFileHandle(name: string): Promise<FsFileHandle>
  queryPermission(d?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(d?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  isSameEntry?(other: FsEntry): Promise<boolean>
}

export type FsEntry =
  | (FsFileHandle & { kind: 'file' })
  | (FsDirHandle & { kind: 'directory' })

type Picker = (opts?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FsDirHandle>

export function fsSupported(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker === 'function'
}

// ---------------- IndexedDB：持久化目录句柄 ----------------
const DB_NAME = 'lawyer-workbench-fs'
const STORE = 'handles'
const ROOT_KEY = 'sync-root'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idb<T>(fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const req = fn(tx.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

export interface RootBinding {
  handle: FsDirHandle
  name: string
  boundAt: string
}

/** 弹出系统目录选择框，让用户指定同步根目录（如 D:\Documents\法法\同步\案件） */
export async function pickRoot(): Promise<RootBinding | null> {
  const picker = (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker
  if (!picker) return null
  const handle = await picker({ id: 'lawyer-sync-root', mode: 'read' })
  const binding: RootBinding = { handle, name: handle.name, boundAt: new Date().toISOString() }
  await idb((s) => s.put(binding, ROOT_KEY) as IDBRequest<IDBValidKey>)
  return binding
}

export async function loadRoot(): Promise<RootBinding | null> {
  try {
    const v = await idb((s) => s.get(ROOT_KEY) as IDBRequest<RootBinding | undefined>)
    return v ?? null
  } catch {
    return null
  }
}

export async function clearRoot(): Promise<void> {
  await idb((s) => s.delete(ROOT_KEY) as IDBRequest<undefined>)
}

/** 权限状态：granted 可直接读；prompt 需要用户点一下重新授权（浏览器安全策略，隔久了会要一次） */
export async function permissionOf(handle: FsDirHandle): Promise<PermissionState> {
  try {
    const q = await handle.queryPermission({ mode: 'read' })
    if (q === 'granted') return 'granted'
    return await handle.requestPermission({ mode: 'read' })
  } catch {
    return 'denied'
  }
}

// ---------------- 枚举 ----------------

/** 同步工具产生的临时文件、系统隐藏文件，不进索引 */
const IGNORE: RegExp[] = [/^\./, /^\~\$/, /\.!sync$/i, /\.tmp$/i, /^desktop\.ini$/i, /^\.DS_Store$/i]

function ignored(name: string): boolean {
  return IGNORE.some((re) => re.test(name))
}

export interface LocalFile {
  relPath: string
  name: string
  size: number
  lastModified: number
  handle: FsFileHandle
}

async function walk(
  dir: FsDirHandle,
  prefix: string,
  out: LocalFile[],
  depth: number,
  maxDepth: number,
  shouldAbort?: () => boolean,
) {
  if (depth > maxDepth) return
  for await (const entry of dir.values()) {
    if (shouldAbort?.()) return
    if (ignored(entry.name)) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if ((entry.kind as string) === 'file') {
      const fh = entry as unknown as FsFileHandle
      try {
        const f = await fh.getFile() // 只取元数据，不读内容
        out.push({ relPath: rel, name: entry.name, size: f.size, lastModified: f.lastModified, handle: fh })
      } catch {
        /* 读不到的（被占用/权限）跳过 */
      }
    } else if ((entry.kind as string) === 'directory') {
      await walk(entry as unknown as FsDirHandle, rel, out, depth + 1, maxDepth)
    }
  }
}

/** 列出根目录下的一级子目录（用于把文件夹匹配到案件） */
export async function listSubDirs(
  root: FsDirHandle,
  shouldAbort?: () => boolean,
): Promise<{ name: string; handle: FsDirHandle }[]> {
  const out: { name: string; handle: FsDirHandle }[] = []
  for await (const entry of root.values()) {
    if (shouldAbort?.()) break
    if ((entry.kind as string) !== 'directory') continue
    if (ignored(entry.name)) continue
    out.push({ name: entry.name, handle: entry as unknown as FsDirHandle })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

/**
 * 读取某个案件文件夹下的全部文件。
 * folderName 为空、或与根目录同名时，直接遍历根目录（用户把单个案件文件夹当根授权的情况）。
 */
export async function listCaseFiles(
  root: FsDirHandle,
  folderName?: string | null,
  shouldAbort?: () => boolean,
): Promise<LocalFile[]> {
  if (!folderName || folderName === root.name) {
    const out: LocalFile[] = []
    await walk(root, '', out, 0, 5, shouldAbort)
    return out
  }
  for await (const entry of root.values()) {
    if (shouldAbort?.()) return []
    if ((entry.kind as string) === 'directory' && entry.name === folderName) {
      const out: LocalFile[] = []
      await walk(entry as unknown as FsDirHandle, '', out, 0, 5, shouldAbort)
      return out
    }
  }
  return []
}

/**
 * 按 rel_path 现取文件句柄。
 * 关键用途：文件句柄只存在内存里，页面刷新后就没了——
 * 有了它，即便这一轮没扫描，只要根目录还授权着，点文件名也能当场解析并打开原图。
 */
export async function resolveFileHandle(
  root: FsDirHandle,
  folderName: string | null | undefined,
  relPath: string,
): Promise<FsFileHandle | null> {
  try {
    let dir = root
    if (folderName && folderName !== root.name) {
      let found: FsDirHandle | null = null
      for await (const e of root.values()) {
        if ((e.kind as string) === 'directory' && e.name === folderName) {
          found = e as unknown as FsDirHandle
          break
        }
      }
      if (!found) return null
      dir = found
    }
    const parts = relPath.split('/').filter(Boolean)
    for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i])
    return await dir.getFileHandle(parts[parts.length - 1])
  } catch {
    return null // 被改名或删掉了
  }
}

/** 生成本地预览用的 object URL（用完记得 revokeObjectURL） */
export async function previewUrl(handle: FsFileHandle): Promise<string> {
  const f = await handle.getFile()
  return URL.createObjectURL(f)
}

/** 复制文本到剪贴板（带 file:// 时代之前的兜底） */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  }
}
