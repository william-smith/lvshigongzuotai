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

/**
 * 把自建库 REST 基址归一化：Supabase/PostgREST 必须以 `/rest/v1` 结尾。
 *
 * 用户手填时常漏掉 `/rest/v1`（如只填 `https://host:16666`），或把云端 CF 函数代理
 * 的 `/api` 前缀也带进来（`https://host/api`）——自建库直连 kong 不需要 `/api`。
 * 这里统一收口：去掉多余 `/api`、补上 `/rest/v1`，避免「地址填了但案件拉不到」这类
 * 因后缀不对导致的 404/空数据（曾发生在手机端：漏填 /rest/v1）。
 */
function normalizeBase(v: string | undefined | null): string {
  let s = clean(v)
  if (!s) return ''
  if (s.endsWith('/api')) s = s.slice(0, -'/api'.length)
  if (!s.endsWith('/rest/v1')) s += '/rest/v1'
  return s
}

/** 供同步等模块复用：把用户手填的 PostgREST 基址归一化为以 /rest/v1 结尾 */
export function normalizeRestBase(v: string | undefined | null): string {
  return normalizeBase(v)
}

/** 云端公开库：构建期注入，所有人共用 */
const CLOUD = {
  base: normalizeBase(import.meta.env.VITE_API_BASE as string | undefined),
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
    return { base: normalizeBase(p.base), key: (p.key ?? '').trim() }
  } catch {
    return { base: '', key: '' }
  }
}

export function writeCustom(c: CustomBackend): void {
  try {
    localStorage.setItem(STORAGE_CUSTOM, JSON.stringify({ base: normalizeBase(c.base), key: c.key.trim() }))
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
