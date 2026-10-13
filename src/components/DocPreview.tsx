import { useEffect, useRef, useState, type TouchEvent } from 'react'
import { Icon } from './Icon'
import { previewUrl, type FsFileHandle } from '../lib/fsAccess'
import { isImage } from '../lib/docCategory'

/**
 * 本地文件预览（支持翻页）。
 *
 * 注意：这里的 objectURL 指向的是本机磁盘上的文件句柄，
 * 浏览器直接读本地文件渲染，文件内容不上传到任何服务器。
 *
 * 翻页：传入 onPrev/onNext 时启用 —— 键盘 ←/→、屏幕两侧箭头按钮、手机左右滑动均可切换；
 * 不传（单文件或已到尽头）则隐藏对应方向，行为与旧版一致。
 */
export function DocPreview({
  name,
  handle,
  position,
  onPrev,
  onNext,
  onClose,
}: {
  name: string
  handle: FsFileHandle | null
  /** 形如 "3 / 92" 的位置计数；有翻页上下文时显示在标题栏 */
  position?: string
  onPrev?: () => void
  onNext?: () => void
  onClose: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const current = useRef<string | null>(null)
  // 手机滑动：记录触摸起点 X
  const touchX = useRef<number | null>(null)

  useEffect(() => {
    if (!handle) return
    let alive = true
    setUrl(null) // 切换文件时先清旧图，读取期间显示「正在读取…」
    setErr('')
    previewUrl(handle)
      .then((u) => {
        if (!alive) {
          URL.revokeObjectURL(u)
          return
        }
        current.current = u
        setUrl(u)
      })
      .catch((e: Error) => alive && setErr(e.message || '读取失败'))
    return () => {
      alive = false
      if (current.current) URL.revokeObjectURL(current.current)
      current.current = null
    }
  }, [handle])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onPrev?.()
      else if (e.key === 'ArrowRight') onNext?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])

  // 左右滑动切换（仅在传入了翻页回调时启用）
  const swipeProps =
    onPrev || onNext
      ? {
          onTouchStart: (e: TouchEvent<HTMLDivElement>) => {
            touchX.current = e.touches[0].clientX
          },
          onTouchEnd: (e: TouchEvent<HTMLDivElement>) => {
            if (touchX.current == null) return
            const dx = e.changedTouches[0].clientX - touchX.current
            touchX.current = null
            if (Math.abs(dx) < 50) return
            if (dx < 0) onNext?.()
            else onPrev?.()
          },
        }
      : {}

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex flex-col" onClick={onClose}>
      <div
        className="h-12 shrink-0 flex items-center gap-3 px-4 text-white/90"
        onClick={(e) => e.stopPropagation()}
      >
        <Icon name="file" className="w-4 h-4 shrink-0" />
        <span className="flex-1 min-w-0 text-sm truncate">{name}</span>
        {position && <span className="text-xs text-white/50 tabular-nums shrink-0">{position}</span>}
        <button onClick={onClose} className="w-9 h-9 flex items-center justify-center text-white/70" title="关闭">
          <Icon name="close" className="w-5 h-5" />
        </button>
      </div>
      <div
        className="relative flex-1 min-h-0 flex items-center justify-center p-2 md:p-6"
        onClick={onClose}
        {...swipeProps}
      >
        {onPrev && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onPrev()
            }}
            className="absolute left-1 md:left-3 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 text-white/90 flex items-center justify-center transition-colors"
            title="上一个 (←)"
          >
            <Icon name="chevron" className="w-6 h-6 rotate-180" />
          </button>
        )}
        {onNext && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onNext()
            }}
            className="absolute right-1 md:right-3 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 text-white/90 flex items-center justify-center transition-colors"
            title="下一个 (→)"
          >
            <Icon name="chevron" className="w-6 h-6" />
          </button>
        )}
        {err ? (
          <div className="text-sm text-red-300">{err}</div>
        ) : !url ? (
          <div className="text-sm text-white/50">正在读取…</div>
        ) : isImage(name) ? (
          <img
            src={url}
            alt={name}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full object-contain rounded"
          />
        ) : (
          <iframe
            src={url}
            title={name}
            onClick={(e) => e.stopPropagation()}
            className="w-full h-full bg-white rounded"
          />
        )}
      </div>
      <div className="shrink-0 text-center text-[11px] text-white/35 pb-3">
        {position ? '本机读取 · 不上传云端 · ←/→ 或左右滑动翻页 · Esc 关闭' : '本机读取 · 不上传云端 · 按 Esc 关闭'}
      </div>
    </div>
  )
}
