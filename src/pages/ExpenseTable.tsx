import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { SortMenu, SortableTh, nextSort, type SortDir, type SortOption } from '../components/SortMenu'
import { SecretMoney, useAmountVisible } from '../components/SecretMoney'
import { useViewPref } from '../lib/viewPrefs'
import { fmtDate, type Dataset, type ExpenseRow } from '../lib/types'

type DirectionFilter = 'all' | '收入' | '支出'
type ExSortKey = 'at' | 'direction' | 'category' | 'amount' | 'personal' | 'client'

/** 费用行 + 派生字段（归一化收支、案件委托人名） */
interface ExRow extends ExpenseRow {
  dir: '收入' | '支出' | ''
  client: string
}

/** NocoDB 费用表「收 / 支」单字或全称都归一化 */
function normDir(v?: string | null): '收入' | '支出' | '' {
  if (!v) return ''
  if (v.startsWith('收')) return '收入'
  if (v.startsWith('支')) return '支出'
  return ''
}

const DIR_WEIGHT: Record<string, number> = { 收入: 0, 支出: 1 }

const PAGE = 15

interface ExpenseView {
  keyword: string
  direction: DirectionFilter
  category: string
  dateFrom: string
  dateTo: string
  amountMin: string
  amountMax: string
  sortKey: ExSortKey
  sortDir: SortDir
}

const DEFAULTS: ExpenseView = {
  keyword: '',
  direction: 'all',
  category: '',
  dateFrom: '',
  dateTo: '',
  amountMin: '',
  amountMax: '',
  sortKey: 'at',
  sortDir: 'desc',
}

const SORT_OPTIONS: SortOption<ExSortKey>[] = [
  { key: 'at', label: '日期', defaultDir: 'desc' },
  { key: 'direction', label: '收支', defaultDir: 'asc' },
  { key: 'category', label: '类别', defaultDir: 'asc' },
  { key: 'amount', label: '金额', defaultDir: 'desc' },
  { key: 'personal', label: '个人得', defaultDir: 'desc' },
  { key: 'client', label: '案件', defaultDir: 'asc' },
]

/** 空值恒排最后、不受升降序影响 */
function cmpStr(a?: string | null, b?: string | null, dir: 1 | -1 = 1): number {
  const va = a ?? ''
  const vb = b ?? ''
  if (va === vb) return 0
  return va.localeCompare(vb, 'zh-Hans-CN') * dir
}
function cmpNum(a?: number | null, b?: number | null, dir: 1 | -1 = 1): number {
  const na = a ?? null
  const nb = b ?? null
  if (na === null && nb === null) return 0
  if (na === null) return 1
  if (nb === null) return -1
  if (na === nb) return 0
  return (na < nb ? -1 : 1) * dir
}
function cmpDateStr(a?: string | null, b?: string | null, dir: 1 | -1 = 1): number {
  const va = a ?? ''
  const vb = b ?? ''
  if (!va && !vb) return 0
  if (!va) return 1
  if (!vb) return -1
  if (va === vb) return 0
  return (va < vb ? -1 : 1) * dir
}

function cmpRow(a: ExRow, b: ExRow, key: ExSortKey, dir: 1 | -1): number {
  switch (key) {
    case 'at':
      return cmpDateStr(a.at, b.at, dir)
    case 'direction': {
      const wa = DIR_WEIGHT[a.dir] ?? 2
      const wb = DIR_WEIGHT[b.dir] ?? 2
      if (wa !== wb) return (wa - wb) * dir
      return cmpStr(a.category, b.category, dir)
    }
    case 'category':
      return cmpStr(a.category, b.category, dir)
    case 'amount':
      return cmpNum(a.amount, b.amount, dir)
    case 'personal':
      return cmpNum(a.personal, b.personal, dir)
    case 'client':
      return cmpStr(a.client, b.client, dir)
  }
}

function DirectionTag({ dir }: { dir: '收入' | '支出' | '' }) {
  if (dir === '收入')
    return <span className="inline-block px-2 py-0.5 rounded text-2xs font-medium bg-[#ECFDF3] text-ok">收入</span>
  if (dir === '支出')
    return <span className="inline-block px-2 py-0.5 rounded text-2xs font-medium bg-canvas text-ink-2">支出</span>
  return <span className="text-2xs text-ink-3">—</span>
}

export function ExpenseTable({ data, onOpenCase }: { data: Dataset; onOpenCase: (id: number) => void }) {
  const { view, patch, reset, isDefault } = useViewPref<ExpenseView>('expenses', DEFAULTS)
  const [page, setPage] = useState(1)
  const { visible: amtVisible, toggle: toggleAmt } = useAmountVisible()

  const categories = useMemo(() => {
    const s = new Set<string>()
    data.expenses.forEach((e) => {
      if (e.category) s.add(e.category)
    })
    return [...s].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  }, [data.expenses])

  const caseMap = useMemo(() => {
    const m = new Map<number, string>()
    data.cases.forEach((c) => m.set(c.id, c.client))
    return m
  }, [data.cases])

  // 1) 联表 + 过滤
  const filtered = useMemo(() => {
    const joined: ExRow[] = data.expenses.map((e) => ({
      ...e,
      dir: normDir(e.direction),
      client: (e.case_id != null ? caseMap.get(e.case_id) : undefined) ?? '—',
    }))
    let r = joined
    const kw = view.keyword.trim().toLowerCase()
    if (kw) {
      r = r.filter(
        (x) =>
          (x.category ?? '').toLowerCase().includes(kw) ||
          (x.detail ?? '').toLowerCase().includes(kw) ||
          (x.client ?? '').toLowerCase().includes(kw) ||
          x.dir.toLowerCase().includes(kw) ||
          (x.amount != null ? String(x.amount) : '').includes(kw),
      )
    }
    if (view.direction !== 'all') r = r.filter((x) => x.dir === view.direction)
    if (view.category) r = r.filter((x) => x.category === view.category)
    if (view.dateFrom) r = r.filter((x) => (x.at ?? '') >= view.dateFrom)
    if (view.dateTo) r = r.filter((x) => (x.at ?? '') <= view.dateTo)
    if (view.amountMin !== '') {
      const mn = Number(view.amountMin)
      if (!Number.isNaN(mn)) r = r.filter((x) => (x.amount ?? -Infinity) >= mn)
    }
    if (view.amountMax !== '') {
      const mx = Number(view.amountMax)
      if (!Number.isNaN(mx)) r = r.filter((x) => (x.amount ?? Infinity) <= mx)
    }
    return r
  }, [data.expenses, caseMap, view])

  // 2) 排序
  const sorted = useMemo(() => {
    const dir = view.sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => cmpRow(a, b, view.sortKey, dir))
  }, [filtered, view.sortKey, view.sortDir])

  // 3) 汇总（基于筛选后集合）
  const totals = useMemo(() => {
    let income = 0
    let expense = 0
    let personal = 0
    for (const x of filtered) {
      if (x.amount != null) {
        if (x.dir === '收入') income += x.amount
        else if (x.dir === '支出') expense += x.amount
      }
      if (x.personal != null) personal += x.personal
    }
    // 净额口径：个人得合计 − 支出合计
    return { count: filtered.length, income, expense, personal, net: personal - expense }
  }, [filtered])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE))
  const pageRows = sorted.slice((page - 1) * PAGE, page * PAGE)

  const onSort = (key: ExSortKey) => {
    const opt = SORT_OPTIONS.find((o) => o.key === key)
    const n = nextSort(key, view.sortKey, view.sortDir, opt?.defaultDir ?? 'asc')
    patch({ sortKey: n.key, sortDir: n.dir })
    setPage(1)
  }

  const setField = (p: Partial<ExpenseView>) => {
    patch(p)
    setPage(1)
  }

  const inputCls =
    'h-9 px-2.5 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand tabular-nums'
  const labelCls = 'text-2xs text-ink-3 mb-1'

  const sortMenu = (
    <SortMenu
      value={view.sortKey}
      dir={view.sortDir}
      options={SORT_OPTIONS}
      onChange={(k, d) => {
        patch({ sortKey: k, sortDir: d })
        setPage(1)
      }}
    />
  )

  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      {/* 顶栏 */}
      <div className="hidden md:flex h-14 items-center gap-4 px-6 bg-white border-b border-line sticky top-0 z-10">
        <h1 className="text-[15px] font-semibold shrink-0">费用总表</h1>
        <span className="text-xs text-ink-3 shrink-0">共 {data.expenses.length} 条费用记录</span>
        <div className="flex-1" />
        <div className="relative w-64">
          <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            value={view.keyword}
            onChange={(e) => setField({ keyword: e.target.value })}
            placeholder="搜索类别 / 备注 / 案件"
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand"
          />
        </div>
        <button
          onClick={toggleAmt}
          title={amtVisible ? '隐藏金额（客户在场时用）' : '显示金额'}
          className="h-9 px-2.5 rounded-lg border border-line bg-white text-ink-2 hover:bg-canvas inline-flex items-center gap-1.5 shrink-0"
        >
          <Icon name={amtVisible ? 'eye-off' : 'eye'} className="w-4 h-4" />
          <span className="text-xs">{amtVisible ? '隐藏金额' : '显示金额'}</span>
        </button>
      </div>

      <div className="p-4 md:p-6 space-y-4">
        {/* 汇总卡 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-white rounded-xl border border-line p-4 shadow-card">
            <div className="text-xs text-ink-2">筛选后记录</div>
            <div className="text-xl font-semibold mt-1 tabular-nums">{totals.count}</div>
            <div className="text-2xs text-ink-3 mt-0.5">共 {data.expenses.length} 条</div>
          </div>
          <div className="bg-white rounded-xl border border-line p-4 shadow-card">
            <div className="text-xs text-ink-2">总收入</div>
            <SecretMoney value={totals.income} className="text-xl font-semibold mt-1 tabular-nums text-ok" />
            <div className="text-2xs text-ink-3 mt-0.5">收入类合计</div>
          </div>
          <div className="bg-white rounded-xl border border-line p-4 shadow-card">
            <div className="text-xs text-ink-2">总个人得</div>
            <SecretMoney value={totals.personal} className="text-xl font-semibold mt-1 tabular-nums text-brand" />
            <div className="text-2xs text-ink-3 mt-0.5">个人得金额合计</div>
          </div>
          <div className="bg-white rounded-xl border border-line p-4 shadow-card">
            <div className="text-xs text-ink-2">总支出</div>
            <SecretMoney value={totals.expense} className="text-xl font-semibold mt-1 tabular-nums" />
            <div className="text-2xs text-ink-3 mt-0.5">支出类合计</div>
          </div>
          <div className="bg-white rounded-xl border border-line p-4 shadow-card">
            <div className="text-xs text-ink-2">净额</div>
            <SecretMoney value={totals.net} className="text-xl font-semibold mt-1 tabular-nums" />
            <div className="text-2xs text-ink-3 mt-0.5">个人得 − 支出</div>
          </div>
        </div>

        {/* 筛选条（响应式：自动换行） */}
        <div className="bg-white rounded-xl border border-line p-3 md:p-4 shadow-card">
          {/* 移动端搜索 + 眼睛按钮 */}
          <div className="md:hidden flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                value={view.keyword}
                onChange={(e) => setField({ keyword: e.target.value })}
                placeholder="搜索类别 / 备注 / 案件"
                className="w-full h-9 pl-9 pr-3 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand"
              />
            </div>
            <button
              onClick={toggleAmt}
              title={amtVisible ? '隐藏金额' : '显示金额'}
              className="h-9 w-9 shrink-0 rounded-lg border border-line bg-white text-ink-2 hover:bg-canvas inline-flex items-center justify-center"
            >
              <Icon name={amtVisible ? 'eye-off' : 'eye'} className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            {/* 收支 */}
            <div>
              <div className={labelCls}>收支</div>
              <div className="flex gap-1.5">
                {(['all', '收入', '支出'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setField({ direction: d })}
                    className={`h-9 px-3 rounded-lg text-xs border ${
                      view.direction === d
                        ? 'bg-ink text-white border-ink'
                        : 'bg-white text-ink-2 border-line hover:border-ink-3'
                    }`}
                  >
                    {d === 'all' ? '全部' : d}
                  </button>
                ))}
              </div>
            </div>
            {/* 类别 */}
            <div>
              <div className={labelCls}>类别</div>
              <select
                value={view.category}
                onChange={(e) => setField({ category: e.target.value })}
                className="h-9 px-2.5 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand"
              >
                <option value="">全部类别</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            {/* 日期范围 */}
            <div>
              <div className={labelCls}>日期范围</div>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={view.dateFrom}
                  onChange={(e) => setField({ dateFrom: e.target.value })}
                  className={inputCls}
                />
                <span className="text-ink-3">~</span>
                <input
                  type="date"
                  value={view.dateTo}
                  onChange={(e) => setField({ dateTo: e.target.value })}
                  className={inputCls}
                />
              </div>
            </div>
            {/* 金额区间 */}
            <div>
              <div className={labelCls}>金额区间（元）</div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={view.amountMin}
                  onChange={(e) => setField({ amountMin: e.target.value })}
                  placeholder="最小"
                  className={`${inputCls} w-24`}
                />
                <span className="text-ink-3">~</span>
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={view.amountMax}
                  onChange={(e) => setField({ amountMax: e.target.value })}
                  placeholder="最大"
                  className={`${inputCls} w-24`}
                />
              </div>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              {!isDefault && (
                <button
                  onClick={() => {
                    reset()
                    setPage(1)
                  }}
                  className="h-8 px-2.5 rounded-lg text-xs border border-line bg-white text-ink-3 hover:text-ink flex items-center gap-1"
                >
                  <Icon name="close" className="w-3 h-3" />
                  重置
                </button>
              )}
              {sortMenu}
            </div>
          </div>
        </div>

        {/* 桌面表格 */}
        <div className="hidden md:block bg-white rounded-xl border border-line shadow-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-canvas text-ink-2 text-xs">
                <SortableTh label="日期" sortKey="at" value={view.sortKey} dir={view.sortDir} onSort={onSort} className="text-left font-medium px-4 py-2.5 w-28" />
                <SortableTh label="收支" sortKey="direction" value={view.sortKey} dir={view.sortDir} onSort={onSort} className="text-left font-medium px-3 py-2.5 w-16" />
                <SortableTh label="类别" sortKey="category" value={view.sortKey} dir={view.sortDir} onSort={onSort} className="text-left font-medium px-3 py-2.5 w-32" />
                <SortableTh label="金额" sortKey="amount" value={view.sortKey} dir={view.sortDir} onSort={onSort} className="text-right font-medium px-3 py-2.5 w-28" />
                <SortableTh label="个人得" sortKey="personal" value={view.sortKey} dir={view.sortDir} onSort={onSort} className="text-right font-medium px-3 py-2.5 w-28" />
                <th className="text-left font-medium px-3 py-2.5">备注</th>
                <SortableTh label="案件" sortKey="client" value={view.sortKey} dir={view.sortDir} onSort={onSort} className="text-left font-medium px-3 py-2.5 w-32" />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((x) => {
                const canOpen = x.case_id != null
                return (
                  <tr
                    key={x.id}
                    onClick={() => canOpen && onOpenCase(x.case_id as number)}
                    className={`border-t border-line ${canOpen ? 'hover:bg-canvas cursor-pointer' : ''}`}
                  >
                    <td className="px-4 py-3 text-xs text-ink-2">{fmtDate(x.at)}</td>
                    <td className="px-3 py-3">
                      <DirectionTag dir={x.dir} />
                    </td>
                    <td className="px-3 py-3">{x.category || '—'}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium">
                      <SecretMoney value={x.amount} />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-2">
                      <SecretMoney value={x.personal} />
                    </td>
                    <td className="px-3 py-3 text-ink-2 truncate max-w-[260px]">{x.detail || '—'}</td>
                    <td className="px-3 py-3 text-ink-2 truncate max-w-[140px]">{x.client}</td>
                  </tr>
                )
              })}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-ink-3 text-sm">
                    没有符合条件的费用记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="flex items-center gap-3 px-4 py-3 border-t border-line text-xs text-ink-2">
            <span>
              共 {sorted.length} 条 · 第 {page}/{totalPages} 页
            </span>
            <div className="flex-1" />
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-2.5 h-7 rounded border border-line disabled:opacity-40">
              上一页
            </button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-2.5 h-7 rounded border border-line disabled:opacity-40">
              下一页
            </button>
          </div>
        </div>

        {/* 移动卡片 */}
        <div className="md:hidden space-y-2">
          {pageRows.map((x) => {
            const canOpen = x.case_id != null
            return (
              <button
                key={x.id}
                onClick={() => canOpen && onOpenCase(x.case_id as number)}
                disabled={!canOpen}
                className="w-full text-left bg-white rounded-xl border border-line p-3.5 shadow-card"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-3">{fmtDate(x.at)}</span>
                  <DirectionTag dir={x.dir} />
                  <span className="text-xs text-ink-2 truncate flex-1">{x.category || '—'}</span>
                  <SecretMoney
                    value={x.amount}
                    interactive={false}
                    className={`text-sm font-semibold tabular-nums ${x.dir === '收入' ? 'text-ok' : 'text-ink'}`}
                  />
                </div>
                <div className="text-xs text-ink-2 mt-1.5 truncate">{x.detail || '—'}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-2xs text-ink-3 truncate flex-1">案件：{x.client}</span>
                  {x.personal != null && (
                    <span className="text-2xs text-brand shrink-0">
                      个人得 <SecretMoney value={x.personal} interactive={false} />
                    </span>
                  )}
                </div>
              </button>
            )
          })}
          {pageRows.length === 0 && (
            <div className="py-16 text-center text-ink-3 text-sm">没有符合条件的费用记录</div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2 text-xs text-ink-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 h-8 rounded border border-line disabled:opacity-40">
                上一页
              </button>
              <span>
                {page}/{totalPages}
              </span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 h-8 rounded border border-line disabled:opacity-40">
                下一页
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
