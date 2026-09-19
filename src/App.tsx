import { useEffect, useMemo, useState } from 'react'
import { BottomTabs, MobileBar, Sidebar, type ViewKey } from './components/Nav'
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
import { deleteExpense } from './lib/expenseOps'

function Shell() {
  const { session } = useAuth()
  const [data, setData] = useState<Dataset | null>(null)
  const [err, setErr] = useState('')
  const [view, setView] = useState<ViewKey>('dashboard')
  const [caseId, setCaseId] = useState<number | null>(null)
  const [editing, setEditing] = useState<CaseRow | null | undefined>(undefined) // undefined=关闭，null=新建
  const [editingIntake, setEditingIntake] = useState<IntakeRow | null | undefined>(undefined)
  const [editingTimeline, setEditingTimeline] = useState<TimelineRow | null | undefined>(undefined)
  const [editingExpense, setEditingExpense] = useState<ExpenseRow | null | undefined>(undefined)
  const { ready, unlocked, requestUnlock, lock, setVerifier } = useVault()

  // 登出 / 切换账号时清掉本地缓存，避免上一个用户的数据残留在本机
  useEffect(() => {
    if (authEnabled && !session) void clearCachedDataset()
  }, [session])

  useEffect(() => {
    if (authEnabled && !session) return // 没登录就别去读数据，省得报一堆 401
    setErr('')
    let cancelled = false
    let painted = false // 是否已渲染出任何数据（缓存或网络）；用于决定失败时是否报错

    // 1) 先用本地缓存即时出界面（秒开）：后台拉取完成后再覆盖为最新
    void getCachedDataset<Dataset>().then((c) => {
      if (cancelled || !c) return
      painted = true
      setVerifier(c.crypto?.verifier) // 注入口令校验串，输错口令会被拒绝
      setData(c)
    })

    // 2) 后台拉最新数据；到位后覆盖缓存 + 渲染。阶段一中间态只在「尚无任何数据」时
    //    才用（无缓存的首登），避免把已显示的完整缓存回退成「仅案件」造成列表闪空。
    loadDataset((d) => {
      if (painted) return
      painted = true
      setVerifier(d.crypto?.verifier)
      setData(d)
    })
      .then((d) => {
        painted = true
        setVerifier(d.crypto?.verifier)
        setData(d)
        if (isCloud) void setCachedDataset(d) // 仅云端数据入缓存；演示模式不缓存
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

  const goto = (v: ViewKey) => {
    setCaseId(null)
    setView(v)
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
    setData((prev) => {
      if (!prev) return prev
      let finalRow = row
      let expenses = prev.expenses
      if (isNew) {
        const maxId = prev.expenses.reduce((m, e) => Math.max(m, e.id), 0)
        if (!row.id || prev.expenses.some((e) => e.id === row.id)) finalRow = { ...row, id: maxId + 1 }
        expenses = [finalRow, ...prev.expenses]
      } else {
        expenses = prev.expenses.map((e) => (e.id === finalRow.id ? finalRow : e))
      }
      return { ...prev, expenses }
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

  const current = data.cases.find((c) => c.id === caseId) ?? null

  return (
    <div className="h-screen flex bg-canvas text-ink">
      <Sidebar
        view={view}
        onView={goto}
        dueCount={stats.dueSoon.length}
        onCreate={() => (view === 'intakes' ? setEditingIntake(null) : setEditing(null))}
        createLabel={view === 'intakes' ? '新建接案' : '新建案件'}
      />

      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <VaultSetupGuide />
        {caseId && current ? (
          <>
            <MobileBar
              title={current.client}
              subtitle={`${current.cause} · ${current.stage}`}
              onBack={() => setCaseId(null)}
              right={
                <div className="flex items-center">
                  <button
                    onClick={() => setEditing(current)}
                    className="w-9 h-9 flex items-center justify-center text-ink-2"
                    title="编辑案件"
                  >
                    <Icon name="settings" className="w-4 h-4" />
                  </button>
                  <button
                    onClick={unlocked ? lock : requestUnlock}
                    className={`w-9 h-9 flex items-center justify-center ${
                      unlocked ? 'text-brand' : 'text-ink-2'
                    }`}
                    title={unlocked ? '锁定敏感信息' : '解锁敏感信息'}
                  >
                    <Icon name={unlocked ? 'unlock' : 'lock'} className="w-4 h-4" />
                  </button>
                </div>
              }
            />
            <CaseDetail
              c={current}
              data={data}
              onBack={() => setCaseId(null)}
              onEdit={() => setEditing(current)}
              onCreateTimeline={() => setEditingTimeline(null)}
              onEditTimeline={(t) => setEditingTimeline(t)}
              onDeleteTimeline={requestDeleteTimeline}
              onCreateExpense={() => setEditingExpense(null)}
              onEditExpense={(e) => setEditingExpense(e)}
              onDeleteExpense={requestDeleteExpense}
            />

            {editingTimeline !== undefined && (
              <TimelineEditor
                mode={editingTimeline ? 'edit' : 'create'}
                initial={editingTimeline ?? null}
                caseId={current.id}
                onClose={() => setEditingTimeline(undefined)}
                onSaved={onTimelineSaved}
                onDeleted={doDeleteTimeline}
              />
            )}
            {editingExpense !== undefined && (
              <ExpenseEditor
                mode={editingExpense ? 'edit' : 'create'}
                initial={editingExpense ?? null}
                caseId={current.id}
                onClose={() => setEditingExpense(undefined)}
                onSaved={onExpenseSaved}
                onDeleted={doDeleteExpense}
              />
            )}
          </>
        ) : view === 'dashboard' ? (
          <Dashboard data={data} stats={stats} onOpenCase={setCaseId} onViewCases={() => goto('cases')} />
        ) : view === 'cases' ? (
          <CaseList data={data} stats={stats} onOpenCase={setCaseId} onCreateCase={() => setEditing(null)} />
        ) : view === 'expenses' ? (
          <ExpenseTable data={data} onOpenCase={setCaseId} />
        ) : view === 'intakes' ? (
          <IntakesList
            data={data}
            onOpenIntake={(id) => {
              const found = data.intakes.find((i) => i.id === id)
              if (found) setEditingIntake(found)
            }}
            onOpenCase={(id) => {
              setCaseId(id)
              setView('cases')
            }}
            onCreateIntake={() => setEditingIntake(null)}
          />
        ) : view === 'settings' ? (
          <Settings />
        ) : (
          <MaterialsView data={data} onOpenCase={setCaseId} />
        )}
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
