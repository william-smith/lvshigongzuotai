import { useState } from 'react'
import { useVault } from '../store/vault'
import { Icon } from './Icon'

const DISMISS_KEY = 'lw.vault.setup.dismissed'

/**
 * 首次设置保险箱口令的引导横幅：云端已加载且 verifier 为空（从未设置过）时出现，
 * 提示用户敏感信息（手机号、伤情、费用金额等）当前被隐藏，并提供一个快捷入口。
 * 「稍后」只在本次会话隐藏，下次打开若仍未设置会再次出现。
 */
export function VaultSetupGuide() {
  const { needsSetup, requestUnlock } = useVault()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  if (!needsSetup || dismissed) return null

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
    setDismissed(true)
  }

  return (
    <div className="sticky top-0 z-30 flex items-center gap-3 px-4 py-2.5 bg-brand-soft border-b border-brand/15">
      <Icon name="lock" className="w-4 h-4 text-brand shrink-0" />
      <p className="flex-1 text-xs text-ink-2 leading-relaxed">
        敏感信息（手机号、伤情、<span className="text-ink font-medium">费用金额</span>等）已隐藏——你还没设置过保险箱口令。
        设置后这些内容才会在本机解密显示。
      </p>
      <button
        onClick={requestUnlock}
        className="shrink-0 h-8 px-3 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover"
      >
        设置口令
      </button>
      <button
        onClick={dismiss}
        aria-label="稍后"
        className="shrink-0 w-7 h-7 flex items-center justify-center text-ink-3 hover:text-ink-2"
      >
        <Icon name="close" className="w-4 h-4" />
      </button>
    </div>
  )
}
