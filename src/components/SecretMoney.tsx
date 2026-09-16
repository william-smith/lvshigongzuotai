import { createContext, useContext, useState, type ReactNode } from 'react'
import { useVault } from '../store/vault'
import { fmtMoney } from '../lib/types'
import { Icon } from './Icon'

interface AmountVis {
  /** 金额当前是否可见：保险箱已解锁 且 本会话未手动隐藏 */
  visible: boolean
  /** 一键隐藏 / 重新显示（仅控制本会话显隐，不动保险箱解锁状态） */
  toggle: () => void
}
const Ctx = createContext<AmountVis | null>(null)

/**
 * 金额可见性（仅界面遮罩，route B）。
 * - 受保险箱解锁状态 gate：未解锁时所有金额一律遮罩，需输入主口令才可见；
 * - 额外提供「本会话一键隐藏」开关，客户坐到对面时点一下即可遮住，不必退出登录。
 * 金额数据本身不上加密，仍在内存中正常参与筛选 / 排序 / 统计。
 */
export function AmountPrivacyProvider({ children }: { children: ReactNode }) {
  const { unlocked } = useVault()
  const [hidden, setHidden] = useState(false)
  const visible = unlocked && !hidden
  return (
    <Ctx.Provider value={{ visible, toggle: () => setHidden((h) => !h) }}>{children}</Ctx.Provider>
  )
}

/** 取金额可见状态；若 provider 未挂载，安全兜底为「可见」 */
export function useAmountVisible(): AmountVis {
  return useContext(Ctx) ?? { visible: true, toggle: () => {} }
}

/**
 * 敏感金额展示：未解锁 / 已隐藏时显示 `¥ ••••`。
 * - 保险箱未解锁：点击弹出解锁框（输入主口令）
 * - 已解锁但被本会话隐藏：点击即重新显示（与顶栏眼睛按钮同效）
 * `interactive=false` 时渲染为 <span>（点击 stopPropagation），用于嵌套在 <button> 卡片内避免非法结构。
 */
export function SecretMoney({
  value,
  className = '',
  interactive = true,
}: {
  value: number | null | undefined
  className?: string
  interactive?: boolean
}) {
  const { unlocked, requestUnlock } = useVault()
  const { visible, toggle } = useAmountVisible()

  if (visible) {
    return <span className={className}>{fmtMoney(value)}</span>
  }

  const reveal = (e?: { stopPropagation: () => void }) => {
    e?.stopPropagation()
    if (unlocked) toggle()
    else requestUnlock()
  }

  if (!interactive) {
    return (
      <span
        role="button"
        onClick={reveal}
        title={unlocked ? '点击显示金额' : '解锁保险箱以查看金额'}
        className={`inline-flex items-center gap-1 ${className}`}
      >
        <span className="tabular-nums">¥ ••••</span>
        {!unlocked && <Icon name="lock" className="w-3 h-3 text-warn" />}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={reveal}
      title={unlocked ? '点击显示金额' : '解锁保险箱以查看金额'}
      className={`inline-flex items-center gap-1 ${className}`}
    >
      <span className="tabular-nums">¥ ••••</span>
      {!unlocked && <Icon name="lock" className="w-3 h-3 text-warn" />}
    </button>
  )
}
