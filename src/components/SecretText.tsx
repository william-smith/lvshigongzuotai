import { useEffect, useState } from 'react'
import { decryptString, splitPhones } from '../lib/crypto'
import { useVault } from '../store/vault'
import { Icon } from './Icon'

interface Props {
  /** 脱敏后的明文，未解锁时展示 */
  mask?: string | null
  /** 原文密文 v1:iv:ct */
  enc?: string | null
  className?: string
  /** 解锁后是否把手机号渲染成可拨号链接 */
  linkPhone?: boolean
}

/**
 * 敏感文本：未解锁显示脱敏版 + 解锁入口；解锁后本地解密显示原文。
 * 解密全在浏览器完成，密文只在解锁瞬间被读取。
 */
export function SecretText({ mask, enc, className = '', linkPhone = false }: Props) {
  const { key, unlocked, requestUnlock, forceReauth } = useVault()
  const [plain, setPlain] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    setPlain(null)
    setErr('')
    // 重新解锁后恢复显示（跟右上角锁图标同步：解锁即出原文、加锁即隐藏）
    setHidden(false)
    if (!unlocked || !key || !enc) return
    decryptString(key, enc)
      .then((t) => alive && setPlain(t))
      .catch(() => alive && setErr('解密失败：口令可能已更换'))
    return () => {
      alive = false
    }
  }, [unlocked, key, enc])

  if (!enc) return <span className={className}>{mask || '—'}</span>

  if (!unlocked) {
    return (
      <span className={`inline-flex items-center gap-2 flex-wrap ${className}`}>
        <span className="text-ink-2">{mask || '（内容已加密）'}</span>
        <button
          onClick={requestUnlock}
          className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded border border-line text-warn hover:bg-[#FFFAEB] shrink-0"
        >
          <Icon name="lock" className="w-3 h-3" />
          解锁查看
        </button>
      </span>
    )
  }

  if (err)
    return (
      <span className={`inline-flex items-center gap-2 flex-wrap ${className}`}>
        <span className="text-danger text-2xs">解密失败：口令可能已更换</span>
        <button
          onClick={forceReauth}
          className="text-2xs px-2 py-0.5 rounded border border-line text-brand hover:bg-brand-soft shrink-0"
        >
          重新输入口令
        </button>
      </span>
    )
  if (!plain) return <span className={className}>{mask || '解密中…'}</span>

  // 已解锁：默认显示原文；hidden 为单字段临时隐藏（不影响保险箱解锁状态）
  if (hidden) {
    return (
      <span className={`inline-flex items-center gap-2 flex-wrap ${className}`}>
        <span className="text-ink-2">{mask || '（已加密）'}</span>
        <button
          onClick={() => setHidden(false)}
          className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded border border-line text-brand hover:bg-brand-soft shrink-0"
        >
          <Icon name="unlock" className="w-3 h-3" />
          显示
        </button>
      </span>
    )
  }

  const body = linkPhone ? (
    <>
      {splitPhones(plain).map((seg, i) =>
        seg.phone ? (
          <a
            key={i}
            href={`tel:${seg.phone}`}
            className="text-brand underline decoration-dotted inline-flex items-center gap-0.5"
          >
            <Icon name="phone" className="w-3 h-3" />
            {seg.text}
          </a>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  ) : (
    plain
  )

  return (
    <span className={`inline-flex items-start gap-2 flex-wrap ${className}`}>
      <span>{body}</span>
      <button onClick={() => setHidden(true)} className="text-2xs text-ink-3 hover:text-ink-2 shrink-0">
        隐藏
      </button>
    </span>
  )
}

/** 单个手机号：解锁后可直接拨号 */
export function SecretPhone({ enc, mask }: { enc?: string | null; mask: string }) {
  const { key, unlocked, requestUnlock } = useVault()
  const [plain, setPlain] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let alive = true
    setHidden(false)
    if (!unlocked || !key || !enc) return
    decryptString(key, enc)
      .then((t) => alive && setPlain(t))
      .catch(() => alive && setPlain(null))
    return () => {
      alive = false
    }
  }, [unlocked, key, enc])

  if (!unlocked) {
    return (
      <button onClick={requestUnlock} className="inline-flex items-center gap-1 text-2xs text-warn">
        <Icon name="lock" className="w-3 h-3" />
        {mask}
      </button>
    )
  }
  if (hidden) {
    return (
      <button onClick={() => setHidden(false)} className="inline-flex items-center gap-1 text-2xs text-brand">
        <Icon name="unlock" className="w-3 h-3" />
        {mask}
      </button>
    )
  }
  if (plain) {
    return (
      <span className="inline-flex items-center gap-1">
        <a href={`tel:${plain}`} className="text-brand inline-flex items-center gap-1 font-medium">
          <Icon name="phone" className="w-3 h-3" />
          {plain}
        </a>
        <button onClick={() => setHidden(true)} className="text-2xs text-ink-3">
          隐藏
        </button>
      </span>
    )
  }
  return <span className="text-ink-2">{mask || '（已加密）'}</span>
}
