import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

export type SortDir = 'asc' | 'desc'

export interface SortOption<K extends string> {
  key: K
  label: string
  /** 首次点该字段时用的方向（日期类一般 asc=最近/最紧急在前） */
  defaultDir?: SortDir
}

/** 点同一字段切升降序，点别的字段切字段并用它的默认方向 */
export function nextSort<K extends string>(
  key: K,
  cur: K,
  dir: SortDir,
  defaultDir: SortDir = 'asc',
): { key: K; dir: SortDir } {
  if (key === cur) return { key, dir: dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: defaultDir }
}

export function SortMenu<K extends string>({
  value,
  dir,
  options,
  onChange,
}: {
  value: K
  dir: SortDir
  options: SortOption<K>[]
  onChange: (key: K, dir: SortDir) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const cur = options.find((o) => o.key === value)
  const arrow = dir === 'asc' ? '↑' : '↓'

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`排序方式：${cur?.label ?? '默认顺序'} ${dir === 'asc' ? '升序' : '降序'}`}
        className="h-8 px-2.5 rounded-lg text-xs border bg-white text-ink-2 border-line hover:border-ink-3 flex items-center gap-1.5"
      >
        <span className="text-ink-3">排序</span>
        <span className="font-medium text-ink">{cur?.label ?? '默认'}</span>
        <span className="text-brand">{arrow}</span>
        <Icon name="chevron" className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-40 rounded-xl border border-line bg-white shadow-pop py-1 overflow-hidden">
          {options.map((o) => {
            const active = o.key === value
            return (
              <button
                key={o.key}
                onClick={() => {
                  onChange(o.key, active ? (dir === 'asc' ? 'desc' : 'asc') : o.defaultDir ?? 'asc')
                  setOpen(false)
                }}
                className={`w-full flex items-center gap-2 px-3 h-9 text-xs ${
                  active ? 'text-brand bg-brand-soft font-medium' : 'text-ink-2 hover:bg-canvas'
                }`}
              >
                <span className="flex-1 text-left">{o.label}</span>
                {active && <span>{arrow}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** 可点击排序的表头 */
export function SortableTh<K extends string>({
  label,
  sortKey,
  value,
  dir,
  onSort,
  className = '',
}: {
  label: string
  sortKey: K
  value: K
  dir: SortDir
  onSort: (key: K) => void
  className?: string
}) {
  const active = value === sortKey
  return (
    <th className={className}>
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 select-none ${
          active ? 'text-ink font-semibold' : 'hover:text-ink'
        }`}
      >
        {label}
        <span className={`text-[10px] ${active ? 'text-brand' : 'text-ink-3/50'}`}>
          {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  )
}
