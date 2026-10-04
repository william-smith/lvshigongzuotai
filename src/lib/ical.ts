/**
 * 日历订阅 helper（自包含）。
 *
 * 职责：
 *   - 把「数值 + 单位」转成 ISO8601 duration（提醒提前量）；
 *   - 生成/吊销 ical_tokens 订阅密钥（存 Supabase 的 ical_tokens 表）；
 *   - 拼出各平台日历 App 可直接订阅的 .ics URL。
 *
 * 读写 ical_tokens 走现有的 authedFetch（云端/自建库通用，自动带 JWT），
 * URL base 用 apiConfig.resolveApi() 拿当前生效后端地址。
 */
import { sessionTokenFor } from './auth'
import { activeBackend, apiFor } from './apiConfig'

/* ---------------- ISO8601 duration ---------------- */

export type DurationUnit = 'minutes' | 'hours' | 'days'

/** 值 + 单位 → ISO8601 duration：'PT{n}M' / 'PT{n}H' / 'P{n}D' */
export function isoDuration(value: number, unit: DurationUnit): string {
  if (unit === 'minutes') return `PT${value}M`
  if (unit === 'hours') return `PT${value}H`
  return `P${value}D`
}

/** 解析上面三种格式，未知返回 null */
export function parseDuration(d: string): { value: number; unit: DurationUnit } | null {
  const m = /^PT(\d+)M$/.exec(d)
  if (m) return { value: Number(m[1]), unit: 'minutes' }
  const h = /^PT(\d+)H$/.exec(d)
  if (h) return { value: Number(h[1]), unit: 'hours' }
  const day = /^P(\d+)D$/.exec(d)
  if (day) return { value: Number(day[1]), unit: 'days' }
  return null
}

/** 把 duration 渲染成中文（用于 chip 展示）：如「提前 90 分钟」 */
export function humanizeDuration(d: string): string {
  const p = parseDuration(d)
  if (!p) return d
  const label = p.unit === 'minutes' ? '分钟' : p.unit === 'hours' ? '小时' : '天'
  return `提前 ${p.value} ${label}`
}

/* ---------------- 密钥 ---------------- */

/** 32 字节随机十六进制（64 个 hex 字符） */
export function genKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Web Crypto SHA-256 → hex */
export async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

/* ---------------- 后端判定（与 apiConfig 一致） ---------------- */

/**
 * 当前后端：映射 apiConfig.activeBackend() 的 'cloud'|'custom' 到任务约定的 'cloud'|'nas'。
 * （本系统里自建库就叫 nas，apiConfig 的枚举叫 'custom'，语义一致。）
 */
export function currentBackend(): 'cloud' | 'nas' {
  return activeBackend() === 'custom' ? 'nas' : 'cloud'
}

/**
 * 自建库（NAS）的日历订阅基址。
 *
 * 走构建期环境变量 `VITE_NAS_CAL_BASE`：真值只写在本地 .env（已 gitignore），
 * 公开仓库里只留占位说明，避免把内网反代域名/IP 带进开源仓库。
 * 未配置时为空串，Settings 日历卡会提示"未配置自建库日历地址"。
 */
const NAS_CAL_BASE = (import.meta.env.VITE_NAS_CAL_BASE ?? '').trim()

/** 订阅 URL 的基址：云端走 Cloudflare Pages 函数；自建库走其反代上的 cal-ics 桥接服务 */
function subscriptionBase(backend: 'cloud' | 'nas'): string {
  return backend === 'nas'
    ? NAS_CAL_BASE
    : 'https://lawyer-workbench-public.pages.dev/api/calendar.ics'
}

/** 该后端当前是否具备可用的订阅地址（自建库需先配 VITE_NAS_CAL_BASE） */
export function subscriptionConfigured(backend: 'cloud' | 'nas'): boolean {
  return subscriptionBase(backend) !== ''
}

/** 订阅 URL：基址 + ?key=明文密钥（明确指定云端或自建库，二选一） */
export function subscriptionUrl(key: string, backend: 'cloud' | 'nas'): string {
  return `${subscriptionBase(backend)}?key=${key}`
}

const KEY_STORAGE_PREFIX = 'lw.ical.key.v1.'

/* ---------------- ical_tokens 读写 ---------------- */

/**
 * 维护并取回指定后端的订阅密钥（明文，仅存本机 localStorage）。
 *   - 已有 → 直接返回；
 *   - 没有 → 生成明文 key，sha256 得 hash，POST 到 <该后端base>/ical_tokens
 *     body {token_hash: hash}；成功把明文存 localStorage 并返回，失败返回 null。
 * 用显式 backend 直连该后端（不经 authedFetch，避免 apikey 被当前生效后端覆盖）；
 * 鉴权用该后端自己的会话 JWT（sessionTokenFor），未登录该后端时退化为 anon key
 * （云端 RLS 会拒、NAS 单用户 RLS 放行）。
 */
export async function ensureToken(backend: 'cloud' | 'nas'): Promise<string | null> {
  const storageKey = KEY_STORAGE_PREFIX + backend
  try {
    const existing = localStorage.getItem(storageKey)
    if (existing) return existing
  } catch {
    /* 隐私模式读不了 */
  }

  const plain = genKey()
  const hash = await sha256Hex(plain)
  const cfg = apiFor(backend === 'cloud' ? 'cloud' : 'custom')
  if (!cfg.base || !cfg.key) return null
  const token = sessionTokenFor(backend === 'cloud' ? 'cloud' : 'custom')
  const res = await fetch(`${cfg.base}/ical_tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: cfg.key,
      Authorization: `Bearer ${token ?? cfg.key}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ token_hash: hash }),
  })
  if (!res.ok) return null

  try {
    localStorage.setItem(storageKey, plain)
  } catch {
    /* 隐私模式写不了：本次会话内仍返回明文，刷新后需重新生成 */
  }
  return plain
}

/** 吊销密钥：PATCH <该后端base>/ical_tokens?token_hash=eq.<hash> body {revoked:true} */
export async function revokeToken(key: string, backend: 'cloud' | 'nas'): Promise<void> {
  const hash = await sha256Hex(key)
  const cfg = apiFor(backend === 'cloud' ? 'cloud' : 'custom')
  if (!cfg.base || !cfg.key) return
  const token = sessionTokenFor(backend === 'cloud' ? 'cloud' : 'custom')
  await fetch(`${cfg.base}/ical_tokens?token_hash=eq.${hash}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: cfg.key,
      Authorization: `Bearer ${token ?? cfg.key}`,
    },
    body: JSON.stringify({ revoked: true }),
  })
}

/** 清除本机保存的某后端订阅密钥明文（吊销成功后调用） */
export function clearLocalToken(backend: 'cloud' | 'nas'): void {
  try {
    localStorage.removeItem(KEY_STORAGE_PREFIX + backend)
  } catch {
    /* ignore */
  }
}
