import React, { useState, useEffect, useRef } from 'react'
import { Icon } from './Icon'

/**
 * 自定义日期/时间选择器，替代原生 date / datetime-local。
 * 原生弹层是系统组件、塞不进星期文字；这里用七列日历网格（日一二三四五六），
 * 挑选前即可看到星期，今天高亮、选中项标蓝。节点时间用内置「时/分」下拉代替
 * 原生 time 输入，避免手机端唤起系统滚轮与圆盘导致弹层异常退出。
 * 对外接口与原生 <input> 一致：接收 value + onChange(ChangeEvent)，可直接替换。
 */
const WK = ['日', '一', '二', '三', '四', '五', '六'] as const

function pad(n: number) {
  return n < 10 ? '0' + n : '' + n
}

function parse(v?: string | null): { y: number; m: number; d: number; hh: string; mm: string } | null {
  if (!v) return null
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/)
  if (!m) return null
  return { y: +m[1], m: +m[2], d: +m[3], hh: m[4] ?? '09', mm: m[5] ?? '00' }
}

function display(v: string, type: 'date' | 'datetime-local'): string {
  const p = parse(v)
  if (!p) return ''
  const wd = new Date(p.y, p.m - 1, p.d).getDay()
  const base = `${p.y}-${pad(p.m)}-${pad(p.d)} 星期${WK[wd]}`
  return type === 'datetime-local' ? `${base} ${p.hh}:${p.mm}` : base
}

/** 时/分滚动选择轮：滚动停止后吸附并写入，限制 0..max */
function TimeWheel({
  value,
  max,
  unit,
  onCommit,
}: {
  value: string
  max: number
  unit: string
  onCommit: (padded: string) => void
}) {
  const itemH = 36
  const visible = 5
  const height = itemH * visible
  const padH = (height - itemH) / 2
  const listRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number | null>(null)
  const [active, setActive] = useState(() => Math.max(0, Math.min(max, parseInt(value, 10) || 0)))

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = (parseInt(value, 10) || 0) * itemH
    setActive(Math.max(0, Math.min(max, parseInt(value, 10) || 0)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commit = () => {
    const el = listRef.current
    if (!el) return
    const idx = Math.max(0, Math.min(max, Math.round(el.scrollTop / itemH)))
    setActive(idx)
    onCommit(pad(idx))
  }

  const select = (i: number) => {
    const el = listRef.current
    const idx = Math.max(0, Math.min(max, i))
    if (el) el.scrollTo({ top: idx * itemH, behavior: 'smooth' })
    setActive(idx)
    onCommit(pad(idx))
  }

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    const idx = Math.max(0, Math.min(max, Math.round(el.scrollTop / itemH)))
    setActive(idx)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(commit, 150)
  }

  const items = Array.from({ length: max + 1 }, (_, i) => i)

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-16 rounded-xl border border-line bg-canvas overflow-hidden">
        <div
          className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-9 bg-brand/10 border-y border-brand/30 pointer-events-none"
          aria-hidden
        />
        <div
          ref={listRef}
          onScroll={onScroll}
          className="overflow-y-auto snap-y snap-mandatory relative [&::-webkit-scrollbar]:hidden"
          style={{ height, scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
        >
          <div style={{ height: padH }} />
          {items.map((i) => (
            <div
              key={i}
              onClick={() => select(i)}
              className={
                'snap-center flex items-center justify-center text-base tabular-nums cursor-pointer select-none ' +
                (i === active ? ' text-brand font-semibold' : ' text-ink-3')
              }
              style={{ height: itemH }}
            >
              {pad(i)}
            </div>
          ))}
          <div style={{ height: padH }} />
        </div>
      </div>
      <span className="text-xs text-ink-3 mt-1.5">{unit}</span>
    </div>
  )
}

export function DateInput({
  type,
  value,
  onChange,
  className = '',
  inputRef,
  wrapperClass = '',
}: {
  type: 'date' | 'datetime-local'
  value: string
  onChange: React.ChangeEventHandler<HTMLInputElement>
  className?: string
  /** 透传到内部 input 的 ref（如用于挂载自动聚焦） */
  inputRef?: React.Ref<HTMLInputElement>
  /** 外层容器额外类（如 flex-1 min-w-0，用于筛选区自适应宽度） */
  wrapperClass?: string
}) {
  const [open, setOpen] = useState(false)

  const init = parse(value) ?? (() => {
    const t = new Date()
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate(), hh: '09', mm: '00' }
  })()

  const [view, setView] = useState(new Date(init.y, init.m - 1, 1))
  const [sel, setSel] = useState(new Date(init.y, init.m - 1, init.d))
  const [time, setTime] = useState(`${init.hh}:${init.mm}`)

  function openPicker() {
    const p = parse(value)
    const base = p ? new Date(p.y, p.m - 1, p.d) : new Date()
    setView(new Date(base.getFullYear(), base.getMonth(), 1))
    setSel(base)
    setTime(p ? `${p.hh}:${p.mm}` : '09:00')
    setOpen(true)
  }

  function commit(day: Date, tm: string) {
    const v =
      type === 'datetime-local'
        ? `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T${tm}`
        : `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
    onChange({ target: { value: v } } as unknown as React.ChangeEvent<HTMLInputElement>)
    setOpen(false)
  }

  const year = view.getFullYear()
  const month = view.getMonth()
  const firstWd = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstWd; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const today = new Date()
  const selKey = `${sel.getFullYear()}-${sel.getMonth()}-${sel.getDate()}`
  const placeholder = type === 'datetime-local' ? '选择日期与时间' : '选择日期'

  const [hh, mm] = time.split(':')

  return (
    <div className={'relative w-full ' + wrapperClass}>
      <input
        ref={inputRef}
        type="text"
        readOnly
        value={display(value, type)}
        placeholder={placeholder}
        onClick={openPicker}
        className={(className + ' cursor-pointer !pr-10').trim()}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none">
        <Icon name={type === 'datetime-local' ? 'clock' : 'calendar'} className="w-4 h-4" />
      </span>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <div
            className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-4 space-y-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setView(new Date(year, month - 1, 1))}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-2 hover:bg-canvas text-lg"
                aria-label="上个月"
              >
                ‹
              </button>
              <div className="text-sm font-medium">
                {year} 年 {month + 1} 月
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setView(new Date(year, month + 1, 1))}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-2 hover:bg-canvas text-lg"
                  aria-label="下个月"
                >
                  ›
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-2 hover:bg-canvas text-lg"
                  aria-label="关闭"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 text-center text-2xs text-ink-3">
              {WK.map((w) => (
                <div key={w} className="py-1">
                  {w}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {cells.map((d, i) => {
                if (d == null) return <div key={'b' + i} />
                const dayDate = new Date(year, month, d)
                const isToday =
                  dayDate.getFullYear() === today.getFullYear() &&
                  dayDate.getMonth() === today.getMonth() &&
                  dayDate.getDate() === today.getDate()
                const isSel = `${year}-${month}-${d}` === selKey
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      const nd = new Date(year, month, d)
                      setSel(nd)
                      if (type === 'date') commit(nd, time)
                    }}
                    className={[
                      'h-9 rounded-lg text-sm flex items-center justify-center',
                      isSel
                        ? 'bg-brand text-white font-medium'
                        : isToday
                          ? 'bg-brand/10 text-brand'
                          : 'text-ink hover:bg-canvas',
                    ].join(' ')}
                  >
                    {d}
                  </button>
                )
              })}
            </div>

            {type === 'datetime-local' && (
              <div className="flex items-center gap-5 pt-2 border-t border-line">
                <span className="text-xs text-ink-2 shrink-0">时间</span>
                <TimeWheel value={hh} max={23} unit="时" onCommit={(p) => setTime(p + ':' + mm)} />
                <TimeWheel value={mm} max={59} unit="分" onCommit={(p) => setTime(hh + ':' + p)} />
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  onChange({ target: { value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>)
                  setOpen(false)
                }}
                className="h-9 px-3 rounded-lg border border-line text-sm text-ink-2"
              >
                清除
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-9 px-3 rounded-lg border border-line text-sm text-ink-2"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => commit(sel, time)}
                className="h-9 px-4 rounded-lg bg-brand text-white text-sm font-medium"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
