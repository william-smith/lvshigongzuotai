import { useState } from 'react'
import { Icon } from '../components/Icon'
import { useAuth, signUp, type SignUpResult } from '../lib/auth'

type Mode = 'login' | 'register'

export function Login() {
  const { login } = useAuth()
  const [mode, setMode] = useState<Mode>('login')

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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!email || !pw) {
      setErr('请填写邮箱和密码')
      return
    }
    setBusy(true)
    try {
      await login(email.trim(), pw, remember)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '登录失败')
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

  const switchMode = (m: Mode) => {
    setMode(m)
    setErr('')
    setDone(null)
    setPw('')
    setRpw('')
    setRpw2('')
  }

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-[380px]">
        {/* 品牌 */}
        <div className="flex flex-col items-center mb-7">
          <span className="w-12 h-12 rounded-xl bg-brand text-white flex items-center justify-center shadow-pop">
            <Icon name="scale" className="w-6 h-6" stroke={1.8} />
          </span>
          <h1 className="mt-4 text-[19px] font-semibold text-ink tracking-tight">律师工作台</h1>
          <p className="mt-1 text-xs text-ink-3">
            {mode === 'login' ? '登录以管理你的案件与材料' : '注册一个属于你自己的工作台'}
          </p>
        </div>

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
        ) : (
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
            忘记密码？登录后在「设置 → 修改密码」里重设，或在 Supabase 控制台重置。
          </p>
        )}
      </div>
    </div>
  )
}
