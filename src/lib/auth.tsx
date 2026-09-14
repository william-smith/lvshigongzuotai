import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * 登录：走 Supabase Auth 的标准 REST（GoTrue），同样不绑定 SDK。
 * 登录成功后拿到的 access_token 会替代 anon key 去读数据，
 * 这样数据库的行级安全就能认出「你是谁」，未登录的人一条都读不到。
 */

const REST_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) || '').replace(/\/+$/, '')
const ANON_KEY = import.meta.env.VITE_API_KEY as string | undefined
const AUTH_BASE = REST_BASE ? REST_BASE.replace(/\/rest\/v1\/?$/, '') + '/auth/v1' : ''

/** 只有接了云端才需要登录；本地演示数据直接放行 */
export const authEnabled = Boolean(AUTH_BASE && ANON_KEY)

const STORAGE = 'lw.auth.v1'

export interface Session {
  access_token: string
  refresh_token: string
  expires_at: number
  email: string
}

const TEMP = 'lw.auth.temp'

function parse(raw: string | null): Session | null {
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as Session
    return s?.access_token ? s : null
  } catch {
    return null
  }
}

/** 勾「记住我」→ localStorage（长期）；否则 → sessionStorage（关掉标签页即失效） */
function readSession(): Session | null {
  try {
    return parse(localStorage.getItem(STORAGE)) ?? parse(sessionStorage.getItem(TEMP))
  } catch {
    return parse(localStorage.getItem(STORAGE))
  }
}

function writeSession(s: Session | null, remember = true) {
  try {
    localStorage.removeItem(STORAGE)
    sessionStorage.removeItem(TEMP)
    if (s) {
      const raw = JSON.stringify(s)
      if (remember) localStorage.setItem(STORAGE, raw)
      else sessionStorage.setItem(TEMP, raw)
    }
  } catch {
    /* 隐私模式下写不了就算了，只是每次要重新登录 */
  }
}

interface TokenResp {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  user?: { email?: string }
  error_description?: string
  error?: string
  msg?: string
}

function pickError(b: TokenResp, status: number): string {
  const raw = b.error_description || b.msg || b.error || ''
  if (status === 400 || status === 401) return '邮箱或密码不对'
  if (status === 422) return raw.includes('Email') ? '邮箱格式不对' : raw || '登录失败'
  if (status === 429) return '尝试太频繁，稍等一分钟再试'
  return raw || `登录失败（HTTP ${status}）`
}

export async function signIn(email: string, password: string, remember = true): Promise<Session> {
  if (!AUTH_BASE || !ANON_KEY) throw new Error('未配置 VITE_API_BASE')
  const res = await fetch(`${AUTH_BASE}/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const b = (await res.json().catch(() => ({}))) as TokenResp
  if (!res.ok || !b.access_token) throw new Error(pickError(b, res.status))
  const s: Session = {
    access_token: b.access_token,
    refresh_token: b.refresh_token ?? '',
    expires_at: Date.now() + (b.expires_in ?? 3600) * 1000,
    email: b.user?.email || email,
  }
  writeSession(s, remember)
  return s
}

export async function signOut(): Promise<void> {
  const s = readSession()
  writeSession(null)
  if (s && AUTH_BASE && ANON_KEY) {
    await fetch(`${AUTH_BASE}/logout`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${s.access_token}` },
    }).catch(() => undefined)
  }
}

/**
 * 修改登录密码（需已登录）。调 Supabase Auth 的 `PUT /user`，
 * 同样不绑定 SDK，与登录/续期共用同一套 REST 写法。
 * 成功后 Supabase 会令其他设备的会话失效，当前会话仍有效。
 */
export async function changePassword(newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const token = await getAccessToken()
  if (!token || !AUTH_BASE || !ANON_KEY) return { ok: false, error: '未登录或尚未接入云端' }
  try {
    const res = await fetch(`${AUTH_BASE}/user`, {
      method: 'PUT',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
    })
    const b = (await res.json().catch(() => ({}))) as TokenResp & { message?: string }
    if (!res.ok) {
      const raw = b.error_description || b.msg || b.message || b.error || ''
      const msg = raw.includes('same') || raw.includes('different')
        ? '新密码不能和当前密码相同'
        : raw.includes('at least') || raw.includes('length') || raw.toLowerCase().includes('weak')
          ? '密码强度不足（至少 6 位）'
          : raw || `修改失败（HTTP ${res.status}）`
      return { ok: false, error: msg }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: '网络异常，请稍后重试' }
  }
}

/** 登录状态失效时（401）由数据层调用，强制回到登录页 */
let onExpired: (() => void) | null = null
export function setOnExpired(cb: () => void) {
  onExpired = cb
}

/** 某个 token 是否仍是「当前会话正在用的」这枚 */
export function isCurrentToken(token: string | null | undefined): boolean {
  if (!token) return false
  const s = readSession()
  return !!s && s.access_token === token
}

/**
 * 登录态失效 → 回登录页。
 *
 * ⚠️ 必须区分「哪一枚 token 失效了」：
 *   上一枚过期 token 的**迟到 401 回包**，如果无差别清空登录态，就会把用户
 *   刚刚登录成功得到的新会话一起抹掉——表现就是「登录成功后又被踢回登录页，
 *   第二次才进得去」。
 *   因此带 token 调用时，只有「失败的确实是当前这枚 token」才真的登出。
 */
export function notifyExpired(token?: string | null) {
  if (token !== undefined && !isCurrentToken(token)) return // 迟到回包，忽略
  if (!readSession()) return // 已经登出，不必重复清理
  writeSession(null)
  onExpired?.()
}

let refreshing: Promise<string | null> | null = null

/**
 * 取可用的 access_token，快过期时自动续期。
 * @param force 忽略本地过期时间，强制走一次续期（用于 401 后重试）
 */
export async function getAccessToken(force = false): Promise<string | null> {
  if (!authEnabled) return null
  const s = readSession()
  if (!s) return null
  if (!force && s.expires_at - Date.now() > 60_000) return s.access_token
  if (!s.refresh_token) return force ? null : s.access_token

  if (!refreshing) {
    const usedRefresh = s.refresh_token
    refreshing = (async () => {
      let res: Response
      try {
        res = await fetch(`${AUTH_BASE}/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: { apikey: ANON_KEY as string, 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: usedRefresh }),
        })
      } catch {
        // 网络异常（不是登录失效）：**不要**交出已过期的 token——交出去必然 401，
        // 反而会触发误登出。抛出去让界面提示「网络异常」，会话原样保留。
        throw new Error('网络异常，未能连接服务器，请稍后重试')
      }
      const b = (await res.json().catch(() => ({}))) as TokenResp
      if (!res.ok || !b.access_token) {
        notifyExpired(s.access_token) // 续期被拒 → 会话确实失效
        return null
      }
      const next: Session = {
        access_token: b.access_token,
        refresh_token: b.refresh_token ?? usedRefresh,
        expires_at: Date.now() + (b.expires_in ?? 3600) * 1000,
        email: s.email,
      }
      const cur = readSession()
      if (!cur || cur.refresh_token !== usedRefresh) {
        // 续期期间发生了新的登录/登出 → 别用旧会话覆盖它
        return cur?.access_token ?? null
      }
      writeSession(next)
      return next.access_token
    })().finally(() => {
      refreshing = null
    })
  }
  return refreshing
}

/**
 * 带登录态的 fetch（数据层统一入口）。
 *
 * 401/403 时不立刻登出，而是：
 *   1. 若期间已经换过新会话（当前 token ≠ 本次用的 token）→ 直接用新 token 重试一次；
 *   2. 否则强制续期一次，拿到新 token 就重试；
 *   3. 重试后仍 401 → 才判定为真的失效，带 token 调用 notifyExpired（只会清掉这一枚对应的会话）。
 *
 * 这样「上一枚 token 的迟到 401」既不会登出，也能被自动重试挽救。
 */
export async function authedFetch(input: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const token = await getAccessToken()
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string> | undefined) ?? {}),
    apikey: (ANON_KEY as string) ?? '',
    Authorization: `Bearer ${token ?? ANON_KEY ?? ''}`,
  }
  const res = await fetch(input, { ...init, headers })
  if (res.status === 401 || res.status === 403) {
    if (!retried) {
      const cur = readSession()?.access_token
      if (cur && cur !== token) return authedFetch(input, init, true)
      let fresh: string | null = null
      try {
        fresh = await getAccessToken(true)
      } catch {
        fresh = null // 网络异常：按失败处理，但下面 notifyExpired 会因 token 已变而不登出
      }
      if (fresh && fresh !== token) return authedFetch(input, init, true)
    }
    notifyExpired(token)
  }
  return res
}

/* ---------------- Provider ---------------- */

interface AuthState {
  ready: boolean
  session: Session | null
  email: string
  login: (email: string, password: string, remember: boolean) => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setOnExpired(() => setSession(null))
    const s = readSession()
    // 隔夜/隔小时再打开时，本地存着的 token 多半已过期。
    // **必须先静默续期、拿到结果再放行**：否则会先把主界面当「已登录」渲染出来，
    // 数据层随即拿着过期 token 请求 → 全部 401 → 人被踢回登录页
    //（这就是「当天第一次打开先进去又被弹回登录」的由来）。
    if (s && s.refresh_token && s.expires_at - Date.now() <= 60_000) {
      getAccessToken()
        .catch(() => null) // 网络异常：保持已登出以外的原状，交给登录页处理
        .then(() => {
          setSession(readSession()) // 续期成功 = 新会话；失败 = notifyExpired 已清空
          setReady(true)
        })
      return
    }
    setSession(s)
    setReady(true)
  }, [])

  const login = useCallback(async (email: string, password: string, remember: boolean) => {
    const s = await signIn(email, password, remember)
    setSession(s)
  }, [])

  const logout = useCallback(async () => {
    await signOut()
    setSession(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ ready, session, email: session?.email ?? '', login, logout }),
    [ready, session, login, logout],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return v
}

