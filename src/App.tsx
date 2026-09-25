import { useCallback, useEffect, useMemo, useRef, useState, type AnimationEvent, type TouchEvent } from 'react'
import { BottomTabs, MobileBar, Sidebar, VIEW_ORDER, type ViewKey } from './components/Nav'
import { UnlockDialog } from './components/UnlockDialog'
import { VaultSetupGuide } from './components/VaultSetupGuide'
import { Icon } from './components/Icon'
import { AuthProvider, authEnabled, useAuth } from './lib/auth'
import { isCloud, loadDataset } from './lib/data'
import { clearCachedDataset, getCachedDataset, setCachedDataset } from './lib/datasetCache'
import { Login } from './pages/Login'
import { daysUntil, normalizeStage, type CaseRow, type Dataset, type ExpenseRow, type IntakeRow, type TimelineRow } from './lib/types'
import { useVault } from './store/vault'
import { CaseDetail } from './pages/CaseDetail'
import { CaseEditor } from './pages/CaseEditor'
import { CaseList } from './pages/CaseList'
import { ExpenseTable } from './pages/ExpenseTable'
import { Dashboard } from './pages/Dashboard'
import { IntakesList } from './pages/IntakesList'
import { IntakeEditor } from './pages/IntakeEditor'
import { TimelineEditor } from './pages/TimelineEditor'
import { ExpenseEditor } from './pages/ExpenseEditor'
import { MaterialsView } from './pages/MaterialsView'
import { Settings } from './pages/Settings'
import { deleteTimeline } from './lib/timelineOps'
import { deleteExpense, decryptExpenses } from './lib/expenseOps'

/** 刷新后恢复上次停留的界面（顶部 tab + 是否打开案件详情） */
const VIEW_STATE_KEY = 'lw.view.v1'
function loadViewState(): { view: ViewKey; caseId: number | null } {
  try {
    const raw = localStorage.getItem(VIEW_STATE_KEY)
    if (!raw) return { view: 'dashboard', caseId: null }
    const o = JSON.parse(raw) as { view?: unknown; caseId?: unknown }
    const view = VIEW_ORDER.includes(o.view as ViewKey) ? (o.view as ViewKey) : 'dashboard'
    const caseId = typeof o.caseId === 'number' ? o.caseId : null
    return { view, caseId }
  } catch {
    return { view: 'dashboard', caseId: null }
  }
}

function Shell() {
  const { session } = useAuth()
  const [data, setData] = useState<Dataset | null>(null)
  const [err, setErr] = useState('')
  const [view, setView] = useState<ViewKey>(() => loadViewState().view)
  const [caseId, setCaseId] = useState<number | null>(() => loadViewState().caseId)
  const [editing, setEditing] = useState<CaseRow | null | undefined>(undefined) // undefined=关闭，null=新建
  const [editingIntake, setEditingIntake] = useState<IntakeRow | null | undefined>(undefined)
  const [editingTimeline, setEditingTimeline] = useState<TimelineRow | null | undefined>(undefined)
  const [editingExpense, setEditingExpense] = useState<ExpenseRow | null | undefined>(undefined)
  const { ready, unlocked, requestUnlock, lock, setVerifier, key } = useVault()

  /** 视图切换的 iOS 式双面板交叉滑动：切换时同时渲染「旧面板(滑出) + 新面板(滑入)」，
   *  动画结束(onAnimationEnd)后清掉旧面板，回到单面板常态。dir: 'l'=下一页/打开，'r'=上一页/返回 */
  type Trans = { prevView: ViewKey; prevCaseId: number | null; dir: 'l' | 'r'; active: boolean }
  const [trans, setTrans] = useState<Trans | null>(null)
  const prefersReduced = () =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  /** 动画结束后卸载旧面板（只认当前面板自身的 animationend，忽略子元素冒泡） */
  const endTransition = (e: AnimationEvent) => {
    if (e.target !== e.currentTarget) return
    setTrans(null)
  }

  // 费用金额是密文入库的：原始数据（含 *_enc）留一份在 ref 里，
  // 解锁/加锁时用它重新解密——加锁后再解锁不能把金额变成 null。
  const rawRef = useRef<Dataset | null>(null)
  const keyRef = useRef<CryptoKey | null>(null)
  keyRef.current = key

  /** 数据入口：注入校验串 → 解密费用金额 → 才放进 state 渲染 */
  const pushData = useCallback(async (d: Dataset) => {
    rawRef.current = d
    setVerifier(d.crypto?.verifier)
    const expenses = await decryptExpenses(d.expenses ?? [], keyRef.current)
    setData({ ...d, expenses })
  }, [setVerifier])

  // 解锁状态变化（解锁、加锁、换口令）→ 用原始数据重算一次金额
  useEffect(() => {
    const raw = rawRef.current
    if (!raw) return
    let cancelled = false
    void decryptExpenses(raw.expenses ?? [], key).then((expenses) => {
      if (!cancelled) setData((prev) => (prev ? { ...prev, expenses } : prev))
    })
    return () => {
      cancelled = true
    }
  }, [key])

  // 登出 / 切换账号时清掉本地缓存，避免上一个用户的数据残留在本机
  useEffect(() => {
    if (authEnabled && !session) void clearCachedDataset()
  }, [session])

  // 刷新后保留当前停留的界面（tab + 是否打开案件详情）
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({ view, caseId }))
    } catch {
      /* 隐私模式等忽略 */
    }
  }, [view, caseId])

  useEffect(() => {
    if (authEnabled && !session) return // 没登录就别去读数据，省得报一堆 401
    setErr('')
    let cancelled = false
    let painted = false // 是否已渲染出任何数据（缓存或网络）；用于决定失败时是否报错

    // 1) 先用本地缓存即时出界面（秒开）：后台拉取完成后再覆盖为最新
    void getCachedDataset<Dataset>().then((c) => {
      if (cancelled || !c) return
      painted = true
      void pushData(c) // 注入校验串 + 解密金额
    })

    // 2) 后台拉最新数据；到位后覆盖缓存 + 渲染。阶段一中间态只在「尚无任何数据」时
    //    才用（无缓存的首登），避免把已显示的完整缓存回退成「仅案件」造成列表闪空。
    loadDataset((d) => {
      if (painted) return
      painted = true
      void pushData(d)
    })
      .then((d) => {
        painted = true
        void pushData(d)
        if (isCloud) void setCachedDataset(d) // 仅云端数据入缓存（缓存里仍是密文）；演示模式不缓存
      })
      .catch((e: Error) => {
        if (!painted) setErr(e.message) // 缓存也没有、网络又失败才报错
      })

    return () => {
      cancelled = true
    }
  }, [session])

  const stats = useMemo(() => {
    const cases = data?.cases ?? []
    const active = cases.filter((c) => (c.stage_norm || normalizeStage(c.stage)) === '在办')
    // 临期 / 本月节点只看在办案件：已结案、解除委托的案件挂着的是过期节点，不该再提醒
    // 含「已逾期」（d < 0）与「未来 7 天内到期」两类；逾期越久越靠前
    const dueSoon = active.filter((c) => {
      const d = daysUntil(c.next_due)
      return d !== null && d <= 7
    })
    const closed = cases.filter((c) => ['结案', '解除委托'].includes(c.stage_norm || normalizeStage(c.stage)))
    const thisMonth = active.filter((c) => {
      if (!c.next_due) return false
      const now = new Date()
      return c.next_due.slice(0, 7) === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    })
    return { total: cases.length, active: active.length, dueSoon, closed: closed.length, thisMonth: thisMonth.length }
  }, [data])

  /** 切换底部 tab（iOS 式交叉横滑）：按 tab 顺序比较决定滑动方向；切换动画进行中忽略新的手势/点击 */
  const goto = (v: ViewKey) => {
    if (trans) return
    const from = VIEW_ORDER.indexOf(view)
    const to = VIEW_ORDER.indexOf(v)
    const dir: 'l' | 'r' = to >= from ? 'l' : 'r'
    if (prefersReduced()) {
      setCaseId(null)
      setView(v)
      return
    }
    setTrans({ prevView: view, prevCaseId: caseId, dir, active: true })
    setCaseId(null)
    setView(v)
  }

  /** 打开案件详情：新面板从右侧滑入（同时旧面板向左滑出） */
  const openCase = (id: number, v?: ViewKey) => {
    if (trans) return
    if (v) setView(v)
    if (prefersReduced()) {
      setCaseId(id)
      return
    }
    setTrans({ prevView: view, prevCaseId: caseId, dir: 'l', active: true })
    setCaseId(id)
  }

  /** 从案件详情返回列表。
   *  dir 默认 'r'（右滑返回：旧面板向右滑出）；详情页在序列末尾继续左滑退出时传 'l'，
   *  让动效方向与手指方向一致（向左滑出）。 */
  const backFromCase = (dir: 'l' | 'r' = 'r') => {
    if (trans) return
    if (prefersReduced()) {
      setCaseId(null)
      return
    }
    setTrans({ prevView: view, prevCaseId: caseId, dir, active: true })
    setCaseId(null)
  }

  /** 渲染某个视图（tab 或案件详情）的内容；双面板过渡时旧/新两屏都会调用它各渲染一次 */
  const renderContent = (v: ViewKey, cid: number | null) => {
    if (!data) return null
    const cur = cid != null ? (data.cases.find((c) => c.id === cid) ?? null) : null
    if (cid != null && cur) {
      return (
        <>
          <MobileBar
            title={cur.client}
            subtitle={`${cur.cause} · ${cur.stage}`}
            onBack={backFromCase}
            right={
              <div className="flex items-center">
                <button onClick={() => setEditing(cur)} className="w-9 h-9 flex items-center justify-center text-ink-2" title="编辑案件">
                  <Icon name="settings" className="w-4 h-4" />
                </button>
                <button
                  onClick={unlocked ? lock : requestUnlock}
                  className={`w-9 h-9 flex items-center justify-center ${unlocked ? 'text-brand' : 'text-ink-2'}`}
                  title={unlocked ? '锁定敏感信息' : '解锁敏感信息'}
                >
                  <Icon name={unlocked ? 'unlock' : 'lock'} className="w-4 h-4" />
                </button>
              </div>
            }
          />
          <CaseDetail
            c={cur}
            data={data}
            onBack={backFromCase}
            onExitBySwipe={() => backFromCase('l')}
            onEdit={() => setEditing(cur)}
            onCreateTimeline={() => setEditingTimeline(null)}
            onEditTimeline={(t) => setEditingTimeline(t)}
            onDeleteTimeline={requestDeleteTimeline}
            onCreateExpense={() => setEditingExpense(null)}
            onEditExpense={(e) => setEditingExpense(e)}
            onDeleteExpense={requestDeleteExpense}
          />
          {editingTimeline !== undefined && (
            <TimelineEditor mode={editingTimeline ? 'edit' : 'create'} initial={editingTimeline ?? null} caseId={cur.id} onClose={() => setEditingTimeline(undefined)} onSaved={onTimelineSaved} onDeleted={doDeleteTimeline} />
          )}
          {editingExpense !== undefined && (
            <ExpenseEditor mode={editingExpense ? 'edit' : 'create'} initial={editingExpense ?? null} caseId={cur.id} onClose={() => setEditingExpense(undefined)} onSaved={onExpenseSaved} onDeleted={doDeleteExpense} />
          )}
        </>
      )
    }
    switch (v) {
      case 'dashboard':
        return <Dashboard data={data} stats={stats} onOpenCase={openCase} onViewCases={() => goto('cases')} />
      case 'cases':
        return <CaseList data={data} stats={stats} onOpenCase={openCase} onCreateCase={() => setEditing(null)} />
      case 'expenses':
        return <ExpenseTable data={data} onOpenCase={openCase} />
      case 'intakes':
        return (
          <IntakesList
            data={data}
            onOpenIntake={(id) => {
              const found = data.intakes.find((i) => i.id === id)
              if (found) setEditingIntake(found)
            }}
            onOpenCase={(id) => openCase(id, 'cases')}
            onCreateIntake={() => setEditingIntake(null)}
          />
        )
      case 'settings':
        return <Settings />
      default:
        return <MaterialsView data={data} onOpenCase={openCase} />
    }
  }

  // 移动端横向手势：左滑切到下一个 tab / 打开下一块；右滑切上一个 tab
  // ⚠️ 案件详情页（caseId != null）时页面层完全交出手势——详情页内部是一条
  //    「4 个子页签 + 退出」的 5 位置序列，由 CaseDetail 自己按序推进，
  //    页面层若也响应会造成一次滑动触发两个动作（翻页 + 退出）。
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null)
  const onTouchStart = (e: TouchEvent) => {
    // 编辑器/弹层打开时不响应手势，避免误触
    if (editing !== undefined || editingIntake !== undefined || editingTimeline !== undefined || editingExpense !== undefined) {
      touchStart.current = null
      return
    }
    // 详情页内横滑全部交给 CaseDetail 处理
    if (caseId != null) {
      touchStart.current = null
      return
    }
    const t = e.touches[0]
    touchStart.current = { x: t.clientX, y: t.clientY, t: Date.now() }
  }
  const onTouchEnd = (e: TouchEvent) => {
    const s = touchStart.current
    touchStart.current = null
    if (!s) return
    const t = e.changedTouches[0]
    const dx = t.clientX - s.x
    const dy = t.clientY - s.y
    const adx = Math.abs(dx)
    const ady = Math.abs(dy)
    // 必须横向主导且位移够大、速度够快，才当作切换手势（不干扰纵向滚动/拖拽）
    if (adx < 64 || adx < ady * 1.3 || Date.now() - s.t > 800) return
    const i = VIEW_ORDER.indexOf(view)
    if (dx < 0 && i < VIEW_ORDER.length - 1) goto(VIEW_ORDER[i + 1])
    else if (dx > 0 && i > 0) goto(VIEW_ORDER[i - 1])
  }

  // 案件保存后回写本地数据（demo 与 cloud 都走这一步，让 UI 立即反映）
  const onCaseSaved = (row: CaseRow, isNew: boolean) => {
    setData((prev) => {
      if (!prev) return prev
      const cases = isNew ? [row, ...prev.cases] : prev.cases.map((c) => (c.id === row.id ? { ...c, ...row } : c))
      return { ...prev, cases }
    })
    setEditing(undefined)
    if (isNew) setCaseId(row.id)
  }
  const onCaseDeleted = (id: number) => {
    setData((prev) => (prev ? { ...prev, cases: prev.cases.filter((c) => c.id !== id) } : prev))
    setEditing(undefined)
    setCaseId(null)
  }

  // 接案保存/删除回写
  const onIntakeSaved = (row: IntakeRow, isNew: boolean) => {
    setData((prev) => {
      if (!prev) return prev
      const intakes = isNew ? [row, ...prev.intakes] : prev.intakes.map((i) => (i.id === row.id ? { ...i, ...row } : i))
      return { ...prev, intakes }
    })
    setEditingIntake(undefined)
  }
  const onIntakeDeleted = (id: number) => {
    setData((prev) => (prev ? { ...prev, intakes: prev.intakes.filter((i) => i.id !== id) } : prev))
    setEditingIntake(undefined)
  }

  // 时间线保存/删除回写
  const onTimelineSaved = (row: TimelineRow, isNew: boolean) => {
    setData((prev) => {
      if (!prev) return prev
      let finalRow = row
      let timeline = prev.timeline
      if (isNew) {
        const maxId = prev.timeline.reduce((m, t) => Math.max(m, t.id), 0)
        if (!row.id || prev.timeline.some((t) => t.id === row.id)) finalRow = { ...row, id: maxId + 1 }
        timeline = [finalRow, ...prev.timeline]
      } else {
        timeline = prev.timeline.map((t) => (t.id === finalRow.id ? finalRow : t))
      }
      return { ...prev, timeline }
    })
    setEditingTimeline(undefined)
  }
  const doDeleteTimeline = async (id: number) => {
    try {
      await deleteTimeline(id)
    } catch (e) {
      window.alert('删除失败：' + (e as Error).message)
      return
    }
    setData((prev) => (prev ? { ...prev, timeline: prev.timeline.filter((t) => t.id !== id) } : prev))
    setEditingTimeline(undefined)
  }
  const requestDeleteTimeline = (id: number) => {
    if (!window.confirm('确认删除这条时间线记录？此操作不可撤销。')) return
    void doDeleteTimeline(id)
  }

  // 费用保存/删除回写
  const onExpenseSaved = (row: ExpenseRow, isNew: boolean) => {
    // 保存回包是数据库原始行：ENC_ONLY 下 amount/personal 明文列恒为 null，
    // 不解密直接入 state，列表就会把刚保存的金额显示成「—」（要刷新一次才恢复）。
    void decryptExpenses([row], keyRef.current)
      .catch(() => [row])
      .then(([dec]) => {
        const saved = dec ?? row
        let finalId = saved.id
        if (isNew) {
          const rawList = rawRef.current?.expenses ?? []
          const maxId = rawList.reduce((m, e) => Math.max(m, e.id), 0)
          if (!finalId || rawList.some((e) => e.id === finalId)) finalId = maxId + 1
        }
        const apply = (list: ExpenseRow[]): ExpenseRow[] => {
          const r = { ...saved, id: finalId }
          if (isNew) {
            return list.some((e) => e.id === finalId)
              ? list.map((e) => (e.id === finalId ? r : e))
              : [r, ...list]
          }
          return list.map((e) => (e.id === finalId ? r : e))
        }
        // rawRef（密文原始数据）同步更新：加锁/解锁重算金额以它为准，否则会回退到编辑前的旧值
        if (rawRef.current) rawRef.current = { ...rawRef.current, expenses: apply(rawRef.current.expenses) }
        setData((prev) => (prev ? { ...prev, expenses: apply(prev.expenses) } : prev))
      })
    setEditingExpense(undefined)
  }
  const doDeleteExpense = async (id: number) => {
    try {
      await deleteExpense(id)
    } catch (e) {
      window.alert('删除失败：' + (e as Error).message)
      return
    }
    setData((prev) => (prev ? { ...prev, expenses: prev.expenses.filter((e) => e.id !== id) } : prev))
    setEditingExpense(undefined)
  }
  const requestDeleteExpense = (id: number) => {
    if (!window.confirm('确认删除这条费用记录？此操作不可撤销。')) return
    void doDeleteExpense(id)
  }

  if (!ready || !data) {
    return (
      <div className="h-screen flex items-center justify-center text-ink-3 text-sm bg-canvas">
        {err ? <span className="text-danger">加载失败：{err}</span> : '正在载入案件数据…'}
      </div>
    )
  }

  // 切换动画进行中：旧面板仍在，忽略新的滑动手势，避免动画被中途打断错位
  if (trans) touchStart.current = null

  return (
    <div className="h-screen flex bg-canvas text-ink">
      <Sidebar
        view={view}
        onView={goto}
        dueCount={stats.dueSoon.length}
        onCreate={() => (view === 'intakes' ? setEditingIntake(null) : setEditing(null))}
        createLabel={view === 'intakes' ? '新建接案' : '新建案件'}
      />

      <main
        className="flex-1 min-w-0 flex flex-col overflow-hidden swipe-x"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <VaultSetupGuide />
        <div className={`relative flex-1 min-w-0 overflow-hidden ${trans ? 'pointer-events-none' : ''}`}>
          {trans ? (
            <>
              {/* 旧面板：向离开方向整屏滑出（轻微淡出） */}
              <div className={`lw-pane lw-exit-${trans.dir}`}>{renderContent(trans.prevView, trans.prevCaseId)}</div>
              {/* 新面板：从进入方向整屏滑入；动画结束卸载旧面板 */}
              <div className={`lw-pane lw-enter-${trans.dir}`} onAnimationEnd={endTransition}>
                {renderContent(view, caseId)}
              </div>
            </>
          ) : (
            <div className="h-full min-w-0 flex flex-col overflow-hidden">{renderContent(view, caseId)}</div>
          )}
        </div>
      </main>

      <BottomTabs view={view} onView={goto} />
      <UnlockDialog />

      {editing !== undefined && (
        <CaseEditor
          mode={editing ? 'edit' : 'create'}
          initial={editing}
          onClose={() => setEditing(undefined)}
          onSaved={onCaseSaved}
          onDeleted={onCaseDeleted}
        />
      )}

      {editingIntake !== undefined && (
        <IntakeEditor
          mode={editingIntake ? 'edit' : 'create'}
          initial={editingIntake}
          onClose={() => setEditingIntake(undefined)}
          onSaved={onIntakeSaved}
          onDeleted={onIntakeDeleted}
        />
      )}
    </div>
  )
}

/** 登录门：接了云端就必须先登录，本地演示数据直接放行 */
function Gate() {
  const { ready, session } = useAuth()
  if (!ready) {
    // 隔夜再打开时这里会停留 1~3 秒：正在用 refresh_token 静默续期，
    // 续期成功就直接进主界面（不必重新登录）；失败才回登录页。
    return (
      <div className="h-screen flex items-center justify-center text-ink-3 text-sm bg-canvas">
        正在恢复登录状态…
      </div>
    )
  }
  if (authEnabled && !session) return <Login />
  return <Shell />
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
