import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { SecretPhone, SecretText } from '../components/SecretText'
import { SecretMoney, useAmountVisible } from '../components/SecretMoney'
import { useSwipeNavigation } from '../lib/gestures'
import { appStores, openScheme } from '../components/ScanLauncher'
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

  // 桌面顶栏「智能体」入口弹窗
  const [agentOpen, setAgentOpen] = useState(false)
  // 移动端相机按钮的「拍照 / 扫描」选择框
  const [captureOpen, setCaptureOpen] = useState(false)

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
        <button
          onClick={() => setAgentOpen(true)}
          className="h-9 px-3 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover flex items-center gap-1.5"
        >
          <Icon name="agent" className="w-4 h-4" />
          智能体
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

      {/* 移动端浮动拍照按钮：弹出「拍照 / 扫描」选择框 */}
      <button
        type="button"
        onClick={() => setCaptureOpen(true)}
        title="拍照 / 扫描"
        className="md:hidden fixed right-4 bottom-20 z-30 w-14 h-14 rounded-full bg-brand text-white shadow-pop flex items-center justify-center"
      >
        <Icon name="camera" className="w-6 h-6" />
      </button>

      <AgentSheet open={agentOpen} onClose={() => setAgentOpen(false)} />
      <CaptureSheet open={captureOpen} onClose={() => setCaptureOpen(false)} />
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="py-12 text-center text-sm text-ink-3">{text}</div>
}

/**
 * 详情页「智能体」入口：材料走 Verysync 同步，不需要在此上传；
 * 「生成文书」改为打开本机智能体 App。
 *
 * 通用性说明（不查本机注册表）：
 * - 列表由配置驱动，预置 WorkBuddy，其余靠用户「添加智能体」自行登记。
 * - 每个智能体可填 scheme://（唤起本机 App，系统弹窗）或 https://（网页版兜底）。
 * - 自定义项存 localStorage，按浏览器/账户隔离，换电脑各自配置即可。
 * - 唤起是否能成功取决于本机是否装了该 App 并注册了对应 scheme，网页无法预知，
 *   只能「试跳一下」再用页面失焦反推；失败则降级打开网页版或提示。
 */
type Agent = { id: string; name: string; desc: string; scheme?: string; web?: string }

const PRESET_AGENTS: Agent[] = [
  { id: 'workbuddy', name: 'WorkBuddy', desc: '本机智能体', scheme: 'workbuddy://', web: 'https://www.workbuddy.cn/' },
]

const AGENT_STORE_KEY = 'lw.agents'

function readCustomAgents(): Agent[] {
  try {
    const raw = localStorage.getItem(AGENT_STORE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function detectPlatform(): 'ios' | 'android' | 'other' {
  const ua = navigator.userAgent || ''
  if (/Android/i.test(ua)) return 'android'
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios'
  if (navigator.platform === 'MacIntel' && (navigator as { maxTouchPoints?: number }).maxTouchPoints! > 1) return 'ios'
  return 'other'
}

function fireUrl(url: string, platform: 'ios' | 'android' | 'other') {
  if (platform === 'ios') {
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = url
    document.body.appendChild(iframe)
    setTimeout(() => iframe.remove(), 1200)
  } else {
    const a = document.createElement('a')
    a.href = url
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    setTimeout(() => a.remove(), 1200)
  }
}

/** 试跳一次，返回「看起来跳走了没」 */
function tryLaunch(url: string, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('blur', onHide)
      resolve(ok)
    }
    const onHide = () => {
      if (document.hidden) finish(true)
    }
    const timer = setTimeout(() => finish(false), timeout)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    window.addEventListener('blur', onHide)
    fireUrl(url, detectPlatform())
  })
}

function AgentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [custom, setCustom] = useState<Agent[]>(() => readCustomAgents())
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [failedId, setFailedId] = useState<string | null>(null)

  // 每次打开重置上次的状态
  useEffect(() => {
    setFailedId(null)
    setAdding(false)
    setName('')
    setUrl('')
  }, [open])

  if (!open) return null

  const all = [...PRESET_AGENTS, ...custom]

  const launch = async (a: Agent) => {
    setFailedId(null)
    if (a.scheme) {
      const ok = await tryLaunch(a.scheme, 1200)
      if (ok) {
        onClose()
        return
      }
    }
    if (a.web) {
      window.open(a.web, '_blank')
      onClose()
      return
    }
    setFailedId(a.id)
  }

  const saveCustom = () => {
    const n = name.trim()
    const u = url.trim()
    if (!n || !u) return
    const isHttp = u.startsWith('http')
    const next: Agent[] = [
      ...custom,
      { id: 'c_' + Date.now(), name: n, desc: '自定义', scheme: isHttp ? undefined : u, web: isHttp ? u : undefined },
    ]
    setCustom(next)
    localStorage.setItem(AGENT_STORE_KEY, JSON.stringify(next))
    setName('')
    setUrl('')
    setAdding(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-pop p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-ink">打开智能体</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-ink-2 hover:bg-canvas rounded-lg"
          >
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-ink-2 mb-4">选择要打开的智能体应用（材料通过 Verysync 同步，无需在本页上传）</p>

        <div className="space-y-2">
          {all.map((a) => (
            <div key={a.id} className="rounded-xl border border-line p-3">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg bg-brand-soft text-brand flex items-center justify-center shrink-0">
                  <Icon name="agent" className="w-4.5 h-4.5" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink">{a.name}</div>
                  <div className="text-2xs text-ink-3 truncate">{a.desc}</div>
                </div>
                <button
                  onClick={() => launch(a)}
                  className="h-8 px-3 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover shrink-0"
                >
                  打开
                </button>
              </div>
              {failedId === a.id && (
                <div className="mt-2 text-2xs text-danger">
                  未能唤起「{a.name}」。
                  {a.web ? (
                    <a href={a.web} target="_blank" rel="noreferrer" className="underline" onClick={onClose}>
                      打开网页版
                    </a>
                  ) : (
                    '本机似乎未安装或系统拦下了跳转，请在桌面端打开。'
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {adding ? (
          <div className="mt-3 rounded-xl border border-line p-3 space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="智能体名称"
              className="w-full h-9 px-3 rounded-lg border border-line text-sm outline-none focus:border-brand"
            />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="唤起地址（scheme:// 或 https://）"
              className="w-full h-9 px-3 rounded-lg border border-line text-sm outline-none focus:border-brand"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setAdding(false)
                  setName('')
                  setUrl('')
                }}
                className="flex-1 h-9 rounded-lg border border-line text-sm text-ink-2"
              >
                取消
              </button>
              <button onClick={saveCustom} className="flex-1 h-9 rounded-lg bg-brand text-white text-sm font-medium">
                保存
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="mt-3 w-full h-9 rounded-lg border border-dashed border-line text-sm text-ink-2 hover:bg-canvas flex items-center justify-center gap-1"
          >
            <Icon name="plus" className="w-4 h-4" />
            添加智能体
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * 移动端相机按钮的「拍照 / 扫描」选择框：
 * - 预置「系统相机」（直接调起原生相机拍照）与「扫描全能王」。
 * - 支持「+ 添加扫描 App」登记任意 scheme://（唤起本机 App）或 https://（网页版兜底），存 localStorage，通用不绑本机。
 * - 系统相机通过 <input capture> 调起，拍完下载到「下载」文件夹，提示用户移入本案 Verysync 同步目录；
 *   网页无法写入任意本地目录，这一步由用户手动完成（与 CamScanner 流程一致）。
 */
type Scanner = {
  id: string
  name: string
  desc: string
  scheme?: string
  web?: string
  capture?: boolean
  /** 未安装时在应用市场里搜什么（默认取 name） */
  keyword?: string
}

const PRESET_SCANNERS: Scanner[] = [
  { id: 'camera', name: '系统相机', desc: '直接用手机相机拍照', capture: true },
  {
    id: 'camscanner',
    name: '扫描全能王',
    desc: '专业文档扫描 / 自动校正',
    scheme: 'camscanner://',
    keyword: '扫描全能王',
  },
]

const SCANNER_STORE_KEY = 'lw.scanners'

function readCustomScanners(): Scanner[] {
  try {
    const raw = localStorage.getItem(SCANNER_STORE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function captureWithCamera(onDone: () => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.capture = 'environment'
  input.onchange = () => {
    const f = input.files?.[0]
    if (!f) return
    const url = URL.createObjectURL(f)
    const a = document.createElement('a')
    a.href = url
    a.download = `IMG_${Date.now()}.jpg`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    onDone()
  }
  input.click()
}

function CaptureSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [custom, setCustom] = useState<Scanner[]>(() => readCustomScanners())
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [failedId, setFailedId] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    setFailedId(null)
    setAdding(false)
    setName('')
    setUrl('')
    setHint(null)
  }, [open])

  if (!open) return null

  const all = [...PRESET_SCANNERS, ...custom]

  const launch = async (s: Scanner) => {
    setFailedId(null)
    setHint(null)
    if (s.capture) {
      captureWithCamera(() => setHint('照片已下载到「下载」文件夹，请移入本案的 Verysync 同步目录'))
      return
    }
    if (s.scheme) {
      const ok = await openScheme(s.scheme)
      if (ok) {
        onClose()
        return
      }
      // 唤起失败：就地提示，不自动跳转，避免浏览器（如 Edge）误拉起应用商店
      setFailedId(s.id)
      return
    }
    if (s.web) {
      // 纯网页版 App（无 scheme）：直接打开网页，无应用商店跳转问题
      window.open(s.web, '_blank')
      onClose()
      return
    }
    setFailedId(s.id)
  }

  const saveCustom = () => {
    const n = name.trim()
    const u = url.trim()
    if (!n || !u) return
    const isHttp = u.startsWith('http')
    const next: Scanner[] = [
      ...custom,
      { id: 'c_' + Date.now(), name: n, desc: '自定义扫描 App', scheme: isHttp ? undefined : u, web: isHttp ? u : undefined },
    ]
    setCustom(next)
    localStorage.setItem(SCANNER_STORE_KEY, JSON.stringify(next))
    setName('')
    setUrl('')
    setAdding(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-pop p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-ink">拍照 / 扫描</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-ink-2 hover:bg-canvas rounded-lg"
          >
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-ink-2 mb-4">选择拍照或扫描方式（材料通过 Verysync 同步，无需在此上传）</p>

        <div className="space-y-2">
          {all.map((s) => (
            <div key={s.id} className="rounded-xl border border-line p-3">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg bg-brand-soft text-brand flex items-center justify-center shrink-0">
                  <Icon name={s.capture ? 'camera' : 'agent'} className="w-4.5 h-4.5" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink">{s.name}</div>
                  <div className="text-2xs text-ink-3 truncate">{s.desc}</div>
                </div>
                <button
                  onClick={() => launch(s)}
                  className="h-8 px-3 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover shrink-0"
                >
                  {s.capture ? '拍照' : '打开'}
                </button>
              </div>
              {failedId === s.id && (
                <div className="mt-2 pt-2 border-t border-line">
                  {!s.scheme && s.web ? (
                    <a href={s.web} target="_blank" rel="noreferrer" className="text-2xs text-danger underline">
                      打开网页版
                    </a>
                  ) : (
                    <>
                      <div className="text-2xs text-danger">
                        没能唤起{s.name}，可能未安装或被系统拦下。可在应用市场搜索「{s.keyword || s.name}」安装：
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {appStores(s.keyword || s.name).map((st) => (
                          <a
                            key={st.id}
                            href={st.url}
                            target="_blank"
                            rel="noreferrer"
                            className={`px-2 py-1 rounded-md border text-2xs hover:bg-canvas ${
                              st.recommend ? 'border-brand text-brand' : 'border-line text-ink-2'
                            }`}
                          >
                            {st.name}
                          </a>
                        ))}
                      </div>
                      <div className="mt-1 text-2xs text-ink-3">
                        部分厂商市场没有公开的搜索链接，打开后请在市场内搜索上面的关键词。
                      </div>
                    </>
                  )}
                </div>
              )}
              {hint && s.capture && <div className="mt-2 text-2xs text-ink-3">{hint}</div>}
            </div>
          ))}
        </div>

        {adding ? (
          <div className="mt-3 rounded-xl border border-line p-3 space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="扫描 App 名称"
              className="w-full h-9 px-3 rounded-lg border border-line text-sm outline-none focus:border-brand"
            />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="唤起地址（scheme:// 或 https://）"
              className="w-full h-9 px-3 rounded-lg border border-line text-sm outline-none focus:border-brand"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setAdding(false)
                  setName('')
                  setUrl('')
                }}
                className="flex-1 h-9 rounded-lg border border-line text-sm text-ink-2"
              >
                取消
              </button>
              <button onClick={saveCustom} className="flex-1 h-9 rounded-lg bg-brand text-white text-sm font-medium">
                保存
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="mt-3 w-full h-9 rounded-lg border border-dashed border-line text-sm text-ink-2 hover:bg-canvas flex items-center justify-center gap-1"
          >
            <Icon name="plus" className="w-4 h-4" />
            添加扫描 App
          </button>
        )}
      </div>
    </div>
  )
}
