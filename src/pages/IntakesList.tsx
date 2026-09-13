import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { SortMenu, SortableTh, nextSort, type SortDir, type SortOption } from '../components/SortMenu'
import { useViewPref } from '../lib/viewPrefs'
import { fmtDate, type CaseRow, type Dataset, type IntakeRow } from '../lib/types'

type Filter = 'all' | 'open' | 'converted'
type SortKey = 'default' | 'client' | 'first_contact' | 'signed_at' | 'converted'

const PAGE = 12

interface IntakeView {
  filter: Filter
  sortKey: SortKey
  sortDir: SortDir
}

const DEFAULTS: IntakeView = { filter: 'all', sortKey: 'first_contact', sortDir: 'desc' }

const SORT_OPTIONS: SortOption<SortKey>[] = [
  { key: 'first_contact', label: '首次接触', defaultDir: 'desc' },
  { key: 'signed_at', label: '签单日', defaultDir: 'desc' },
  { key: 'client', label: '当事人', defaultDir: 'asc' },
  { key: 'converted', label: '状态', defaultDir: 'asc' },
  { key: 'default', label: '默认顺序', defaultDir: 'desc' },
]

function ConvertedTag({ converted }: { converted?: boolean }) {
  if (converted) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-medium bg-[#ECFDF3] text-ok">
        <Icon name="check" className="w-2.5 h-2.5" />
        已转案件
      </span>
    )
  }
  return <span className="inline-block px-2 py-0.5 rounded text-2xs font-medium bg-canvas text-ink-2">未转</span>
}

/** 接案↔案件软匹配：同 client + 同 first_contact 即视为对应 */
function findCaseForIntake(intake: IntakeRow, cases: CaseRow[]): CaseRow | null {
  if (!intake.first_contact) return null
  return (
    cases.find(
      (c) => c.client === intake.client && c.first_contact === intake.first_contact,
    ) ?? null
  )
}

/** 日期比较：空值恒排最后，不受升降序影响 */
function cmpDate(a?: string | null, b?: string | null, dir: 1 | -1 = 1): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  if (a === b) return 0
  return a < b ? -dir : dir
}

function cmpIntake(a: IntakeRow, b: IntakeRow, key: SortKey, dir: 1 | -1): number {
  if (key === 'first_contact') return cmpDate(a.first_contact, b.first_contact, dir)
  if (key === 'signed_at') return cmpDate(a.signed_at, b.signed_at, dir)
  if (key === 'converted') {
    const av = a.converted ? 1 : 0
    const bv = b.converted ? 1 : 0
    if (av !== bv) return (av - bv) * dir
    return (a.client ?? '').localeCompare(b.client ?? '', 'zh-Hans-CN')
  }
  return ((a.client ?? '') || '￿').localeCompare((b.client ?? '') || '￿', 'zh-Hans-CN') * dir
}

export function IntakesList({
  data,
  onOpenIntake,
  onOpenCase,
  onCreateIntake,
}: {
  data: Dataset
  onOpenIntake: (id: number) => void
  onOpenCase: (id: number) => void
  onCreateIntake: () => void
}) {
  const { view, patch, reset, isDefault } = useViewPref<IntakeView>('intakes', DEFAULTS)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  // 预计算每个 intake 对应的案件（软匹配），避免每次 render 重算
  const matchedCaseByIntake = useMemo(() => {
    const m = new Map<number, CaseRow>()
    for (const i of data.intakes) {
      if (!i || i.id == null) continue
      const c = findCaseForIntake(i, data.cases)
      if (c) m.set(i.id, c)
    }
    return m
  }, [data.intakes, data.cases])

  const totalAll = data.intakes.length
  const totalConverted = data.intakes.filter((i) => i.converted).length
  const totalOpen = totalAll - totalConverted

  const rows = useMemo(() => {
    let r = data.intakes
    if (view.filter === 'converted') r = r.filter((i) => i.converted)
    if (view.filter === 'open') r = r.filter((i) => !i.converted)
    if (q.trim()) {
      const k = q.trim()
      r = r.filter(
        (i) =>
          (i.client ?? '').includes(k) ||
          (i.note_mask ?? '').includes(k),
      )
    }
    if (view.sortKey === 'default') return r
    const dir = view.sortDir === 'asc' ? 1 : -1
    return [...r].sort((a, b) => cmpIntake(a, b, view.sortKey, dir))
  }, [data.intakes, view.filter, view.sortKey, view.sortDir, q])

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE))
  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE)

  const onSort = (key: SortKey) => {
    const opt = SORT_OPTIONS.find((o) => o.key === key)
    const n = nextSort(key, view.sortKey, view.sortDir, opt?.defaultDir ?? 'asc')
    patch({ sortKey: n.key, sortDir: n.dir })
    setPage(1)
  }

  const chips: { key: Filter; label: string; n: number }[] = [
    { key: 'all', label: '全部', n: totalAll },
    { key: 'open', label: '未转案件', n: totalOpen },
    { key: 'converted', label: '已转案件', n: totalConverted },
  ]

  const cards = [
    { label: '接案总数', value: totalAll, hint: '含未签与已签' },
    { label: '未转案件', value: totalOpen, hint: '仍在线索池' },
    { label: '已转案件', value: totalConverted, hint: '已建正式案件' },
  ]

  const sortMenu = (
    <SortMenu value={view.sortKey} dir={view.sortDir} options={SORT_OPTIONS} onChange={(k, d) => { patch({ sortKey: k, sortDir: d }); setPage(1) }} />
  )

  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      {/* 顶栏 */}
      <div className="hidden md:flex h-14 items-center gap-4 px-6 bg-white border-b border-line sticky top-0 z-10">
        <h1 className="text-[15px] font-semibold shrink-0">接案跟踪</h1>
        <span className="text-xs text-ink-3 shrink-0">
          共 {totalAll} 条 · 未转 {totalOpen} · 已转 {totalConverted}
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
            placeholder="搜索当事人、跟踪记录"
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand"
          />
        </div>
        <button
          onClick={onCreateIntake}
          className="h-9 px-3 rounded-lg bg-brand text-white text-sm font-medium flex items-center gap-1.5 hover:bg-brand-hover"
        >
          <Icon name="plus" className="w-4 h-4" />
          新建接案
        </button>
      </div>

      <div className="p-4 md:p-6 space-y-4">
        {/* 统计卡 */}
        <div className="grid grid-cols-3 gap-3">
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
              placeholder="搜索当事人、跟踪记录"
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
                  label="当事人"
                  sortKey="client"
                  value={view.sortKey}
                  dir={view.sortDir}
                  onSort={onSort}
                  className="text-left font-medium px-4 py-2.5"
                />
                <SortableTh
                  label="首次接触"
                  sortKey="first_contact"
                  value={view.sortKey}
                  dir={view.sortDir}
                  onSort={onSort}
                  className="text-left font-medium px-3 py-2.5 w-28"
                />
                <SortableTh
                  label="签单日"
                  sortKey="signed_at"
                  value={view.sortKey}
                  dir={view.sortDir}
                  onSort={onSort}
                  className="text-left font-medium px-3 py-2.5 w-28"
                />
                <SortableTh
                  label="状态"
                  sortKey="converted"
                  value={view.sortKey}
                  dir={view.sortDir}
                  onSort={onSort}
                  className="text-left font-medium px-3 py-2.5 w-24"
                />
                <th className="text-left font-medium px-3 py-2.5">跟踪记录</th>
                <th className="text-left font-medium px-3 py-2.5 w-20">联系人</th>
                <th className="text-left font-medium px-3 py-2.5 w-28">对应案件</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((i) => {
                const mc = matchedCaseByIntake.get(i.id)
                return (
                  <tr
                    key={i.id}
                    onClick={() => onOpenIntake(i.id)}
                    className="border-t border-line hover:bg-canvas cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{i.client || <span className="text-ink-3">—</span>}</div>
                      {i.note_enc && (
                        <span className="text-2xs text-warn inline-flex items-center gap-0.5 mt-0.5">
                          <Icon name="lock" className="w-2.5 h-2.5" />
                          含加密内容
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-ink-2 text-xs">{fmtDate(i.first_contact)}</td>
                    <td className="px-3 py-3 text-ink-2 text-xs">{fmtDate(i.signed_at)}</td>
                    <td className="px-3 py-3">
                      <ConvertedTag converted={i.converted} />
                    </td>
                    <td className="px-3 py-3 text-ink-2 truncate max-w-[260px]">
                      {i.note_mask || <span className="text-ink-3">—</span>}
                    </td>
                    <td className="px-3 py-3 text-ink-2 text-xs">
                      {i.phones?.length > 0 ? (
                        <span className="inline-flex items-center gap-0.5">
                          <Icon name="phone" className="w-3 h-3" />
                          {i.phones.length}
                        </span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      {mc ? (
                        <button
                          onClick={() => onOpenCase(mc.id)}
                          className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-brand-soft text-brand text-2xs font-medium hover:bg-brand hover:text-white"
                          title={`跳到案件：${mc.client}（${mc.cause}）`}
                        >
                          <Icon name="case" className="w-3 h-3" />
                          {mc.cause || '查看案件'}
                          <Icon name="chevron" className="w-2.5 h-2.5" />
                        </button>
                      ) : (
                        <span className="text-ink-3 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-ink-3 text-sm">
                    没有符合条件的接案记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="flex items-center gap-3 px-4 py-3 border-t border-line text-xs text-ink-2">
            <span>
              共 {rows.length} 条 · 第 {page}/{totalPages} 页
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
          {pageRows.map((i) => {
            const mc = matchedCaseByIntake.get(i.id)
            return (
              <button
                key={i.id}
                onClick={() => onOpenIntake(i.id)}
                className="w-full text-left bg-white rounded-xl border border-line p-3.5 shadow-card"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{i.client || <span className="text-ink-3">—</span>}</div>
                    <div className="text-xs text-ink-2 mt-0.5 truncate">{i.note_mask || '暂无记录'}</div>
                  </div>
                  <ConvertedTag converted={i.converted} />
                </div>
                <div className="flex items-center gap-2 mt-2.5 text-xs text-ink-3">
                  <Icon name="clock" className="w-3.5 h-3.5" />
                  <span>首次接触 {fmtDate(i.first_contact)}</span>
                  {i.phones?.length > 0 && (
                    <>
                      <span>·</span>
                      <Icon name="phone" className="w-3 h-3" />
                      <span>{i.phones.length}</span>
                    </>
                  )}
                </div>
                {mc && (
                  <div
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenCase(mc.id)
                    }}
                    className="mt-2 inline-flex items-center gap-1 h-6 px-2 rounded-md bg-brand-soft text-brand text-2xs font-medium"
                  >
                    <Icon name="case" className="w-3 h-3" />
                    对应案件：{mc.cause || mc.client}
                    <Icon name="chevron" className="w-2.5 h-2.5" />
                  </div>
                )}
              </button>
            )
          })}
          {pageRows.length === 0 && (
            <div className="py-16 text-center text-ink-3 text-sm">没有符合条件的接案记录</div>
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
        onClick={onCreateIntake}
        className="md:hidden fixed right-4 bottom-20 z-30 h-12 px-5 rounded-full bg-brand text-white shadow-pop flex items-center gap-1.5 text-sm font-medium"
      >
        <Icon name="plus" className="w-4 h-4" />
        新建接案
      </button>
    </div>
  )
}
