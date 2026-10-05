import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiFor, customConfigured, resolveApi, type BackendId } from './apiConfig'

/**
 * 登录：走 Supabase Auth 的标准 REST（GoTrue），同样不绑定 SDK。
 * 登录成功后拿到的 access_token 会替代 anon key 去读数据，
 * 这样数据库的行级安全就能认出「你是谁」，未登录的人一条都读不到。
 */

/**
 * 生效后端：默认云端公开库（多租户）；role=nas 且本人填过自建库并显式切换时才走自建库。
 * 模块顶层解析一次，切换后端由 Settings 写入 localStorage 后整页刷新生效。
 */
const { base: REST_BASE, key: ANON_KEY, backend: ACTIVE_BACKEND } = resolveApi()
const AUTH_BASE = REST_BASE ? REST_BASE.replace(/\/rest\/v1\/?$/, '') + '/auth/v1' : ''

/** 登录/注册/找回密码时按「当前生效后端」动态取认证地址——切换数据源后无需整页刷新即可打到所选后端 */
function authBaseNow(): { authBase: string; key: string } {
  const r = resolveApi()
  return { authBase: r.base ? r.base.replace(/\/rest\/v1\/?$/, '') + '/auth/v1' : '', key: r.key }
}

/** 只有接了云端才需要登录；本地演示数据直接放行 */
export const authEnabled = Boolean(AUTH_BASE && ANON_KEY)

/**
 * 登录会话按后端隔离：云端与自建库由不同的 GoTrue 实例签发 JWT（密钥不同），
 * 若共用一把全局会话，切到自建库后仍会拿云端的 token 去请求自建库——
 * 自建库验不过签名 → 401 → 取不到案件。
 * 因此每个后端各存一份会话（key 带后端标签），切换后端后各自独立登录。
 */
/**
 * 会话键按「当前生效后端」派生。切换后端后不再整页刷新，登录时必须按最新后端算，
 * 否则会话会被存到错误的键、刷新后读不到（2026-10-05 优化：去掉切换时的刷新）。
 */
function sessionTag(): string {
  const r = resolveApi()
  if (r.backend === 'cloud') return 'cloud'
  try {
    const host = new URL(r.base || '').host
    return 'nas-' + host.replace(/[^a-z0-9]/gi, '_')
  } catch {
    return 'nas'
  }
}
function sessionStorageKey(): string {
  return `lw.auth.v1.${sessionTag()}`
}
function sessionTempKey(): string {
  return `lw.auth.temp.${sessionTag()}`
}

// 一次性迁移：把旧的全局会话键迁移到按后端命名的新键，避免老用户被强制登出。
;(function migrateLegacySession() {
  try {
    if (ACTIVE_BACKEND === 'cloud' && !localStorage.getItem(sessionStorageKey())) {
      const legacy = localStorage.getItem('lw.auth.v1')
      if (legacy) {
        localStorage.setItem(sessionStorageKey(), legacy)
        localStorage.removeItem('lw.auth.v1')
      }
    }
    if (ACTIVE_BACKEND === 'cloud' && !sessionStorage.getItem(sessionTempKey())) {
      const lt = sessionStorage.getItem('lw.auth.temp')
      if (lt) {
        sessionStorage.setItem(sessionTempKey(), lt)
        sessionStorage.removeItem('lw.auth.temp')
      }
    }
  } catch {
    /* 隐私模式读不了就算了 */
  }
})()

export interface Session {
  access_token: string
  refresh_token: string
  expires_at: number
  email: string
}

/** base64url → UTF-8 JSON（JWT payload 里可能有中文，不能直接 atob 后 JSON.parse） */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const b64 = token.split('.')[1]
    if (!b64) return null
    const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
  } catch {
    return null
  }
}

/** 从 JWT 读角色：app_metadata.role 优先，其次 user_metadata.role */
function roleFromJwt(token: string): string | null {
  const p = decodeJwtPayload(token)
  if (!p) return null
  const appMeta = p.app_metadata as { role?: string } | undefined
  const userMeta = p.user_metadata as { role?: string } | undefined
  return appMeta?.role ?? userMeta?.role ?? null
}

/**
 * 当前登录账号的角色；未登录返回 null。
 *
 * 角色由服务端签发进 JWT（app_metadata.role），前端**只读不写**。
 * 注意：前端据此隐藏入口只是体验层面的收敛，真正的权限边界仍在服务端 RLS / 鉴权。
 */
export function currentRole(): string | null {
  const s = readSession()
  return s ? roleFromJwt(s.access_token) : null
}

/**
 * 是否具备「自建库相关能力」——满足任一即视为 nas 用户：
 *   1) 服务端在 JWT 里打了 role=nas；
 *   2) **本人已填写了自己的自建库地址与 key**。
 *
 * 第 2 条是刻意加的：否则会形成死循环——入口只在 role=nas 时显示，
 * 而 role=nas 又要先在服务端打标，用户根本没机会去填地址。
 * 「填了自己的库」本身就是最可靠的自建用户判定，且不依赖服务端改数据。
 */
export function isNasRole(): boolean {
  if (currentRole() === 'nas') return true
  try {
    return customConfigured()
  } catch {
    return false
  }
}

/**
 * 当前登录账号的 uid（JWT 的 sub 声明）；未登录返回 null。
 *
 * 同步到多租户云端库时要带上它，只取归属自己的行——
 * 否则用 service_role 绕开 RLS 会把所有律师的数据整表拉走。
 */
export function currentUserId(): string | null {
  const s = readSession()
  if (!s) return null
  const p = decodeJwtPayload(s.access_token)
  const sub = p?.sub
  return typeof sub === 'string' && sub ? sub : null
}

/**
 * 云端账号 uid（多租户库归属用）。
 *
 * 与 currentUserId() 的关键区别：currentUserId() 读的是「当前生效后端」的会话——
 * 在 NAS 模式下读到的其实是 NAS 自建库的 uid，把它写进云端库后，云端 RLS
 * （user_id = auth.uid()）会把这串外来 uid 的行全部过滤掉，切回云端登录就看不到数据
 * （2026-09-29 排查确认的根因）。
 *
 * 这里**固定读云端会话键 `lw.auth.v1.cloud`**，不论当前是在 NAS 还是云端模式，
 * 保证同步给云端行打上的一定是「云端本人账号的 uid」。
 * 云端会话即便已过期也无妨——只取 uid 字符串，同步本身用 service_role 鉴权，不依赖它。
 */
export function cloudAccountUid(): string | null {
  // 优先用「记住的云端 uid」：登录云端时记下，之后即使云端会话过期 / 被登出也仍能用于同步标记归属，
  // 避免「明明在云端登录过、同步却因会话被清而报 uid 缺失」。
  try {
    const cached = localStorage.getItem(CLOUD_UID_KEY)
    if (cached) return cached
  } catch {
    /* ignore */
  }
  try {
    const raw = localStorage.getItem('lw.auth.v1.cloud')
    if (!raw) return null
    const s = parse(raw)
    if (!s?.access_token) return null
    const p = decodeJwtPayload(s.access_token)
    const sub = p?.sub
    if (typeof sub === 'string' && sub) {
      try {
        localStorage.setItem(CLOUD_UID_KEY, sub)
        if (s.email) localStorage.setItem(CLOUD_EMAIL_KEY, s.email)
      } catch {
        /* ignore */
      }
      return sub
    }
    return null
  } catch {
    return null
  }
}

const CLOUD_UID_KEY = 'lw.cloud.uid.v1'
const CLOUD_EMAIL_KEY = 'lw.cloud.email.v1'

/** 云端公开库的认证配置（与当前生效后端无关，固定指向云端） */
function cloudAuth(): { authBase: string; key: string } {
  const { base, key } = apiFor('cloud')
  const authBase = base ? base.replace(/\/rest\/v1\/?$/, '') + '/auth/v1' : ''
  return { authBase, key }
}

/**
 * 登录云端账号（与当前生效后端无关）—— 供「同步前一次性绑定云端 uid」用，
 * 避免用户为了同步还得退出到登录页切数据源、来回折腾。
 * 成功后：云端会话写入固定的 `lw.auth.v1.cloud`，uid 记入 `lw.cloud.uid.v1`
 * （后者独立于会话，云端会话过期 / 登出后同步仍可用）。
 */
export async function signInToCloud(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const { authBase, key } = cloudAuth()
  if (!authBase || !key) return { ok: false, error: '未配置云端公开库地址' }
  try {
    const res = await timedFetch(`${authBase}/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const b = (await res.json().catch(() => ({}))) as TokenResp
    if (!res.ok || !b.access_token) return { ok: false, error: pickError(b, res.status) }
    const s: Session = {
      access_token: b.access_token,
      refresh_token: b.refresh_token ?? '',
      expires_at: Date.now() + (b.expires_in ?? 3600) * 1000,
      email: b.user?.email || email,
    }
    try {
      localStorage.setItem('lw.auth.v1.cloud', JSON.stringify(s))
    } catch {
      /* ignore */
    }
    const uid = decodeJwtPayload(b.access_token)?.sub
    try {
      if (typeof uid === 'string' && uid) localStorage.setItem(CLOUD_UID_KEY, uid)
      localStorage.setItem(CLOUD_EMAIL_KEY, s.email)
    } catch {
      /* ignore */
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: netError(e).message }
  }
}

/**
 * 解除云端绑定：清掉记住的云端 uid 与云端会话——用于同步卡里「更换云端账号」重新绑定到另一个云端账号。
 * 若当前处于自建库模式，不影响 NAS 会话（只清云端那一份）。
 */
export function clearCloudBinding(): void {
  try {
    localStorage.removeItem(CLOUD_UID_KEY)
    localStorage.removeItem(CLOUD_EMAIL_KEY)
    localStorage.removeItem('lw.auth.v1.cloud')
  } catch {
    /* ignore */
  }
}

/** 已记住的云端账号邮箱（仅用于界面展示「同步绑定的是哪个云端账号」；绑定期/换绑后随 uid 一起更新）。 */
export function cloudAccountEmail(): string | null {
  try {
    const cached = localStorage.getItem(CLOUD_EMAIL_KEY)
    if (cached) return cached
  } catch {
    /* ignore */
  }
  try {
    const raw = localStorage.getItem('lw.auth.v1.cloud')
    if (!raw) return null
    const s2 = parse(raw)
    return s2?.email || null
  } catch {
    return null
  }
}

function parse(raw: string | null): Session | null {
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as Session
    return s?.access_token ? s : null
  } catch {
    return null
  }
}

/**
 * 取指定后端的当前会话 access_token（日历订阅显式选「云端 / 自建库」时，
 * 往该后端写 ical_tokens 要用它对应的 JWT，不能用当前生效后端那枚）。
 * 键名规则与 sessionTag() 一致：cloud → `lw.auth.v1.cloud`；
 * 自建库 → `lw.auth.v1.nas-<hostHash>`（hostHash 取 REST 基址 host 的非字母数字字符替换为 _）。
 * 未登录该后端返回 null（调用方据此提示「请先登录到该后端」）。
 */
export function sessionTokenFor(backend: BackendId): string | null {
  let key: string
  if (backend === 'cloud') {
    key = 'lw.auth.v1.cloud'
  } else {
    const base = apiFor('custom').base
    let host = ''
    try {
      host = new URL(base || '').host
    } catch {
      /* ignore */
    }
    key = `lw.auth.v1.nas-${host.replace(/[^a-z0-9]/gi, '_')}`
  }
  return parse(localStorage.getItem(key) ?? null)?.access_token ?? null
}

/** 勾「记住我」→ localStorage（长期）；否则 → sessionStorage（关掉标签页即失效） */
function readSession(): Session | null {
  try {
    return parse(localStorage.getItem(sessionStorageKey())) ?? parse(sessionStorage.getItem(sessionTempKey()))
  } catch {
    return parse(localStorage.getItem(sessionStorageKey()))
  }
}

function writeSession(s: Session | null, remember = true) {
  try {
    localStorage.removeItem(sessionStorageKey())
    sessionStorage.removeItem(sessionTempKey())
    if (s) {
      const raw = JSON.stringify(s)
      if (remember) localStorage.setItem(sessionStorageKey(), raw)
      else sessionStorage.setItem(sessionTempKey(), raw)
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

/** 请求超时（毫秒）。网络不通 / 后端不可达时，不让界面无限转圈。 */
const REQ_TIMEOUT_MS = 15_000

/**
 * 带超时的 fetch：超过 REQ_TIMEOUT_MS 自动 abort，让上层能给出明确的中文物。
 * 原生 fetch 在 DNS 失败 / 连接被拒 / SNI 拦截时可能卡很久才失败，登录与点数据都靠它。
 */
async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** 把 fetch 的网络异常 / 超时翻译成用户能看懂的中文提示。 */
function netError(e: unknown): Error {
  if (e instanceof DOMException && e.name === 'AbortError') {
    return new Error('连接超时，请检查网络或后端地址后重试')
  }
  if (e instanceof TypeError) {
    return new Error('网络连接失败，请检查网络后重试')
  }
  return e instanceof Error ? e : new Error('网络异常，请稍后重试')
}

export async function signIn(email: string, password: string, remember = true): Promise<Session> {
  const { authBase, key } = authBaseNow()
  if (!authBase || !key) throw new Error('未配置数据源地址（云端或自建库）')
  let res: Response
  try {
    res = await timedFetch(`${authBase}/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  } catch (e) {
    throw netError(e)
  }
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

export interface SignUpResult {
  /** Supabase 开了邮箱验证时为 true：用户还没真正登录，需先去邮箱点验证链接 */
  needsConfirmation: boolean
  email: string
}

/**
 * 公开注册（GoTrue /signup）。与登录共用 timedFetch + netError。
 * 成功后：
 *   - 若项目开了「Confirm email」→ 返回 needsConfirmation=true，且当天拿不到会话，
 *     必须去邮箱点验证链接后才能登录；
 *   - 若未开邮箱验证 → 直接带着会话回来（本系统默认开启验证，走第一种）。
 * 邮箱已存在 → Supabase 返回 422 / 400，按已有账号提示。
 */
export async function signUp(email: string, password: string): Promise<SignUpResult> {
  const { authBase, key } = authBaseNow()
  if (!authBase || !key) throw new Error('未配置数据源地址（云端或自建库）')
  let res: Response
  try {
    res = await timedFetch(`${authBase}/signup`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, gotrue_meta_security: { captcha_token: null } }),
    })
  } catch (e) {
    throw netError(e)
  }
  const b = (await res.json().catch(() => ({}))) as TokenResp & {
    confirmation_sent_at?: string
    email_confirmed_at?: string
  }
  if (!res.ok) {
    const raw = b.error_description || b.msg || b.error || ''
    if (res.status === 422 || res.status === 400) {
      if (raw.toLowerCase().includes('already') || raw.includes('registered') || raw.includes('exists'))
        throw new Error('该邮箱已注册，请直接登录')
      if (raw.includes('password')) throw new Error('密码强度不足（至少 6 位）')
      throw new Error(raw || '注册失败，请稍后重试')
    }
    throw new Error(pickError(b, res.status))
  }
  const confirmed = Boolean(b.email_confirmed_at)
  return {
    needsConfirmation: !confirmed && Boolean(b.confirmation_sent_at),
    email: b.user?.email || email,
  }
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

/* ---------------- 律师个人资料（存 GoTrue user_metadata，按账号天然隔离） ---------------- */

export interface LawyerProfile {
  lawyer_name: string
  firm_name: string
}

function mdToProfile(md: Record<string, unknown> | null | undefined): LawyerProfile {
  return {
    lawyer_name: typeof md?.lawyer_name === 'string' ? md.lawyer_name : '',
    firm_name: typeof md?.firm_name === 'string' ? md.firm_name : '',
  }
}

/** 读取当前登录律师的资料（GET /auth/v1/user → user_metadata）。未登录/网络异常返回 null */
export async function fetchProfile(): Promise<LawyerProfile | null> {
  const token = await getAccessToken()
  if (!token || !AUTH_BASE || !ANON_KEY) return null
  try {
    const res = await fetch(`${AUTH_BASE}/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const u = (await res.json().catch(() => null)) as { user_metadata?: Record<string, unknown> } | null
    return mdToProfile(u?.user_metadata)
  } catch {
    return null
  }
}

/**
 * 保存律师姓名 / 律所名（PUT /auth/v1/user 的 data 字段 → user_metadata）。
 * 每个律师填自己的，互不可见互不影响；与 changePassword 走同一个端点。
 */
export async function saveProfileRemote(p: LawyerProfile): Promise<{ ok: boolean; error?: string }> {
  const token = await getAccessToken()
  if (!token || !AUTH_BASE || !ANON_KEY) return { ok: false, error: '未登录或尚未接入云端' }
  try {
    const res = await fetch(`${AUTH_BASE}/user`, {
      method: 'PUT',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { lawyer_name: p.lawyer_name.trim(), firm_name: p.firm_name.trim() } }),
    })
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as TokenResp & { message?: string }
      const raw = b.error_description || b.msg || b.message || b.error || ''
      return { ok: false, error: raw || `保存失败（HTTP ${res.status}）` }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: '网络异常，请稍后重试' }
  }
}

/**
 * 发送密码找回邮件（GoTrue /recover）。
 * 收件人任意邮箱皆可（已配自定义 SMTP，不复受内置 SMTP 2 封/小时限制）。
 * 防邮箱枚举：GoTrue 即使邮箱不存在也返回 200，调用方一律按「已发送」处理，
 * 避免攻击者借此探查哪些邮箱已注册。
 */
export async function requestPasswordReset(email: string): Promise<{ ok: boolean; error?: string }> {
  const { authBase, key } = authBaseNow()
  if (!authBase || !key) return { ok: false, error: '未配置数据源地址（云端或自建库）' }
  try {
    const res = await timedFetch(`${authBase}/recover`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    })
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as TokenResp
      return { ok: false, error: b.error_description || b.msg || `发送失败（HTTP ${res.status}）` }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: '网络异常，请稍后重试' }
  }
}

/**
 * 消费邮箱确认 / 密码找回邮件点开后的回调会话。
 * GoTrue 校验 token 成功会 302 回 redirect_to（本系统设为 SPA 根 `/`），
 * 并把会话塞进 URL fragment（hash），形如：
 *   #access_token=...&token_type=bearer&expires_in=3600&refresh_token=...&type=recovery
 * 这里把会话取出写入本地（与登录同套存储），同时清掉 URL 上的 hash，
 * 避免刷新时重复消费一个已被用掉的 token。
 * @returns type（recovery / signup / email_signup / invitation / …），无会话则返回 null
 */
export function consumeUrlSession(): string | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash.replace(/^#/, '')
  const search = window.location.search.replace(/^\?/, '')
  const params = new URLSearchParams(hash || search)
  const access = params.get('access_token')
  if (!access) return null
  const refresh = params.get('refresh_token') ?? ''
  const expiresIn = Number(params.get('expires_in') || '3600') || 3600
  const s: Session = {
    access_token: access,
    refresh_token: refresh,
    expires_at: Date.now() + expiresIn * 1000,
    email: params.get('email') || '',
  }
  writeSession(s, true)
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  } catch {
    /* ignore */
  }
  return params.get('type') || ''
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
        res = await timedFetch(`${AUTH_BASE}/token?grant_type=refresh_token`, {
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
  const res = await timedFetch(input, { ...init, headers })
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
  /** 邮件回调带进来的会话类型（recovery / signup / email_signup …），无则 null */
  urlType: string | null
  /** ResetPassword 处理完后清空，让 Gate 落回登录门 */
  clearUrlType: () => void
  /** 当前登录律师的姓名/律所（来自 user_metadata，每个律师自己填写） */
  profile: LawyerProfile | null
  saveProfile: (p: LawyerProfile) => Promise<{ ok: boolean; error?: string }>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [urlType, setUrlType] = useState<string | null>(null)

  useEffect(() => {
    setOnExpired(() => setSession(null))
    // 先处理邮件回调（确认 / 找回）带进来的会话：GoTrue 把会话塞进 URL hash，
    // consumeUrlSession 取出写入本地并返回 type；后续由 Gate 据 type 决定
    // 显示「重置密码」页（recovery）还是自动登录进主界面（signup 确认）。
    let recovered: string | null = null
    try {
      recovered = consumeUrlSession()
    } catch {
      recovered = null
    }
    if (recovered) {
      setUrlType(recovered)
      setSession(readSession())
      setReady(true)
      return
    }
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

  const clearUrlType = useCallback(() => setUrlType(null), [])

  // 律师资料：随会话 token 变化自动加载（登录/续期/邮件回调后都会刷新）
  const [profile, setProfile] = useState<LawyerProfile | null>(null)
  const token = session?.access_token ?? null
  useEffect(() => {
    if (!token) {
      setProfile(null)
      return
    }
    let alive = true
    fetchProfile().then((p) => {
      if (alive) setProfile(p)
    })
    return () => {
      alive = false
    }
  }, [token])

  const saveProfile = useCallback(async (p: LawyerProfile) => {
    const r = await saveProfileRemote(p)
    if (r.ok) setProfile({ lawyer_name: p.lawyer_name.trim(), firm_name: p.firm_name.trim() })
    return r
  }, [])

  const value = useMemo<AuthState>(
    () => ({ ready, session, email: session?.email ?? '', login, logout, urlType, clearUrlType, profile, saveProfile }),
    [ready, session, login, logout, urlType, clearUrlType, profile, saveProfile],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return v
}

