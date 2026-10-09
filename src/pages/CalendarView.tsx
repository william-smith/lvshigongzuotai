import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { normalizeStage, type CaseRow, type Dataset, type IntakeRow } from '../lib/types'

/**
 * 月视图日程。
 *
 * 事件来源与 iCal 订阅完全一致（见 supabase/nas_calendar_ics.sql 与 functions/api/calendar.ics.ts）：
 *   - 案件：stage_norm='在办' 且 next_due 非空 → 标题 `委托人 · 案由 · 下一节点(next_action)`
 *   - 接案：next_due 非空（含已转案件，不剔除）→ 标题 `委托人 · 接案 · 节点事项(next_action 空则「接案跟踪」)`
 * 数据直接复用 Shell 已全量加载的 data.cases / data.intakes，按当前生效后端展示，无额外请求。
 */
type CalEvent = {
  id: number
  kind: 'case' | 'intake'
  date: string // YYYY-MM-DD
  time: string // HH:MM 或 ''
  client: string
  /** 日历格内/清单里显示的副标题：案由·事项（接案则为 接案·事项） */
  subtitle: string
  /** 完整标题（用于 tooltip / 无障碍） */
  title: string
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function CalendarView({
  data,
  onOpenCase,
  onOpenIntake,
}: {
  data: Dataset
  onOpenCase: (id: number) => void
  onOpenIntake: (id: number) => void
}) {
  const todayStr = ymd(new Date())
  const [cursor, setCursor] = useState(() => {
    const n = new Date()
    return { y: n.getFullYear(), m: n.getMonth() } // m: 0-11
  })
  const [selected, setSelected] = useState<string>(todayStr)

  // 事件：与 iCal 订阅一致的取数口径
  const events = useMemo<CalEvent[]>(() => {
    const out: CalEvent[] = []
    for (const c of data.cases as CaseRow[]) {
      if ((c.stage_norm || normalizeStage(c.stage)) !== '在办') continue
      if (!c.next_due) continue
      const [date, time = ''] = c.next_due.split('T')
      const client = (c.client || '').trim()
      const cause = (c.cause || '').trim()
      const action = (c.next_action || '').trim()
      const name = client ? (cause ? `${client} · ${cause}` : client) : cause || '事件'
      const title = action ? `${name} · ${action}` : name
      const subtitle = action ? `${cause} · ${action}` : cause || '案件'
      out.push({ id: c.id, kind: 'case', date, time: time.slice(0, 5), client, subtitle, title })
    }
    for (const i of data.intakes as IntakeRow[]) {
      if (!i.next_due) continue
      const [date, time = ''] = i.next_due.split('T')
      const client = (i.client || '').trim()
      const action = (i.next_action || '').trim() || '接案跟踪'
      const name = client ? `${client} · 接案` : '接案'
      const title = `${name} · ${action}`
      const subtitle = `接案 · ${action}`
      out.push({ id: i.id, kind: 'intake', date, time: time.slice(0, 5), client, subtitle, title })
    }
    return out
  }, [data])

  // 按日期分组 + 当天内按时间排序
  const byDate = useMemo(() => {
    const m = new Map<string, CalEvent[]>()
    for (const e of events) {
      const arr = m.get(e.date) ?? []
      arr.push(e)
      m.set(e.date, arr)
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'))
    return m
  }, [events])

  // 6 周 × 7 列网格（周日起首），含上月/下月补位
  const cells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1)
    const startDow = first.getDay() // 0=日
    const gridStart = new Date(cursor.y, cursor.m, 1 - startDow)
    const arr: { date: string; day: number; inMonth: boolean }[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
      arr.push({ date: ymd(d), day: d.getDate(), inMonth: d.getMonth() === cursor.m })
    }
    return arr
  }, [cursor])

  const prevMonth = () => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }))
  const nextMonth = () => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }))
  const goToday = () => {
    const n = new Date()
    setCursor({ y: n.getFullYear(), m: n.getMonth() })
    setSelected(ymd(n))
  }

  const monthLabel = `${cursor.y}年${cursor.m + 1}月`
  const selectedEvents = byDate.get(selected) ?? []
  const selD = selected.split('-')
  const selLabel = `${Number(selD[1])}月${Number(selD[2])}日`
  const isSelToday = selected === todayStr

  const openEvent = (e: CalEvent) => {
    if (e.kind === 'case') onOpenCase(e.id)
    else onOpenIntake(e.id)
  }

  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      {/* 桌面顶栏 */}
      <div className="hidden md:flex h-14 items-center gap-3 px-6 bg-white border-b border-line sticky top-0 z-10">
        <h1 className="text-[15px] font-semibold">日程</h1>
        <span className="text-xs text-ink-3">{events.length} 条安排</span>
      </div>

      <div className="p-4 md:p-6 max-w-6xl">
        {/* 移动端标题 */}
        <div className="md:hidden flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold">日程</h1>
          <span className="text-xs text-ink-3">{events.length} 条安排</span>
        </div>

        {/* 月份切换 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1">
            <button
              onClick={prevMonth}
              title="上个月"
              className="w-9 h-9 rounded-lg border border-line bg-white flex items-center justify-center text-ink-2 hover:bg-canvas"
            >
              <Icon name="chevron" className="w-4 h-4 rotate-180" />
            </button>
            <div className="text-base font-semibold tabular-nums px-2 min-w-[110px] text-center">{monthLabel}</div>
            <button
              onClick={nextMonth}
              title="下个月"
              className="w-9 h-9 rounded-lg border border-line bg-white flex items-center justify-center text-ink-2 hover:bg-canvas"
            >
              <Icon name="chevron" className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={goToday}
            className="h-9 px-3 rounded-lg border border-line bg-white text-sm text-ink-2 hover:bg-canvas"
          >
            今天
          </button>
        </div>

        <div className="flex flex-col lg:flex-row gap-4">
          {/* 月历网格 */}
          <div className="bg-white rounded-xl border border-line shadow-card p-3 md:p-4 flex-1">
            {/* 星期表头 */}
            <div className="grid grid-cols-7 mb-1">
              {WEEKDAYS.map((w, i) => (
                <div
                  key={w}
                  className={`text-center text-xs font-medium py-1.5 ${i === 0 || i === 6 ? 'text-ink-3' : 'text-ink-2'}`}
                >
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((c) => {
                const dayEvents = byDate.get(c.date) ?? []
                const isToday = c.date === todayStr
                const isSel = c.date === selected
                const active = isSel || isToday
                return (
                  <button
                    key={c.date}
                    onClick={() => setSelected(c.date)}
                    className={`min-h-[68px] md:min-h-[84px] rounded-lg border text-left p-1.5 flex flex-col transition-colors ${
                      active ? 'border-brand bg-brand-soft' : 'border-line hover:bg-canvas'
                    } ${!c.inMonth ? 'opacity-40' : ''}`}
                  >
                    <div
                      className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full ${
                        isToday ? 'bg-brand text-white' : isSel ? 'text-brand' : 'text-ink-2'
                      }`}
                    >
                      {c.day}
                    </div>
                    <div className="mt-0.5 space-y-0.5 overflow-hidden">
                      {dayEvents.slice(0, 3).map((e) => (
                        <div
                          key={e.kind + e.id}
                          title={e.title}
                          onClick={(ev) => {
                            ev.stopPropagation()
                            openEvent(e)
                          }}
                          className={`truncate rounded px-1 py-0.5 text-[10px] leading-tight flex items-center gap-1 cursor-pointer ${
                            e.kind === 'case' ? 'bg-brand/10 text-brand' : 'bg-ok/10 text-ok'
                          }`}
                        >
                          <span
                            className={`w-1 h-1 rounded-full shrink-0 ${e.kind === 'case' ? 'bg-brand' : 'bg-ok'}`}
                          />
                          <span className="truncate">
                            {e.time ? `${e.time} ` : ''}
                            {e.client}
                          </span>
                        </div>
                      ))}
                      {dayEvents.length > 3 && (
                        <div className="text-[10px] text-ink-3 px-1">+{dayEvents.length - 3}</div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 选中日清单 */}
          <div className="lg:w-80 shrink-0">
            <div className="bg-white rounded-xl border border-line shadow-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Icon name="calendar" className="w-4 h-4 text-brand" />
                <h2 className="text-sm font-semibold">{selLabel}</h2>
                {isSelToday && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-soft text-brand">今天</span>
                )}
                <span className="text-xs text-ink-3 ml-auto">{selectedEvents.length} 项</span>
              </div>
              {selectedEvents.length === 0 ? (
                <div className="py-10 text-center text-sm text-ink-3">这一天没有安排</div>
              ) : (
                <div className="space-y-2">
                  {selectedEvents.map((e) => (
                    <button
                      key={e.kind + e.id}
                      onClick={() => openEvent(e)}
                      className="w-full text-left rounded-lg border border-line p-3 hover:border-brand/40 hover:bg-canvas transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                            e.kind === 'case' ? 'bg-brand/10 text-brand' : 'bg-ok/10 text-ok'
                          }`}
                        >
                          {e.kind === 'case' ? '案件' : '接案'}
                        </span>
                        {e.time && <span className="text-xs text-ink-2 tabular-nums">{e.time}</span>}
                      </div>
                      <div className="text-sm font-medium mt-1.5 truncate">{e.client}</div>
                      <div className="text-xs text-ink-2 mt-0.5 truncate">{e.subtitle}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
