import { useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { useAuth, signUp, requestPasswordReset, type SignUpResult } from '../lib/auth'
import { activeBackend, customConfigured, setBackend, writeCustom } from '../lib/apiConfig'

type Mode = 'login' | 'register' | 'forgot'
type Source = 'cloud' | 'custom'

/** 组件挂载时生效的后端；登录成功后若与之不同（中途切换过数据源），再刷新一次数据层即可 */
const BOOT_BACKEND = activeBackend()

export function Login() {
  const { login } = useAuth()
  const [mode, setMode] = useState<Mode>('login')

  // ---- 数据源选择（登录前定源：先选源，再登录；源不通可在登录页直接换源）----
  const [source, setSource] = useState<Source>(() =>
    activeBackend() === 'custom' ? 'custom' : 'cloud',
  )
  const [nasBase, setNasBase] = useState('')

  /**
   * 密码框 DOM 引用——专治「密码管理器自动填充不触发 React onChange」。
   *
   * Bitwarden 等扩展是直接改 DOM 的 value，不派发能被 React 捕获的输入事件，
   * 于是输入框里肉眼可见一串 ●，但 state 里 pw 仍是空串，提交上去就是**空密码**
   * → 服务端回「邮箱或密码不对」，而用户确信自己没输错。提交前兜底读一次 DOM 即可。
   */
  const pwRef = useRef<HTMLInputElement | null>(null)
  /** 自建库地址/anon key 的 DOM 引用：同理，防止自动填充/粘贴后 state 为空导致「点保存没反应」 */
  const nasBaseRef = useRef<HTMLInputElement | null>(null)
  const nasKeyRef = useRef<HTMLInputElement | null>(null)
  const [nasKey, setNasKey] = useState('')
  const [cfgErr, setCfgErr] = useState('')
  /**
   * 自建库是否已配置 —— **必须是 state**。
   * 原先直接写 `const configured = customConfigured()`（每次渲染读 localStorage），
   * 于是 `writeCustom()` 写完 localStorage 后 React 并不知道它变了：
   * `setBackend/setSource` 改的是别的 state，而 configured 本身不是 state，
   * **组件不会重渲染** →「保存并使用自建库」点了没反应、配置表单不消失。
   * （用户手动切一次数据源触发重渲染后才「好了」，属假象。）
   */
  const [configured, setConfigured] = useState(() => customConfigured())
  // 选了自建库但本机还没填配置 → 先填配置再登录（避免「要配置才能登录、但要登录才能配置」死循环）
  const needNasCfg = source === 'custom' && !configured

  function switchSource(s: Source) {
    if (s === source) return
    // 切数据源时同步一次配置状态：配置可能在别处被写入/清除过
    setConfigured(customConfigured())
    // 自建库尚未配置：先展开配置表单，不刷新（还没生效的后端，切了也登不进去）
    if (s === 'custom' && !configured) {
      setSource('custom')
      return
    }
    // 不再整页刷新：登录请求按「当前生效后端」动态解析，登录成功后再刷一次数据层即可（见 submit）
    setBackend(s)
    setSource(s)
  }

  /** 保存自建库配置 → 切到自建库并刷新；之后登录请求即打到自建库 */
  function saveNasConfig(e: React.FormEvent) {
    e.preventDefault()
    // 兜底：自动填充/粘贴可能不触发 React onChange，state 为空而输入框看着已填。
    // 那种情况下若只判 state，会直接 return，用户看到的就是「点了没反应」。
    const effBase = (nasBase || nasBaseRef.current?.value || '').trim()
    const effKey = (nasKey || nasKeyRef.current?.value || '').trim()
    if (!effBase || !effKey) {
      setCfgErr('请填写自建库 REST 地址和 anon key')
      return
    }
    writeCustom({ base: effBase, key: effKey })
    setCfgErr('')
    // 关键：configured 是 state，必须显式更新，否则界面不会切到登录表单
    setConfigured(true)
    setBackend('custom')
    setSource('custom')
  }

  // 登录表单
  const [email, setEmail] = useState((import.meta.env.VITE_AUTH_EMAIL as string) || '')
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(true)

  // 注册表单
  const [rpw, setRpw] = useState('')
  const [rpw2, setRpw2] = useState('')

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<SignUpResult | null>(null)
  const [forgotSent, setForgotSent] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    // 兜底：密码管理器（Bitwarden 等）直接改 DOM、不触发 React onChange 时，
    // state 里的 pw 会是空的，而输入框看着已填。提交前按需从 DOM 取真实值。
    const domPw = pwRef.current?.value ?? ''
    const effPw = pw || domPw
    if (!email || !effPw) {
      setErr('请填写邮箱和密码')
      return
    }
    setBusy(true)
    try {
      await login(email.trim(), effPw, remember)
      // 登录成功：若本次登录的后端与挂载时不同（中途切换了数据源），刷新一次让数据层重解析；
      // 同一后端则无需刷新，直接进入，避免白屏。
      if (activeBackend() !== BOOT_BACKEND) window.location.reload()
    } catch (err: unknown) {
      setErr(err instanceof Error ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  const register = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    const mail = email.trim()
    if (!mail || !rpw) {
      setErr('请填写邮箱和密码')
      return
    }
    if (rpw.length < 6) {
      setErr('密码至少 6 位')
      return
    }
    if (rpw !== rpw2) {
      setErr('两次输入的密码不一致')
      return
    }
    setBusy(true)
    try {
      const r = await signUp(mail, rpw)
      setDone(r)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '注册失败')
    } finally {
      setBusy(false)
    }
  }

  const forgot = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    const mail = email.trim()
    if (!mail) {
      setErr('请填写邮箱')
      return
    }
    setBusy(true)
    try {
      const r = await requestPasswordReset(mail)
      if (!r.ok) {
        setErr(r.error || '发送失败，请稍后重试')
        return
      }
      setForgotSent(true)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '发送失败')
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (m: Mode) => {
    setMode(m)
    setErr('')
    setDone(null)
    setForgotSent(false)
    setPw('')
    setRpw('')
    setRpw2('')
  }

  const srcBtn = (active: boolean) =>
    `text-left rounded-lg border px-3 py-2.5 transition-colors ${
      active ? 'border-brand bg-brand/5' : 'border-line hover:bg-white'
    }`

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-[380px]">
        {/* 品牌 */}
        <div className="flex flex-col items-center mb-6">
          <span className="w-12 h-12 rounded-xl bg-brand text-white flex items-center justify-center shadow-pop">
            <Icon name="scale" className="w-6 h-6" stroke={1.8} />
          </span>
          <h1 className="mt-4 text-[19px] font-semibold text-ink tracking-tight">律师工作台</h1>
          <p className="mt-1 text-xs text-ink-3">选择数据源，登录以管理你的案件与材料</p>
        </div>

        {/* 数据源选择（两个来源分开；切换后登录请求即打到所选来源） */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button type="button" onClick={() => switchSource('cloud')} className={srcBtn(source === 'cloud')}>
            <div className="text-sm font-medium text-ink">云端公开库</div>
            <div className="text-2xs text-ink-3 mt-0.5">随处可访问 · 账号隔离</div>
          </button>
          <button type="button" onClick={() => switchSource('custom')} className={srcBtn(source === 'custom')}>
            <div className="text-sm font-medium text-ink">自建库（国内）</div>
            <div className="text-2xs text-ink-3 mt-0.5">纯国内 · 数据不出境</div>
          </button>
        </div>

        {needNasCfg ? (
          /* 自建库配置：只存本机浏览器，不上传；保存后切到自建库并刷新 */
          <form onSubmit={saveNasConfig} className="bg-white rounded-xl border border-line shadow-card p-6">
            <div className="text-sm font-semibold text-ink">配置自建库</div>
            <p className="text-xs text-ink-3 mt-1 mb-4 leading-relaxed">
              填写你自建 Supabase 的 REST 地址与 anon key。二者
              <strong className="text-ink-2">只保存在本机浏览器</strong>
              ，不会写入应用、也不会上传。
            </p>

            <label className="block text-xs font-medium text-ink-2 mb-1.5">自建库 REST 地址</label>
            <input
              ref={nasBaseRef}
              value={nasBase}
              onChange={(e) => setNasBase(e.target.value)}
              placeholder="https://你的反代域名/rest/v1"
              className="w-full h-10 px-3 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
            />

            <label className="block text-xs font-medium text-ink-2 mt-4 mb-1.5">自建库 anon key</label>
            <input
              ref={nasKeyRef}
              value={nasKey}
              onChange={(e) => setNasKey(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              className="w-full h-10 px-3 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
            />

            {cfgErr && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-danger/6 border border-danger/20 text-xs text-danger">
                {cfgErr}
              </div>
            )}

            <button
              type="submit"
              className="mt-5 w-full h-10 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium transition-colors"
            >
              保存并使用自建库
            </button>
            <button
              type="button"
              onClick={() => {
                setSource('cloud')
                setCfgErr('')
              }}
              className="mt-3 w-full text-center text-xs text-ink-3 hover:text-brand transition-colors"
            >
              改用云端公开库登录
            </button>
          </form>
        ) : (
          <>
            {/* 注册成功：等待邮箱验证 */}
            {done ? (
              <div className="bg-white rounded-xl border border-line shadow-card p-6">
                <div className="flex items-center gap-2 text-brand mb-2">
                  <Icon name="check" className="w-5 h-5" />
                  <span className="text-sm font-medium">注册成功，请验证邮箱</span>
                </div>
                <p className="text-xs text-ink-2 leading-relaxed">
                  我们已向 <span className="font-medium text-ink">{done.email}</span> 发送了一封验证邮件。
                  请点击邮件中的链接完成验证，然后回到这里登录。
                </p>
                <button
                  onClick={() => switchMode('login')}
                  className="mt-5 w-full h-10 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium transition-colors"
                >
                  去登录
                </button>
              </div>
            ) : mode === 'login' ? (
              <form onSubmit={submit} className="bg-white rounded-xl border border-line shadow-card p-6">
                <label className="block text-xs font-medium text-ink-2 mb-1.5">邮箱</label>
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full h-10 px-3 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
                />

                <label className="block text-xs font-medium text-ink-2 mt-4 mb-1.5">密码</label>
                <div className="relative">
                  <input
                    ref={pwRef}
                    type={show ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    placeholder="••••••••"
                    className="w-full h-10 px-3 pr-10 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-ink-3 hover:text-ink-2"
                    aria-label={show ? '隐藏密码' : '显示密码'}
                  >
                    <Icon name={show ? 'eye-off' : 'eye'} className="w-4 h-4" />
                  </button>
                </div>

                <label className="mt-3 flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="w-3.5 h-3.5 accent-brand"
                  />
                  <span className="text-xs text-ink-2">保持登录（换设备或清理浏览器后需重新登录）</span>
                </label>

                {err && (
                  <div className="mt-3 px-3 py-2 rounded-lg bg-danger/6 border border-danger/20 text-xs text-danger">
                    {err}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="mt-5 w-full h-10 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  {busy && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                  {busy ? '正在登录…' : '登录'}
                </button>

                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className="mt-3 w-full text-center text-xs text-ink-3 hover:text-brand transition-colors"
                >
                  还没有账号？免费注册一个
                </button>
              </form>
            ) : mode === 'register' ? (
              <form onSubmit={register} className="bg-white rounded-xl border border-line shadow-card p-6">
                <label className="block text-xs font-medium text-ink-2 mb-1.5">邮箱</label>
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full h-10 px-3 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
                />

                <label className="block text-xs font-medium text-ink-2 mt-4 mb-1.5">设置密码</label>
                <input
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={rpw}
                  onChange={(e) => setRpw(e.target.value)}
                  placeholder="至少 6 位"
                  className="w-full h-10 px-3 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
                />

                <label className="block text-xs font-medium text-ink-2 mt-4 mb-1.5">确认密码</label>
                <div className="relative">
                  <input
                    type={show ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={rpw2}
                    onChange={(e) => setRpw2(e.target.value)}
                    placeholder="再次输入密码"
                    className="w-full h-10 px-3 pr-10 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-ink-3 hover:text-ink-2"
                    aria-label={show ? '隐藏密码' : '显示密码'}
                  >
                    <Icon name={show ? 'eye-off' : 'eye'} className="w-4 h-4" />
                  </button>
                </div>

                {err && (
                  <div className="mt-3 px-3 py-2 rounded-lg bg-danger/6 border border-danger/20 text-xs text-danger">
                    {err}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="mt-5 w-full h-10 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  {busy && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                  {busy ? '正在注册…' : '注册'}
                </button>

                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="mt-3 w-full text-center text-xs text-ink-3 hover:text-brand transition-colors"
                >
                  已有账号？去登录
                </button>
              </form>
            ) : (
              <form onSubmit={forgot} className="bg-white rounded-xl border border-line shadow-card p-6">
                <label className="block text-xs font-medium text-ink-2 mb-1.5">邮箱</label>
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full h-10 px-3 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
                />

                {err && (
                  <div className="mt-3 px-3 py-2 rounded-lg bg-danger/6 border border-danger/20 text-xs text-danger">
                    {err}
                  </div>
                )}

                {forgotSent ? (
                  <div className="mt-4 flex items-start gap-2 px-3 py-3 rounded-lg bg-brand/6 border border-brand/20">
                    <Icon name="check" className="w-4 h-4 text-brand mt-0.5 shrink-0" />
                    <p className="text-xs text-ink-2 leading-relaxed">
                      如果该邮箱已注册，我们已发送一封含重置链接的邮件。请点击邮件中的链接设置新密码。
                    </p>
                  </div>
                ) : (
                  <button
                    type="submit"
                    disabled={busy}
                    className="mt-5 w-full h-10 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                  >
                    {busy && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                    {busy ? '正在发送…' : '发送重置邮件'}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="mt-3 w-full text-center text-xs text-ink-3 hover:text-brand transition-colors"
                >
                  返回登录
                </button>
              </form>
            )}

            {/* 安全说明 */}
            <div className="mt-5 flex items-start gap-2 px-1">
              <Icon name="shield" className="w-3.5 h-3.5 text-ink-3 mt-0.5 shrink-0" />
              <p className="text-[11px] text-ink-3 leading-relaxed">
                未登录时数据库一条记录都读不到。每位律师的数据相互独立；手机号与伤情在设备上加密后才上传，服务端只存密文。
              </p>
            </div>
            {mode === 'login' && (
              <p className="mt-3 text-center text-[11px] text-ink-3">
                忘记密码？
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="text-brand hover:underline ml-1"
                >
                  通过邮件重置
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
