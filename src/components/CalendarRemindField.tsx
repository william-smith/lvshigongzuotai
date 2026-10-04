import { useState } from 'react'
import { isoDuration, humanizeDuration, type DurationUnit } from '../lib/ical'

/**
 * 受控的「到期提醒」编辑组件。
 * props.value 是 ISO8601 duration 数组（如 ["PT1H","P1D","PT90M"]），
 * 这里提供「数值 + 单位」的增删行 UI，并把已选项渲染成可删除的 chip。
 */
export function CalendarRemindField({
  value,
  onChange,
}: {
  value: string[]
  onChange: (v: string[]) => void
}) {
  const [num, setNum] = useState('')
  const [unit, setUnit] = useState<DurationUnit>('hours')

  function add() {
    const n = Number(num)
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return
    const iso = isoDuration(n, unit)
    if (value.includes(iso)) {
      setNum('')
      return
    }
    onChange([...value, iso])
    setNum('')
  }

  function remove(d: string) {
    onChange(value.filter((x) => x !== d))
  }

  const inputCls =
    'h-10 px-3 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand'

  return (
    <div className="space-y-2.5">
      <div className="flex gap-2 items-center">
        <input
          type="number"
          min={1}
          step={1}
          value={num}
          onChange={(e) => setNum(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder="数值"
          className={inputCls + ' w-24'}
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as DurationUnit)}
          className={inputCls + ' flex-1'}
        >
          <option value="minutes">分钟</option>
          <option value="hours">小时</option>
          <option value="days">天</option>
        </select>
        <button
          type="button"
          onClick={add}
          className="h-10 px-4 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium transition-colors"
        >
          添加
        </button>
      </div>

      {value.length === 0 ? (
        <p className="text-2xs text-ink-3">未设置提醒：到期当天不会主动推送（设了也会照常在日历里显示事件）。</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {value.map((d) => (
            <span
              key={d}
              className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-brand/10 text-brand text-xs"
            >
              {humanizeDuration(d)}
              <button
                type="button"
                onClick={() => remove(d)}
                className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-brand/20 text-brand/70"
                aria-label="删除提醒"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
