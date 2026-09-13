import { useState } from 'react'
import { DEMO_PASSPHRASE, isCloud } from '../lib/data'
import { useVault } from '../store/vault'
import { Icon } from './Icon'

export function UnlockDialog() {
  const { unlockOpen, closeUnlock, unlock, busy, error, unlocked } = useVault()
  const [pw, setPw] = useState('')
  const [remember, setRemember] = useState(true)

  if (!unlockOpen || unlocked) return null

  const submit = async () => {
    if (!pw) return
    await unlock(pw, remember)
    setPw('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-pop p-6">
        <div className="flex items-center gap-3 mb-1">
          <span className="w-9 h-9 rounded-lg bg-brand-soft text-brand flex items-center justify-center">
            <Icon name="lock" className="w-4.5 h-4.5" />
          </span>
          <h2 className="text-base font-semibold text-ink">解锁敏感信息</h2>
        </div>
        <p className="text-xs text-ink-2 leading-relaxed mb-4">
          手机号、伤情、跟踪记录在你的设备上加密后才上传，服务器只有密文。
          输入主口令后在本机解密，口令不会离开这台设备。
        </p>

        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="主口令"
          className="w-full h-11 px-3 rounded-lg border border-line bg-white text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
        />

        {error && <p className="mt-2 text-xs text-danger">{error}</p>}

        <label className="flex items-center gap-2 mt-3 text-xs text-ink-2 select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="w-4 h-4 accent-[#1D4ED8]"
          />
          在这台设备记住 30 天（仅个人设备勾选）
        </label>

        {!isCloud && (
          <p className="mt-3 text-2xs text-ink-3 bg-canvas rounded-lg px-3 py-2 leading-relaxed">
            当前是本地演示数据，演示口令：<code className="text-ink-2 font-medium">{DEMO_PASSPHRASE}</code>
          </p>
        )}

        <div className="flex gap-2 mt-5">
          <button
            onClick={closeUnlock}
            className="flex-1 h-10 rounded-lg border border-line text-sm text-ink-2 hover:bg-canvas"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={busy || !pw}
            className="flex-1 h-10 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-50"
          >
            {busy ? '解锁中…' : '解锁'}
          </button>
        </div>
      </div>
    </div>
  )
}
