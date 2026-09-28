/**
 * 数据源（后端）解析 —— 统一版。
 *
 * 设计前提（2026-09-29 定）：
 *   - **正常模式 = 多租户公开库**，地址/anon key 由构建注入（VITE_API_BASE / VITE_API_KEY），
 *     对所有律师一致，行级隔离靠 user_id + RLS。
 *   - **role=nas 的用户**可额外切到「自己搭建的自建库」：地址与 anon key **由该用户运行时自己填写**，
 *     只存在本人浏览器 localStorage，**不进公开构建包**（因此不会出现任何人的真实反代域名）。
 *   - 未配置自建库时（绝大多数用户），行为与接入本功能前完全一致：一律走云端。
 *
 * 由于各数据模块在模块顶层解析 base/key，「切换后端后整页刷新」是最省心也最不会出错的应用方式，
 * 不会出现一半请求打云端、一半打自建库的中间态。
 */

export type BackendId = 'cloud' | 'custom'

/** 当前选中的后端（v3：默认 cloud，与 v1/v2 的 NAS 默认区分开） */
const STORAGE_BACKEND = 'lw.backend.v3'
/** 自建库连接信息（仅本人浏览器，绝不进构建包） */
const STORAGE_CUSTOM = 'lw.custom.v1'

function clean(v: string | undefined | null): string {
  return (v ?? '').trim().replace(/\/+$/, '')
}

/** 云端公开库：构建期注入，所有人共用 */
const CLOUD = {
  base: clean(import.meta.env.VITE_API_BASE as string | undefined),
  key: (import.meta.env.VITE_API_KEY as string | undefined)?.trim() ?? '',
}

export interface CustomBackend {
  /** REST 基址，形如 https://your-proxy.example.com/rest/v1 */
  base: string
  /** 该自建库的 anon key */
  key: string
}

export function readCustom(): CustomBackend {
  try {
    const raw = localStorage.getItem(STORAGE_CUSTOM)
    if (!raw) return { base: '', key: '' }
    const p = JSON.parse(raw) as Partial<CustomBackend>
    return { base: clean(p.base), key: (p.key ?? '').trim() }
  } catch {
    return { base: '', key: '' }
  }
}

export function writeCustom(c: CustomBackend): void {
  try {
    localStorage.setItem(STORAGE_CUSTOM, JSON.stringify({ base: clean(c.base), key: c.key.trim() }))
  } catch {
    /* 隐私模式写不了：只在本次会话内不持久化 */
  }
}

export function clearCustom(): void {
  try {
    localStorage.removeItem(STORAGE_CUSTOM)
    localStorage.removeItem(STORAGE_BACKEND)
  } catch {
    /* ignore */
  }
}

export function customConfigured(): boolean {
  const c = readCustom()
  return Boolean(c.base && c.key)
}

/** 当前生效后端：显式选择优先且必须已配置；否则一律云端 */
export function activeBackend(): BackendId {
  try {
    const v = localStorage.getItem(STORAGE_BACKEND)
    if (v === 'custom' && customConfigured()) return 'custom'
  } catch {
    /* ignore */
  }
  return 'cloud'
}

export function setBackend(id: BackendId): void {
  try {
    localStorage.setItem(STORAGE_BACKEND, id)
  } catch {
    /* ignore */
  }
}

/** 解析生效的 base/key（各数据模块在加载时调用一次） */
export function resolveApi(): { base: string; key: string; backend: BackendId } {
  if (activeBackend() === 'custom') {
    const c = readCustom()
    if (c.base && c.key) return { base: c.base, key: c.key, backend: 'custom' }
  }
  return { base: CLOUD.base, key: CLOUD.key, backend: 'cloud' }
}
