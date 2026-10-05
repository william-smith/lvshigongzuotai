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
    'h-9 px-3 rounded-lg border border-line bg-white text-sm outline-none focus:border-brand'

  return (
    <div className="space-y-2">
      {/* 窄屏堆叠、宽屏并排：数值固定窄，单位与按钮均分，避免按钮比例失衡 */}
      <div className="flex gap-2">
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
          aria-label="提醒数值"
          className={inputCls + ' w-16 shrink-0'}
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as DurationUnit)}
          aria-label="提醒单位"
          className={inputCls + ' w-20 shrink-0'}
        >
          <option value="minutes">分钟</option>
          <option value="hours">小时</option>
          <option value="days">天</option>
        </select>
        <button
          type="button"
          onClick={add}
          className="h-9 px-3.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium transition-colors shrink-0"
        >
          添加
        </button>
      </div>

      {value.length === 0 ? (
        <p className="text-2xs text-ink-3">未设提醒＝到点当天不主动弹窗（事件仍会出现在日历里）。</p>
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
