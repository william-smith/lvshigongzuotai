import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { previewUrl, type FsFileHandle } from '../lib/fsAccess'
import { isImage } from '../lib/docCategory'

/**
 * 本地文件预览。
 *
 * 注意：这里的 objectURL 指向的是本机磁盘上的文件句柄，
 * 浏览器直接读本地文件渲染，文件内容不上传到任何服务器。
 */
export function DocPreview({
  name,
  handle,
  onClose,
}: {
  name: string
  handle: FsFileHandle | null
  onClose: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const current = useRef<string | null>(null)

  useEffect(() => {
    if (!handle) return
    let alive = true
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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex flex-col" onClick={onClose}>
      <div
        className="h-12 shrink-0 flex items-center gap-3 px-4 text-white/90"
        onClick={(e) => e.stopPropagation()}
      >
        <Icon name="file" className="w-4 h-4 shrink-0" />
        <span className="flex-1 min-w-0 text-sm truncate">{name}</span>
        <button onClick={onClose} className="w-9 h-9 flex items-center justify-center text-white/70" title="关闭">
          <Icon name="close" className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-2 md:p-6" onClick={onClose}>
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
      <div className="shrink-0 text-center text-[11px] text-white/35 pb-3">本机读取 · 不上传云端 · 按 Esc 关闭</div>
    </div>
  )
}
