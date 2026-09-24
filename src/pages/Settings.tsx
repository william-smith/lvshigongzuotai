import { useState, type ReactNode } from 'react'
import { Icon, type IconName } from '../components/Icon'
import { authEnabled, changePassword, useAuth } from '../lib/auth'
import { isCloud } from '../lib/data'
import { deriveKey, persistKey, verifyKey } from '../lib/crypto'
import { reencryptVault } from '../lib/vault'

/** 设置页分组容器：统一的小标题 + 图标 + 描述，下面卡片堆叠 */
function Section({
  icon,
  title,
  desc,
  aside,
  children,
}: {
  icon: IconName
  title: string
  desc?: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mt-8 first:mt-1">
      <div className="flex items-center gap-2.5 px-1">
        <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-brand/10 text-brand">
          <Icon name={icon} className="w-4 h-4" />
        </span>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {desc ? (
        <p className="px-1 mt-1.5 mb-3 text-xs text-ink-3 leading-relaxed">{desc}</p>
      ) : (
        <div className="h-3" />
      )}
      <div className="space-y-4">{children}</div>
    </section>
  )
}

export function Settings() {
  const { email } = useAuth()
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)

  // —— 修改保险箱口令（敏感字段加密口令）——
  const [vOld, setVOld] = useState('')
  const [vNew, setVNew] = useState('')
  const [vConfirm, setVConfirm] = useState('')
  const [vShow, setVShow] = useState(false)
  const [vRemember, setVRemember] = useState(() => {
    try {
      return !!localStorage.getItem('lw.key.persist')
    } catch {
      return false
    }
  })
  const [vBusy, setVBusy] = useState(false)
  const [vErr, setVErr] = useState('')
  const [vOk, setVOk] = useState(false)
  const [vDone, setVDone] = useState(0)
  const [vTotal, setVTotal] = useState(0)

  const changeVault = async (e: React.FormEvent) => {
    e.preventDefault()
    setVErr('')
    setVOk(false)
    if (vNew.length < 6) {
      setVErr('新口令至少 6 位')
      return
    }
    if (vNew !== vConfirm) {
      setVErr('两次输入的新口令不一致')
      return
    }
    if (vOld === vNew) {
      setVErr('新口令不能与原口令相同')
      return
    }
    setVBusy(true)
    try {
      const oldKey = await deriveKey(vOld)
      const okOld = await verifyKey(oldKey)
      if (!okOld) {
        setVErr('原口令不正确')
        setVBusy(false)
        return
      }
      const newKey = await deriveKey(vNew)
      const res = await reencryptVault(oldKey, newKey, (p) => {
        setVDone(p.done)
        setVTotal(p.total)
      })
      if (res.failed > 0) {
        setVErr(
          `部分记录改密失败（成功 ${res.reencrypted} 条，失败 ${res.failed} 条）。请保持页面打开，再次点击「保存新口令」即可重试剩余记录。`,
        )
        setVBusy(false)
        return
      }
      // 持久化新密钥，随后重载让内存中的密文与云端一致
      await persistKey(newKey, vRemember)
      setVOk(true)
      setTimeout(() => window.location.reload(), 1200)
    } catch (e2) {
      setVErr((e2 as Error).message || '改密失败，请稍后重试')
      setVBusy(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setOk(false)
    if (pw.length < 6) {
      setErr('密码至少 6 位')
      return
    }
    if (pw !== confirm) {
      setErr('两次输入的密码不一致')
      return
    }
    setBusy(true)
    try {
      const r = await changePassword(pw)
      if (r.ok) {
        setOk(true)
        setPw('')
        setConfirm('')
      } else {
        setErr(r.error || '修改失败')
      }
    } catch {
      setErr('网络异常，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* 移动端顶栏 */}
      <div className="md:hidden sticky top-0 z-20 bg-white border-b border-line">
        <div className="h-12 flex items-center gap-2 px-2">
          <Icon name="settings" className="w-5 h-5 text-ink-2" />
          <span className="text-sm font-semibold text-ink">设置</span>
        </div>
      </div>

      <div className="max-w-[560px] mx-auto px-5 py-6 md:py-10">
        <h1 className="text-lg font-semibold text-ink">设置</h1>
        <p className="mt-1 text-xs text-ink-3">管理账户与加密设置。</p>

        {/* 账户 */}
        <Section
          icon="user"
          title="账户"
          aside={
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-canvas text-2xs text-ink-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {email || '未登录'}
            </span>
          }
        >
          {authEnabled ? (
            <form onSubmit={submit} className="rounded-xl border border-line bg-white p-5">
              <div className="text-sm font-semibold text-ink mb-1">修改登录密码</div>
              <p className="text-xs text-ink-3 mb-4">修改后，其他已登录的设备需要重新登录。</p>

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
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="再次输入新密码"
                className="w-full h-10 px-3 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
              />

              {err && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-danger/6 border border-danger/20 text-xs text-danger">{err}</div>
              )}
              {ok && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
                  密码已修改成功，下次登录请使用新密码。
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="mt-5 w-full h-10 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
              >
                {busy && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                {busy ? '正在保存…' : '保存新密码'}
              </button>
            </form>
          ) : (
            <div className="rounded-xl border border-line bg-white p-5">
              <div className="text-sm font-semibold text-ink mb-1">修改登录密码</div>
              <p className="text-xs text-ink-3 leading-relaxed">
                当前为本地演示模式，无需登录、没有密码可改。接入云端（Supabase）后即可在此修改登录密码。
              </p>
            </div>
          )}
        </Section>

        {/* 安全 */}
        <Section icon="lock" title="安全" desc="敏感字段加密口令与账号安全说明。">
          {isCloud ? (
            <form onSubmit={changeVault} className="rounded-xl border border-line bg-white p-5">
              <div className="flex items-center gap-2 mb-1">
                <Icon name="lock" className="w-4 h-4 text-ink-2" />
                <div className="text-sm font-semibold text-ink">修改保险箱口令</div>
              </div>
              <p className="text-xs text-ink-3 leading-relaxed mb-4">
                此口令用于加密案件里的手机号、伤情、跟踪记录等敏感字段。修改时会在本机用旧口令解密、再用新口令重新加密后写回，
                <span className="text-ink-2">口令与明文永远不会离开你的设备</span>。
              </p>

              <label className="block text-xs font-medium text-ink-2 mb-1.5">原口令</label>
              <input
                type={vShow ? 'text' : 'password'}
                autoComplete="current-password"
                value={vOld}
                onChange={(e) => setVOld(e.target.value)}
                placeholder="当前保险箱口令"
                className="w-full h-10 px-3 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
              />

              <label className="block text-xs font-medium text-ink-2 mt-4 mb-1.5">新口令</label>
              <div className="relative">
                <input
                  type={vShow ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={vNew}
                  onChange={(e) => setVNew(e.target.value)}
                  placeholder="至少 6 位"
                  className="w-full h-10 px-3 pr-10 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
                />
                <button
                  type="button"
                  onClick={() => setVShow((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-ink-3 hover:text-ink-2"
                  aria-label={vShow ? '隐藏口令' : '显示口令'}
                >
                  <Icon name={vShow ? 'eye-off' : 'eye'} className="w-4 h-4" />
                </button>
              </div>

              <label className="block text-xs font-medium text-ink-2 mt-4 mb-1.5">确认新口令</label>
              <input
                type={vShow ? 'text' : 'password'}
                autoComplete="new-password"
                value={vConfirm}
                onChange={(e) => setVConfirm(e.target.value)}
                placeholder="再次输入新口令"
                className="w-full h-10 px-3 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
              />

              <label className="flex items-center gap-2 mt-4 text-xs text-ink-2 select-none">
                <input
                  type="checkbox"
                  checked={vRemember}
                  onChange={(e) => setVRemember(e.target.checked)}
                  className="w-4 h-4 accent-[#1D4ED8]"
                />
                在这台设备记住 30 天（仅个人设备勾选）
              </label>

              {vErr && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-danger/6 border border-danger/20 text-xs text-danger leading-relaxed">
                  {vErr}
                </div>
              )}
              {vOk && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
                  口令已修改成功，正在重新载入…
                </div>
              )}

              {vTotal > 0 && vBusy && (
                <div className="mt-3">
                  <div className="h-1.5 rounded-full bg-canvas overflow-hidden">
                    <div
                      className="h-full bg-brand transition-all duration-200"
                      style={{ width: `${Math.round((vDone / vTotal) * 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 text-2xs text-ink-3">
                    正在重新加密第 {vDone}/{vTotal} 条…
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={vBusy}
                className="mt-5 w-full h-10 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
              >
                {vBusy && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                {vBusy ? '正在重新加密…' : '保存新口令'}
              </button>
            </form>
          ) : (
            <div className="rounded-xl border border-line bg-white p-5">
              <div className="text-sm font-semibold text-ink mb-1">修改保险箱口令</div>
              <p className="text-xs text-ink-3 leading-relaxed">
                当前为本地演示数据，没有保险箱口令，无需修改。接入云端（Supabase）后即可在此修改。
              </p>
            </div>
          )}

          <div className="px-1 flex items-start gap-2 text-ink-3">
            <Icon name="shield" className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <p className="text-[11px] leading-relaxed">
              登录密码只用于进入工作台（Supabase Auth）。案件里的手机号、伤情等敏感字段由本地保险库口令加密，与登录密码互不相干。
            </p>
          </div>
        </Section>
      </div>
    </div>
  )
}
