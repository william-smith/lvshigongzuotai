import { useState } from 'react'
import { Icon } from '../components/Icon'
import { useAuth } from '../lib/auth'

export function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState((import.meta.env.VITE_AUTH_EMAIL as string) || '')
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !pw) {
      setErr('请填写邮箱和密码')
      return
    }
    setBusy(true)
    setErr('')
    try {
      await login(email.trim(), pw, remember)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '登录失败')
    } finally {
      setBusy(false)
    }
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
          <p className="mt-1 text-xs text-ink-3">江苏维尔达律师事务所 · 案件管理与材料索引</p>
        </div>

        {/* 表单卡片 */}
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
        </form>

        {/* 安全说明 */}
        <div className="mt-5 flex items-start gap-2 px-1">
          <Icon name="shield" className="w-3.5 h-3.5 text-ink-3 mt-0.5 shrink-0" />
          <p className="text-[11px] text-ink-3 leading-relaxed">
            未登录时数据库一条记录都读不到。手机号与伤情在设备上加密后才上传，服务端只存密文。
          </p>
        </div>
        <p className="mt-3 text-center text-[11px] text-ink-3">
          忘记密码？登录后在「设置 → 修改密码」里重设，或在 Supabase 控制台重置。
        </p>
      </div>
    </div>
  )
}
