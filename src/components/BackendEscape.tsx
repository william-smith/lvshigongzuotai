import { activeBackend, customConfigured, setBackend } from '../lib/apiConfig'

/**
 * 数据源「逃生口」：当前数据源登录不了 / 加载不了时，切到另一个数据源。
 *
 * 为什么需要（**两个方向都会死锁**）：
 *   - 自建库(NAS)不可达 → 登录请求打向 NAS，登录页卡住；
 *   - 云端库不可达 → 登录请求打向云端，登录页同样卡住。
 * 而「数据源」切换入口在设置页，必须登录/加载成功才进得去 → 死锁。
 * 所以把「切到另一个数据源」放到**登录前就能看到**的位置。
 *
 * 可切条件：
 *   - 切到云端：云端地址编译进包，任何时候都可用；
 *   - 切到自建库：需已填写过自建库地址 + 密钥（customConfigured）。
 *
 * 点击后 setBackend + 整页刷新，让各数据模块在顶层重新解析生效后端。
 */
export function BackendEscape({ className = '' }: { className?: string }) {
  const onCustom = activeBackend() === 'custom'
  // 两个方向各可切一次（任一时刻只会命中一个按钮）
  const canGoCloud = onCustom
  const canGoCustom = !onCustom && customConfigured()
  if (!canGoCloud && !canGoCustom) return null

  const target = canGoCloud ? 'cloud' : 'custom'
  const label = canGoCloud ? '切换到云端公开库' : '改用自建库（国内）登录'

  return (
    <div className={`rounded-lg border border-line bg-white px-3 py-2.5 text-left ${className}`}>
      <p className="text-2xs text-ink-3 leading-relaxed">
        当前使用
        <strong className="text-ink-2">{onCustom ? '自建库（国内）' : '云端公开库'}</strong>
        。若它无法访问，可切换到另一个数据源继续登录使用。
      </p>
      <button
        type="button"
        onClick={() => {
          setBackend(target)
          window.location.reload()
        }}
        className="mt-2 w-full h-9 rounded-lg border border-line text-xs text-ink-2 hover:bg-canvas transition-colors"
      >
        {label}
      </button>
    </div>
  )
}
