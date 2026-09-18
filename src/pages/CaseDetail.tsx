import { useMemo, useState, type ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { SecretPhone, SecretText } from '../components/SecretText'
import { SecretMoney, useAmountVisible } from '../components/SecretMoney'
import { useSwipeNavigation } from '../lib/gestures'
import { openCamScanner, ScanFallbackDialog } from '../components/ScanLauncher'
import { MaterialsView } from './MaterialsView'
import { daysUntil, fmtDate, fmtDateTime, normalizeStage, type CaseRow, type Dataset, type ExpenseRow, type TimelineRow } from '../lib/types'

type Tab = 'overview' | 'timeline' | 'expense' | 'material'

function InfoItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-2xs text-ink-3">{label}</div>
      <div className="text-sm mt-0.5">{children}</div>
    </div>
  )
}

function RowActions({
  onEdit,
  onDelete,
}: {
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition shrink-0">
      <button
        type="button"
        onClick={onEdit}
        title="编辑"
        className="w-7 h-7 flex items-center justify-center text-ink-2 hover:bg-canvas rounded-lg"
      >
        <Icon name="settings" className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        title="删除"
        className="w-7 h-7 flex items-center justify-center text-danger hover:bg-[#FEF2F2] rounded-lg"
      >
        <Icon name="close" className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export function CaseDetail({
  c,
  data,
  onBack,
  onEdit,
  right,
  onCreateTimeline,
  onEditTimeline,
  onDeleteTimeline,
  onCreateExpense,
  onEditExpense,
  onDeleteExpense,
}: {
  c: CaseRow
  data: Dataset
  onBack: () => void
  onEdit: () => void
  right?: ReactNode
  onCreateTimeline: () => void
  onEditTimeline: (t: TimelineRow) => void
  onDeleteTimeline: (id: number) => void
  onCreateExpense: () => void
  onEditExpense: (e: ExpenseRow) => void
  onDeleteExpense: (id: number) => void
}) {
  const [tab, setTab] = useState<Tab>('overview')
  const { visible: amtVisible, toggle: toggleAmt } = useAmountVisible()

  const timeline = useMemo(
    () => data.timeline.filter((t) => t.case_id === c.id).sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')),
    [data.timeline, c.id],
  )
  const expenses = useMemo(() => data.expenses.filter((e) => e.case_id === c.id), [data.expenses, c.id])
  const materials = useMemo(() => data.materials.filter((m) => m.case_id === c.id), [data.materials, c.id])
  const intakes = useMemo(
    () => data.intakes.filter((i) => i.client === c.client && i.phones.length > 0),
    [data.intakes, c.client],
  )

  const d = daysUntil(c.next_due)
  const stage = normalizeStage(c.stage)

  // 移动端拍照按钮：优先唤起扫描全能王，唤不醒再提示安装
  const [scanFailed, setScanFailed] = useState(false)
  const [scanBusy, setScanBusy] = useState(false)
  const onScanTap = async () => {
    if (scanBusy) return
    setScanBusy(true)
    try {
      const ok = await openCamScanner()
      if (!ok) setScanFailed(true)
    } finally {
      setScanBusy(false)
    }
  }

  const tabs: { key: Tab; label: string; n?: number }[] = [
    { key: 'overview', label: '概览' },
    { key: 'timeline', label: '时间线', n: timeline.length },
    { key: 'expense', label: '费用', n: expenses.length },
    { key: 'material', label: '文书与证据', n: materials.length },
  ]

  // 移动端：左边缘滑动=返回；屏幕中间左右滑=切换 tab
  const tabOrder: Tab[] = ['overview', 'timeline', 'expense', 'material']
  const turnTab = (dir: 1 | -1) => {
    const next = tabOrder.indexOf(tab) + dir
    if (next < 0 || next >= tabOrder.length) return
    setTab(tabOrder[next])
  }
  const swipeRef = useSwipeNavigation<HTMLDivElement>({
    onBack,
    onPrevTab: () => turnTab(-1),
    onNextTab: () => turnTab(1),
  })

  return (
    <div ref={swipeRef} className="flex-1 overflow-y-auto pb-24 md:pb-0">
      {/* 桌面顶栏 */}
      <div className="hidden md:flex h-14 items-center gap-3 px-6 bg-white border-b border-line sticky top-0 z-10">
        <button
          onClick={onBack}
          aria-label="返回案件台账"
          className="w-8 h-8 flex items-center justify-center text-ink-2 hover:bg-canvas rounded-lg"
        >
          <Icon name="back" className="w-4 h-4" />
        </button>
        <h1 className="text-[15px] font-semibold">{c.client}</h1>
        <span className="text-xs text-ink-3">{c.cause}</span>
        <span
          className={`text-2xs px-2 py-0.5 rounded ${
            stage === '在办' ? 'bg-brand-soft text-brand' : stage === '结案' ? 'bg-[#ECFDF3] text-ok' : 'bg-canvas text-ink-2'
          }`}
        >
          {stage}
        </span>
        <div className="flex-1" />
        <button
          onClick={onEdit}
          className="h-9 px-3 rounded-lg border border-line text-sm text-ink-2 hover:bg-canvas flex items-center gap-1.5"
        >
          <Icon name="settings" className="w-4 h-4" />
          编辑
        </button>
        <button className="h-9 px-3 rounded-lg border border-line text-sm text-ink-2 hover:bg-canvas flex items-center gap-1.5">
          <Icon name="plus" className="w-4 h-4" />
          上传材料
        </button>
        <button className="h-9 px-3 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover">
          生成文书
        </button>
      </div>

      <div className="p-4 md:p-6 space-y-4">
        {/* 案件信息卡 */}
        <div className="bg-white rounded-xl border border-line p-5 shadow-card">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <InfoItem label="委托人">{c.client}</InfoItem>
            <InfoItem label="案由">{c.cause}</InfoItem>
            <InfoItem label="下一节点">
              <span className="block truncate">{c.next_action || '—'}</span>
              <span
                className={`text-2xs ${d !== null && d < 0 ? 'text-danger' : d !== null && d <= 3 ? 'text-danger' : d !== null && d <= 7 ? 'text-warn' : 'text-ink-3'}`}
              >
                {fmtDateTime(c.next_due)}
                {d !== null && (d < 0 ? ` · 逾期${-d}天` : ` · 还有${d}天`)}
              </span>
            </InfoItem>
            <InfoItem label="首次接触">{fmtDate(c.first_contact)}</InfoItem>
            <InfoItem label="签单日">{fmtDate(c.signed_at)}</InfoItem>
          </div>

          {intakes.length > 0 && (
            <div className="mt-4 pt-4 border-t border-line">
              <div className="text-2xs text-ink-3 mb-1.5">联系方式（加密存储）</div>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                {intakes.flatMap((i) =>
                  i.phones.map((p, idx) => (
                    <SecretPhone key={`${i.id}-${idx}`} enc={p.enc} mask={p.mask} />
                  )),
                )}
              </div>
            </div>
          )}
        </div>

        {/* 页签 */}
        <div className="bg-white rounded-xl border border-line shadow-card overflow-hidden">
          {/* data-swipe-tabs：在这条 tab 上左右滑=切换页签（其余区域横向滑=返回） */}
          <div data-swipe-tabs className="flex gap-1 px-3 border-b border-line overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`shrink-0 h-11 px-3 text-sm border-b-2 -mb-px ${
                  tab === t.key ? 'border-brand text-brand font-medium' : 'border-transparent text-ink-2 hover:text-ink'
                }`}
              >
                {t.label}
                {t.n !== undefined && <span className="ml-1 text-2xs text-ink-3">{t.n}</span>}
              </button>
            ))}
          </div>

          <div className="p-5">
            {tab === 'overview' && (
              <div className="space-y-3">
                <div>
                  <div className="text-2xs text-ink-3 mb-1">案件阶段（原始记录）</div>
                  <div className="text-sm">{c.stage || '—'}</div>
                </div>
                <div>
                  <div className="text-2xs text-ink-3 mb-1">详细情况</div>
                  <div className="text-sm leading-relaxed text-ink-2">
                    <SecretText mask={c.detail_mask} enc={c.detail_enc} linkPhone />
                  </div>
                </div>
                {!c.detail_mask && !c.detail_enc && (
                  <div className="text-sm text-ink-3">该案件暂无详细记录</div>
                )}
              </div>
            )}

            {tab === 'timeline' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-2xs text-ink-3">共 {timeline.length} 条记录</span>
                  <button
                    type="button"
                    onClick={onCreateTimeline}
                    className="h-8 px-3 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover flex items-center gap-1"
                  >
                    <Icon name="plus" className="w-3.5 h-3.5" />
                    新增
                  </button>
                </div>
                {timeline.length === 0 ? (
                  <Empty text="暂无时间线记录，点「新增」补充节点" />
                ) : (
                  <ol className="relative pl-5 space-y-4">
                    <span className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-line" />
                    {timeline.map((t) => (
                      <li key={t.id} className="group relative">
                        <span className="absolute -left-5 top-1.5 w-2.5 h-2.5 rounded-full bg-brand ring-4 ring-white" />
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-2xs text-ink-3">{fmtDateTime(t.at)}</div>
                            <div className="text-sm text-ink-2 leading-relaxed mt-0.5">
                              <SecretText mask={t.content_mask} enc={t.content_enc} linkPhone />
                            </div>
                          </div>
                          <RowActions onEdit={() => onEditTimeline(t)} onDelete={() => onDeleteTimeline(t.id)} />
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}

            {tab === 'expense' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-2xs text-ink-3">共 {expenses.length} 条记录</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={toggleAmt}
                      title={amtVisible ? '隐藏金额（客户在场时用）' : '显示金额'}
                      className="h-8 px-2.5 rounded-lg border border-line bg-white text-ink-2 hover:bg-canvas inline-flex items-center gap-1 text-xs"
                    >
                      <Icon name={amtVisible ? 'eye-off' : 'eye'} className="w-3.5 h-3.5" />
                      {amtVisible ? '隐藏金额' : '显示金额'}
                    </button>
                    <button
                      type="button"
                      onClick={onCreateExpense}
                      className="h-8 px-3 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover flex items-center gap-1"
                    >
                      <Icon name="plus" className="w-3.5 h-3.5" />
                      新增
                    </button>
                  </div>
                </div>
                {expenses.length === 0 ? (
                  <Empty text="暂无费用记录，点「新增」登记收支" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-ink-2 text-xs">
                          <th className="text-left font-medium py-2 pr-3">日期</th>
                          <th className="text-left font-medium py-2 pr-3">收支</th>
                          <th className="text-left font-medium py-2 pr-3">分类</th>
                          <th className="text-right font-medium py-2 pl-3 whitespace-nowrap">开票金额</th>
                          <th className="text-left font-medium py-2 px-3">费用详情</th>
                          <th className="text-right font-medium py-2 pl-3 whitespace-nowrap">个人得金额</th>
                          <th className="text-right font-medium py-2 pl-3 w-20">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expenses.map((e) => (
                          <tr key={e.id} className="group border-t border-line">
                            <td className="py-2.5 pr-3 text-ink-2 text-xs whitespace-nowrap">{fmtDate(e.at)}</td>
                            <td className="py-2.5 pr-3">
                              <span
                                className={`text-2xs px-1.5 py-0.5 rounded ${
                                  (e.direction || '').startsWith('收') ? 'bg-[#ECFDF3] text-ok' : 'bg-canvas text-ink-2'
                                }`}
                              >
                                {e.direction || '—'}
                              </span>
                            </td>
                            <td className="py-2.5 pr-3 text-ink-2">{e.category || '—'}</td>
                            <td className="py-2.5 pl-3 text-right tabular-nums">
                              <SecretMoney value={e.amount} />
                            </td>
                            <td className="py-2.5 px-3 text-ink-2">
                              <SecretText mask={e.detail} enc={e.detail_enc} />
                            </td>
                            <td className="py-2.5 pl-3 text-right tabular-nums">
                              <SecretMoney value={e.personal} />
                            </td>
                            <td className="py-2.5 pl-3 text-right">
                              <RowActions onEdit={() => onEditExpense(e)} onDelete={() => onDeleteExpense(e.id)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {tab === 'material' && (
              <MaterialsView data={data} fixedCaseId={c.id} compact />
            )}
          </div>
        </div>
      </div>

      {/* 移动端浮动拍照按钮 */}
      <button
        type="button"
        onClick={onScanTap}
        disabled={scanBusy}
        title="打开扫描全能王"
        className="md:hidden fixed right-4 bottom-20 z-30 w-14 h-14 rounded-full bg-brand text-white shadow-pop flex items-center justify-center disabled:opacity-60"
      >
        <Icon name="camera" className="w-6 h-6" />
      </button>

      <ScanFallbackDialog open={scanFailed} onClose={() => setScanFailed(false)} />

      <div className="md:hidden fixed right-0 top-12">{right}</div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="py-12 text-center text-sm text-ink-3">{text}</div>
}
