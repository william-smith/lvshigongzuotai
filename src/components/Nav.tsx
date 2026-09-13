import type { ReactNode } from 'react'
import { authEnabled, useAuth } from '../lib/auth'
import { isCloud } from '../lib/data'
import { useVault } from '../store/vault'
import { Icon, type IconName } from './Icon'

export type ViewKey = 'dashboard' | 'cases' | 'intakes' | 'materials' | 'settings'

const ITEMS: { key: ViewKey; label: string; icon: IconName; badge?: number }[] = [
  { key: 'dashboard', label: '工作台', icon: 'home' },
  { key: 'cases', label: '案件台账', icon: 'case' },
  { key: 'intakes', label: '接案跟踪', icon: 'phone' },
  { key: 'materials', label: '文书与证据', icon: 'file' },
  { key: 'settings', label: '设置', icon: 'settings' },
]

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
  const { logout } = useAuth()
  const confirmLogout = () => {
    if (confirm('退出登录后需要重新输入邮箱密码，确定吗？')) void logout()
  }
  return (
    <aside className="hidden md:flex w-60 shrink-0 bg-sidebar flex-col">
      <Brand />
      {view !== 'settings' && (
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
        <div className="pt-3 mt-3 border-t border-white/10 space-y-0.5">
          {[{ label: '归档卷宗', icon: 'archive' as IconName }].map((it) => (
            <button
              key={it.label}
              disabled
              className="w-full h-9 px-3 rounded-lg flex items-center gap-2.5 text-sm text-white/25 cursor-not-allowed"
            >
              <Icon name={it.icon} className="w-4 h-4" />
              <span className="flex-1 text-left">{it.label}</span>
              <span className="text-[10px]">待建</span>
            </button>
          ))}
        </div>
      </nav>
      <SyncCard />
      <div className="px-4 h-14 flex items-center gap-2.5 border-t border-white/10 shrink-0">
        <span className="w-8 h-8 rounded-full bg-white/10 text-white/80 text-xs flex items-center justify-center">景</span>
        <div className="min-w-0">
          <div className="text-xs text-white/85 truncate">景黎明</div>
          <div className="text-[10px] text-white/35 truncate">江苏维尔达律师事务所</div>
        </div>
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
