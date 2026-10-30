import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import {
  canPrompt,
  initInstallPrompt,
  installDismissed,
  isIOS,
  isStandalone,
  onInstallPrompt,
  promptInstall,
  setInstallDismissed,
} from '../lib/installPwa'

/**
 * PWA 安装提示：
 * - 安卓：捕获 beforeinstallprompt，弹窗内点「安装」直接走系统安装流程。
 * - iOS：弹窗引导「分享 → 添加到主屏幕」。
 * - 已在独立窗口运行 / 已安装 / 已点过「不再提示」时不弹。
 * 首次在 main.tsx 里 initInstallPrompt() 注册监听。
 */
export function InstallPWA({ onRequestOpen }: { onRequestOpen?: (open: () => void) => void }) {
  const [open, setOpen] = useState(false)
  const [promptable, setPromptable] = useState(canPrompt())

  useEffect(() => {
    initInstallPrompt()
    const off = onInstallPrompt(() => setPromptable(canPrompt()))
    return off
  }, [])

  // 暴露手动打开入口给设置页
  useEffect(() => {
    onRequestOpen?.(() => setOpen(true))
  }, [onRequestOpen])

  // 首次自动弹出：已安装/独立运行/已关闭 则不弹；否则延迟 1.5s 出现，避免与首屏加载打架
  useEffect(() => {
    if (isStandalone() || installDismissed()) return
    // 非 iOS 且当前没有可触发的 prompt，说明浏览器不支持或已装，也别弹
    if (!isIOS() && !promptable) return
    const t = window.setTimeout(() => setOpen(true), 1500)
    return () => window.clearTimeout(t)
  }, [promptable])

  if (!open) return null

  const dismiss = (remember: boolean) => {
    if (remember) setInstallDismissed(true)
    setOpen(false)
  }

  const isIos = isIOS()

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return
        dismiss(false)
      }}
    >
      <div
        className="w-full sm:w-[360px] bg-white rounded-t-2xl sm:rounded-2xl p-5 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-brand/10 text-brand">
              <Icon name="device" className="w-5 h-5" />
            </span>
            <div>
              <div className="text-[15px] font-semibold text-ink">安装到手机</div>
              <div className="text-xs text-ink-3 mt-0.5">像 App 一样全屏使用工作台</div>
            </div>
          </div>
          <button
            onClick={() => dismiss(false)}
            className="w-8 h-8 flex items-center justify-center text-ink-3 hover:text-ink"
            title="关闭"
          >
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>

        {isIos ? (
          <div className="mt-4">
            <ol className="space-y-3 text-sm text-ink-2">
              <li className="flex items-start gap-2.5">
                <span className="shrink-0 w-5 h-5 rounded-full bg-canvas text-ink-2 text-xs flex items-center justify-center font-semibold">1</span>
                <span>点底部工具栏的 <span className="font-semibold text-ink">分享</span> 按钮</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="shrink-0 w-5 h-5 rounded-full bg-canvas text-ink-2 text-xs flex items-center justify-center font-semibold">2</span>
                <span>向上滑动菜单，选择 <span className="font-semibold text-ink">「添加到主屏幕」</span></span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="shrink-0 w-5 h-5 rounded-full bg-canvas text-ink-2 text-xs flex items-center justify-center font-semibold">3</span>
                <span>点右上角 <span className="font-semibold text-ink">「添加」</span>，即可从主屏幕图标进入</span>
              </li>
            </ol>
            <p className="mt-3 text-2xs text-ink-3 leading-relaxed">
              iOS 上的 Safari 不支持一键安装，需手动添加到主屏幕；添加后即可全屏、独立图标使用。
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-2 leading-relaxed">
            将「律师工作台」安装到手机桌面，之后从图标直接打开，无需每次进浏览器输入网址。
          </p>
        )}

        <div className="mt-5 flex items-center gap-2.5">
          {!isIos && promptable ? (
            <button
              onClick={async () => {
                const ok = await promptInstall()
                setPromptable(canPrompt())
                if (ok) setOpen(false)
              }}
              className="flex-1 h-10 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium transition-colors"
            >
              立即安装
            </button>
          ) : (
            <button
              onClick={() => dismiss(false)}
              className="flex-1 h-10 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium transition-colors"
            >
              我知道了
            </button>
          )}
          <button
            onClick={() => dismiss(true)}
            className="h-10 px-3 rounded-lg border border-line text-ink-3 text-sm hover:text-ink"
          >
            不再提示
          </button>
        </div>
      </div>
    </div>
  )
}
