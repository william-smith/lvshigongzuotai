import { useState, type ReactNode } from 'react'
import { authEnabled, useAuth } from '../lib/auth'
import { isCloud } from '../lib/data'
import { useVault } from '../store/vault'
import { Icon, type IconName } from './Icon'

export type ViewKey = 'dashboard' | 'cases' | 'expenses' | 'intakes' | 'materials' | 'settings'

const ITEMS: { key: ViewKey; label: string; icon: IconName; badge?: number }[] = [
  { key: 'dashboard', label: '工作台', icon: 'home' },
  { key: 'cases', label: '案件台账', icon: 'case' },
  { key: 'expenses', label: '费用总表', icon: 'money' },
  { key: 'intakes', label: '接案跟踪', icon: 'phone' },
  { key: 'materials', label: '文书与证据', icon: 'file' },
  { key: 'settings', label: '设置', icon: 'settings' },
]

/** 底部 tab 的顺序（左滑→下一个，右滑→上一个） */
export const VIEW_ORDER: ViewKey[] = ITEMS.map((i) => i.key)

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-4 h-14 shrink-0">
      <span className="w-8 h-8 rounded-lg bg-brand text-white flex items-center justify-center">
        <Icon name="scale" className="w-4 h-4" stroke={1.8} />
      </span>
      <span className="text-[15px] font-semibold text-white tracking-tight">律师工作台</span>
    </div>
  )
}

function SyncCard() {
  const { unlocked, lock, requestUnlock } = useVault()
  return (
    <div className="mx-3 mb-3 rounded-lg bg-white/[0.06] border border-white/10 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-emerald-300">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        {isCloud ? '元数据已上云' : '本地演示数据'}
      </div>
      <div className="text-[11px] text-white/40 mt-1 leading-relaxed">
        元数据{isCloud ? '实时同步' : '仅本机'} · 原件点对点同步
      </div>
      <button
        onClick={unlocked ? lock : requestUnlock}
        className="mt-2 w-full h-7 rounded-md bg-white/10 hover:bg-white/15 text-[11px] text-white/80 flex items-center justify-center gap-1.5"
      >
        <Icon name={unlocked ? 'unlock' : 'lock'} className="w-3 h-3" />
        {unlocked ? '锁定敏感信息' : '解锁敏感信息'}
      </button>
    </div>
  )
}

/** 律师信息填写弹窗：姓名/律所存 user_metadata，每个律师自己维护 */
function ProfileDialog({ onClose }: { onClose: () => void }) {
  const { profile, saveProfile, email } = useAuth()
  const [name, setName] = useState(profile?.lawyer_name ?? '')
  const [firm, setFirm] = useState(profile?.firm_name ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    if (!name.trim()) {
      setErr('请填写律师姓名')
      return
    }
    setBusy(true)
    setErr('')
    const r = await saveProfile({ lawyer_name: name, firm_name: firm })
    setBusy(false)
    if (r.ok) onClose()
    else setErr(r.error ?? '保存失败，请稍后重试')
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
        <div className="flex items-center gap-3 mb-1">
          <span className="w-9 h-9 rounded-lg bg-brand-soft text-brand flex items-center justify-center">
            <Icon name="user" className="w-4.5 h-4.5" />
          </span>
          <h2 className="text-base font-semibold text-ink">律师信息</h2>
        </div>
        <p className="text-xs text-ink-2 leading-relaxed mb-4">
          姓名与律所会显示在左侧栏底部，仅保存在你自己的账号下，其他律师看不到、也互不影响。
        </p>

        <label className="block text-xs font-medium text-ink-2 mb-1.5">律师姓名</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="如：张三"
          className="w-full h-11 px-3 rounded-lg border border-line bg-white text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
        />

        <label className="block text-xs font-medium text-ink-2 mt-4 mb-1.5">律所名称</label>
        <input
          value={firm}
          onChange={(e) => setFirm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="如：江苏某某律师事务所"
          className="w-full h-11 px-3 rounded-lg border border-line bg-white text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
        />

        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
        {!email && <p className="mt-2 text-2xs text-ink-3">当前未登录，填写内容无法保存</p>}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 h-10 rounded-lg border border-line text-sm text-ink-2 hover:bg-canvas">
            取消
          </button>
          <button
            onClick={submit}
            disabled={busy || !name.trim()}
            className="flex-1 h-10 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-50"
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Sidebar({
  view,
  onView,
  dueCount,
  onCreate,
  createLabel,
}: {
  view: ViewKey
  onView: (v: ViewKey) => void
  dueCount: number
  onCreate: () => void
  createLabel: string
}) {
  const { logout, profile, email } = useAuth()
  const [profOpen, setProfOpen] = useState(false)
  const confirmLogout = () => {
    if (confirm('退出登录后需要重新输入邮箱密码，确定吗？')) void logout()
  }
  const name = profile?.lawyer_name?.trim() ?? ''
  const firm = profile?.firm_name?.trim() ?? ''
  const avatar = name ? name.slice(0, 1) : email ? email.slice(0, 1).toUpperCase() : '?'
  return (
    <aside className="hidden md:flex w-60 shrink-0 bg-sidebar flex-col">
      <Brand />
      {view !== 'settings' && view !== 'expenses' && (
        <div className="px-3 pt-2">
          <button
            onClick={onCreate}
            className="w-full h-10 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium flex items-center justify-center gap-1.5"
          >
            <Icon name="plus" className="w-4 h-4" />
            {createLabel}
          </button>
        </div>
      )}
      <nav className="flex-1 px-3 pt-4 space-y-0.5 overflow-y-auto">
        {ITEMS.map((it) => {
          const active = view === it.key
          return (
            <button
              key={it.key}
              onClick={() => onView(it.key)}
              className={`w-full h-9 px-3 rounded-lg flex items-center gap-2.5 text-sm transition-colors ${
                active ? 'bg-white/10 text-white' : 'text-white/55 hover:text-white/85 hover:bg-white/[0.05]'
              }`}
            >
              <Icon name={it.icon} className="w-4 h-4" />
              <span className="flex-1 text-left">{it.label}</span>
              {it.key === 'dashboard' && dueCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger/80 text-white">{dueCount}</span>
              )}
            </button>
          )
        })}
      </nav>
      <SyncCard />
      <div className="px-4 h-14 flex items-center gap-2.5 border-t border-white/10 shrink-0">
        <span className="w-8 h-8 rounded-full bg-white/10 text-white/80 text-xs flex items-center justify-center shrink-0">
          {avatar}
        </span>
        <button
          onClick={() => setProfOpen(true)}
          title="点击填写律师姓名与律所"
          className="min-w-0 flex-1 text-left"
        >
          <div className={`text-xs truncate ${name ? 'text-white/85' : 'text-white/45'}`}>
            {name || '点击完善姓名'}
          </div>
          <div className={`text-[10px] truncate ${firm ? 'text-white/35' : 'text-white/25'}`}>
            {firm || '律师姓名 / 律所名称'}
          </div>
        </button>
        {authEnabled && (
          <button
            onClick={confirmLogout}
            title="退出登录"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/40 hover:text-white/85 hover:bg-white/10"
          >
            <Icon name="logout" className="w-4 h-4" />
          </button>
        )}
      </div>
      {profOpen && <ProfileDialog onClose={() => setProfOpen(false)} />}
    </aside>
  )
}

export function BottomTabs({ view, onView }: { view: ViewKey; onView: (v: ViewKey) => void }) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-line pb-[env(safe-area-inset-bottom)]">
      <div className="flex">
        {ITEMS.map((it) => {
          const active = view === it.key
          return (
            <button
              key={it.key}
              onClick={() => onView(it.key)}
              className={`flex-1 h-14 flex flex-col items-center justify-center gap-1 text-[10px] ${
                active ? 'text-brand' : 'text-ink-3'
              }`}
            >
              <Icon name={it.icon} className="w-5 h-5" stroke={active ? 2 : 1.6} />
              {it.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

/** 移动端顶栏（带返回） */
export function MobileBar({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string
  subtitle?: ReactNode
  onBack?: () => void
  right?: ReactNode
}) {
  return (
    <div className="md:hidden sticky top-0 z-20 bg-white border-b border-line">
      <div className="h-12 flex items-center gap-2 px-2">
        {onBack && (
          <button onClick={onBack} className="w-9 h-9 flex items-center justify-center text-ink-2">
            <Icon name="back" className="w-5 h-5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink truncate">{title}</div>
          {subtitle && <div className="text-[11px] text-ink-3 truncate">{subtitle}</div>}
        </div>
        {right}
      </div>
    </div>
  )
}
