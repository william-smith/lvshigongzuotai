import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { SortMenu, SortableTh, nextSort, type SortDir, type SortOption } from '../components/SortMenu'
import { useViewPref } from '../lib/viewPrefs'
import { daysUntil, fmtDate, normalizeStage, type CaseRow, type Dataset } from '../lib/types'

type Filter = 'all' | 'active' | 'due' | 'closed'
type SortKey = 'default' | 'client' | 'cause' | 'stage' | 'due'

const PAGE = 12

interface CaseView {
  filter: Filter
  sortKey: SortKey
  sortDir: SortDir
}

const DEFAULTS: CaseView = { filter: 'all', sortKey: 'due', sortDir: 'asc' }

const SORT_OPTIONS: SortOption<SortKey>[] = [
  { key: 'due', label: '节点日期', defaultDir: 'asc' },
  { key: 'client', label: '委托人', defaultDir: 'asc' },
  { key: 'cause', label: '案由', defaultDir: 'asc' },
  { key: 'stage', label: '阶段', defaultDir: 'asc' },
  { key: 'default', label: '默认顺序', defaultDir: 'asc' },
]

function StageTag({ stage }: { stage: string }) {
  const n = normalizeStage(stage)
  const cls =
    n === '在办'
      ? 'bg-brand-soft text-brand'
      : n === '结案'
        ? 'bg-[#ECFDF3] text-ok'
        : 'bg-canvas text-ink-2'
  return <span className={`inline-block px-2 py-0.5 rounded text-2xs font-medium ${cls}`}>{n}</span>
}

function DueTag({ due }: { due?: string | null }) {
  const d = daysUntil(due)
  if (d === null) return <span className="text-2xs text-ink-3">—</span>
  const cls = d < 0 ? 'text-danger' : d <= 3 ? 'text-danger font-semibold' : d <= 7 ? 'text-warn font-medium' : 'text-ink-2'
  const txt = d < 0 ? `逾期 ${-d} 天` : d === 0 ? '今天' : `${d} 天`
  return <span className={`text-xs ${cls}`}>{txt}</span>
}

/** 日期比较：空值恒排最后，不受升降序影响 */
function cmpDate(a?: string | null, b?: string | null, dir: 1 | -1 = 1): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  if (a === b) return 0
  return a < b ? -dir : dir
}

const STAGE_WEIGHT: Record<string, number> = { 在办: 0, 结案: 2, 解除委托: 2 }
const stageWeight = (s?: string | null) => STAGE_WEIGHT[normalizeStage(s)] ?? 1

/** 终结态（结案 / 解除委托）：不再显示节点待办与逾期天数，统计上并入「已结案」 */
const isTerminal = (c: CaseRow) => ['结案', '解除委托'].includes(normalizeStage(c.stage))

function cmpCase(a: CaseRow, b: CaseRow, key: SortKey, dir: 1 | -1): number {
  if (key === 'due') return cmpDate(a.next_due, b.next_due, dir)
  if (key === 'stage') {
    const d = stageWeight(a.stage) - stageWeight(b.stage)
    if (d !== 0) return d * dir
    return (a.client ?? '').localeCompare(b.client ?? '', 'zh-Hans-CN')
  }
  const va = (key === 'client' ? a.client : a.cause) ?? ''
  const vb = (key === 'client' ? b.client : b.cause) ?? ''
  return va.localeCompare(vb, 'zh-Hans-CN') * dir
}

export function CaseList({
  data,
  stats,
  onOpenCase,
  onCreateCase,
}: {
  data: Dataset
  stats: { total: number; active: number; closed: number; thisMonth: number; dueSoon: CaseRow[] }
  onOpenCase: (id: number) => void
  onCreateCase: () => void
}) {
  const { view, patch, reset, isDefault } = useViewPref<CaseView>('cases', DEFAULTS)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  const rows = useMemo(() => {
    let r = data.cases
    if (view.filter === 'active') r = r.filter((c) => normalizeStage(c.stage) === '在办')
    if (view.filter === 'closed') r = r.filter((c) => isTerminal(c))
    if (view.filter === 'due') r = stats.dueSoon
    if (q.trim()) {
      const k = q.trim()
      r = r.filter((c) => c.client.includes(k) || c.cause.includes(k) || (c.next_action ?? '').includes(k))
    }
    if (view.sortKey === 'default') return r
    const dir = view.sortDir === 'asc' ? 1 : -1
    return [...r].sort((a, b) => cmpCase(a, b, view.sortKey, dir))
  }, [data.cases, view.filter, view.sortKey, view.sortDir, q, stats.dueSoon])

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE))
  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE)

  const onSort = (key: SortKey) => {
    const opt = SORT_OPTIONS.find((o) => o.key === key)
    const n = nextSort(key, view.sortKey, view.sortDir, opt?.defaultDir ?? 'asc')
    patch({ sortKey: n.key, sortDir: n.dir })
    setPage(1)
  }

  const chips: { key: Filter; label: string; n: number }[] = [
    { key: 'all', label: '全部', n: stats.total },
    { key: 'active', label: '在办', n: stats.active },
    { key: 'due', label: '临期', n: stats.dueSoon.length },
    { key: 'closed', label: '已结案/解除委托', n: stats.closed },
  ]

  const cards = [
    { label: '在办案件', value: stats.active, hint: `共 ${stats.total} 件` },
    { label: '本月节点', value: stats.thisMonth, hint: '开庭 / 提交 / 答复' },
    { label: '临期事项', value: stats.dueSoon.length, hint: '7 天内到期' },
    { label: '已结案', value: stats.closed, hint: '可归档' },
  ]

  const sortMenu = (
    <SortMenu value={view.sortKey} dir={view.sortDir} options={SORT_OPTIONS} onChange={(k, d) => { patch({ sortKey: k, sortDir: d }); setPage(1) }} />
  )

  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      {/* 顶栏 */}
      <div className="hidden md:flex h-14 items-center gap-4 px-6 bg-white border-b border-line sticky top-0 z-10">
        <h1 className="text-[15px] font-semibold shrink-0">案件台账</h1>
        <span className="text-xs text-ink-3 shrink-0">
          共 {stats.total} 件 · 在办 {stats.active} · 临期 {stats.dueSoon.length} · 待归档 {stats.closed}
        </span>
        <div className="flex-1" />
        <div className="relative w-64">
          <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
            placeholder="搜索委托人、案由"
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand"
          />
        </div>
        <button
          onClick={onCreateCase}
          className="h-9 px-3 rounded-lg bg-brand text-white text-sm font-medium flex items-center gap-1.5 hover:bg-brand-hover"
        >
          <Icon name="plus" className="w-4 h-4" />
          新建案件
        </button>
      </div>

      <div className="p-4 md:p-6 space-y-4">
        {/* 统计卡 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {cards.map((c) => (
            <div key={c.label} className="bg-white rounded-xl border border-line p-4 shadow-card">
              <div className="text-xs text-ink-2">{c.label}</div>
              <div className="text-2xl font-semibold mt-1 tabular-nums">{c.value}</div>
              <div className="text-2xs text-ink-3 mt-0.5">{c.hint}</div>
            </div>
          ))}
        </div>

        {/* 筛选 + 排序（桌面） */}
        <div className="flex items-center gap-2">
          <div className="flex gap-2 overflow-x-auto pb-1 min-w-0 flex-1">
            {chips.map((c) => (
              <button
                key={c.key}
                onClick={() => {
                  patch({ filter: c.key })
                  setPage(1)
                }}
                className={`shrink-0 h-8 px-3 rounded-lg text-xs border ${
                  view.filter === c.key
                    ? 'bg-ink text-white border-ink'
                    : 'bg-white text-ink-2 border-line hover:border-ink-3'
                }`}
              >
                {c.label} {c.n}
              </button>
            ))}
          </div>
          {!isDefault && (
            <button
              onClick={() => {
                reset()
                setPage(1)
              }}
              className="hidden md:flex shrink-0 h-8 px-2.5 rounded-lg text-xs border border-line bg-white text-ink-3 hover:text-ink items-center gap-1"
            >
              <Icon name="close" className="w-3 h-3" />
              重置
            </button>
          )}
          <div className="hidden md:block">{sortMenu}</div>
        </div>

        {/* 移动端：搜索 + 排序 */}
        <div className="flex items-center gap-2 md:hidden">
          <div className="relative flex-1">
            <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
              placeholder="搜索委托人、案由"
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-line bg-white text-sm outline-none"
            />
          </div>
          {sortMenu}
          {!isDefault && (
            <button
              onClick={() => {
                reset()
                setPage(1)
              }}
              className="shrink-0 h-8 px-2 rounded-lg text-xs border border-line bg-white text-ink-3"
            >
              重置
            </button>
          )}
        </div>

        {/* 桌面表格 */}
        <div className="hidden md:block bg-white rounded-xl border border-line shadow-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-canvas text-ink-2 text-xs">
                <SortableTh
                  label="委托人"
                  sortKey="client"
                  value={view.sortKey}
                  dir={view.sortDir}
                  onSort={onSort}
                  className="text-left font-medium px-4 py-2.5"
                />
                <SortableTh
                  label="案由"
                  sortKey="cause"
                  value={view.sortKey}
                  dir={view.sortDir}
                  onSort={onSort}
                  className="text-left font-medium px-3 py-2.5 w-40"
                />
                <SortableTh
                  label="阶段"
                  sortKey="stage"
                  value={view.sortKey}
                  dir={view.sortDir}
                  onSort={onSort}
                  className="text-left font-medium px-3 py-2.5 w-24"
                />
                <th className="text-left font-medium px-3 py-2.5">下一节点</th>
                <SortableTh
                  label="日期"
                  sortKey="due"
                  value={view.sortKey}
                  dir={view.sortDir}
                  onSort={onSort}
                  className="text-left font-medium px-3 py-2.5 w-28"
                />
                <th className="text-left font-medium px-3 py-2.5 w-20">期限</th>
                <th className="text-left font-medium px-3 py-2.5 w-16">承办</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => onOpenCase(c.id)}
                  className="border-t border-line hover:bg-canvas cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{c.client}</div>
                    {c.has_secret && (
                      <span className="text-2xs text-warn inline-flex items-center gap-0.5 mt-0.5">
                        <Icon name="lock" className="w-2.5 h-2.5" />
                        含加密内容
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-ink-2 truncate max-w-[160px]">{c.cause}</td>
                  <td className="px-3 py-3">
                    <StageTag stage={c.stage} />
                  </td>
                <td className="px-3 py-3 text-ink-2 truncate max-w-[220px]">
                  {isTerminal(c) ? '—' : c.next_action || '—'}
                </td>
                <td className="px-3 py-3 text-ink-2 text-xs">{fmtDate(c.next_due)}</td>
                <td className="px-3 py-3">
                  <DueTag due={isTerminal(c) ? null : c.next_due} />
                </td>
                  <td className="px-3 py-3 text-ink-3 text-xs">景</td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-ink-3 text-sm">
                    没有符合条件的案件
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="flex items-center gap-3 px-4 py-3 border-t border-line text-xs text-ink-2">
            <span>
              共 {rows.length} 件 · 第 {page}/{totalPages} 页
            </span>
            <div className="flex-1" />
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-2.5 h-7 rounded border border-line disabled:opacity-40"
            >
              上一页
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-2.5 h-7 rounded border border-line disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>

        {/* 移动卡片 */}
        <div className="md:hidden space-y-2">
          {pageRows.map((c) => (
            <button
              key={c.id}
              onClick={() => onOpenCase(c.id)}
              className="w-full text-left bg-white rounded-xl border border-line p-3.5 shadow-card"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">{c.client}</div>
                  <div className="text-xs text-ink-2 mt-0.5 truncate">{c.cause}</div>
                </div>
                <StageTag stage={c.stage} />
              </div>
              <div className="flex items-center gap-2 mt-2.5 text-xs text-ink-3">
                <Icon name="clock" className="w-3.5 h-3.5" />
                {isTerminal(c) ? (
                  <span className="truncate flex-1">已结案</span>
                ) : (
                  <>
                    <span className="truncate flex-1">{c.next_action || '暂无待办'}</span>
                    <DueTag due={c.next_due} />
                  </>
                )}
              </div>
            </button>
          ))}
          {pageRows.length === 0 && (
            <div className="py-16 text-center text-ink-3 text-sm">没有符合条件的案件</div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2 text-xs text-ink-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 h-8 rounded border border-line disabled:opacity-40"
              >
                上一页
              </button>
              <span>
                {page}/{totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 h-8 rounded border border-line disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 移动端浮动新建按钮 */}
      <button
        onClick={onCreateCase}
        className="md:hidden fixed right-4 bottom-20 z-30 h-12 px-5 rounded-full bg-brand text-white shadow-pop flex items-center gap-1.5 text-sm font-medium"
      >
        <Icon name="plus" className="w-4 h-4" />
        新建案件
      </button>
    </div>
  )
}
