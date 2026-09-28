import { useState } from 'react'
import { Icon } from '../components/Icon'
import { changePassword, useAuth } from '../lib/auth'

/**
 * 密码找回落地页：邮件链接点开后，GoTrue 把会话塞进 URL hash，
 * AuthProvider 已在挂载时通过 consumeUrlSession 取出并写入本地（此时已持有一个 recovery 会话）。
 * 本页只负责收集新密码，调用 changePassword（内部用该会话的 access_token 打 PUT /auth/v1/user）。
 * 成功后登出 recovery 会话并提示去登录，避免带着一次性会话滞留主界面。
 */
export function ResetPassword({ onDone }: { onDone: () => void }) {
  const { logout } = useAuth()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (pw.length < 6) {
      setErr('密码至少 6 位')
      return
    }
    if (pw !== pw2) {
      setErr('两次输入的密码不一致')
      return
    }
    setBusy(true)
    try {
      const r = await changePassword(pw)
      if (!r.ok) {
        setErr(r.error || '重置失败，请重试')
        return
      }
      await logout()
      setDone(true)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '重置失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-[380px]">
        <div className="flex flex-col items-center mb-7">
          <span className="w-12 h-12 rounded-xl bg-brand text-white flex items-center justify-center shadow-pop">
            <Icon name="scale" className="w-6 h-6" stroke={1.8} />
          </span>
          <h1 className="mt-4 text-[19px] font-semibold text-ink tracking-tight">重置密码</h1>
          <p className="mt-1 text-xs text-ink-3">设置一个新密码以继续</p>
        </div>

        {done ? (
          <div className="bg-white rounded-xl border border-line shadow-card p-6 text-center">
            <div className="flex items-center justify-center gap-2 text-brand mb-2">
              <Icon name="check" className="w-5 h-5" />
              <span className="text-sm font-medium">密码已重置</span>
            </div>
            <p className="text-xs text-ink-2 leading-relaxed">你的密码已更新，请使用新密码登录。</p>
            <button
              onClick={onDone}
              className="mt-5 w-full h-10 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium transition-colors"
            >
              去登录
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-white rounded-xl border border-line shadow-card p-6">
            <label className="block text-xs font-medium text-ink-2 mb-1.5">新密码</label>
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="至少 6 位"
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

            <label className="block text-xs font-medium text-ink-2 mt-4 mb-1.5">确认新密码</label>
            <input
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              placeholder="再次输入密码"
              className="w-full h-10 px-3 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
            />

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
              {busy ? '正在重置…' : '重置密码'}
            </button>

            <button
              type="button"
              onClick={onDone}
              className="mt-3 w-full text-center text-xs text-ink-3 hover:text-brand transition-colors"
            >
              返回登录
            </button>
          </form>
        )}

        <div className="mt-5 flex items-start gap-2 px-1">
          <Icon name="shield" className="w-3.5 h-3.5 text-ink-3 mt-0.5 shrink-0" />
          <p className="text-[11px] text-ink-3 leading-relaxed">
            密码仅在你的设备上参与校验，服务端只保存加盐哈希。重置后其他设备的会话会立即失效。
          </p>
        </div>
      </div>
    </div>
  )
}
