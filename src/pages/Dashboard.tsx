import { Icon } from '../components/Icon'
import { authEnabled, useAuth } from '../lib/auth'
import { daysUntil, fmtDateTime, normalizeStage, type CaseRow, type Dataset } from '../lib/types'

export function Dashboard({
  data,
  stats,
  onOpenCase,
  onViewCases,
}: {
  data: Dataset
  stats: { total: number; active: number; closed: number; thisMonth: number; dueSoon: CaseRow[] }
  onOpenCase: (id: number) => void
  onViewCases: () => void
}) {
  const { logout } = useAuth()
  const today = new Date()
  const dateStr = `${today.getMonth() + 1}月${today.getDate()}日`

  const confirmLogout = () => {
    if (confirm('退出登录后需要重新输入邮箱密码，确定吗？')) void logout()
  }

  const focus = [...stats.dueSoon]
    .sort((a, b) => (a.next_due ?? '').localeCompare(b.next_due ?? ''))
    .slice(0, 6)

  const grid = [
    { label: '在办案件', value: stats.active },
    { label: '本月节点', value: stats.thisMonth },
    { label: '临期事项', value: stats.dueSoon.length },
    { label: '已结案', value: stats.closed },
  ]

  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="hidden md:flex h-14 items-center gap-3 px-6 bg-white border-b border-line sticky top-0 z-10">
        <h1 className="text-[15px] font-semibold">工作台</h1>
        <span className="text-xs text-ink-3">
          {dateStr} · {stats.dueSoon.length} 项待办
        </span>
      </div>

      <div className="p-4 md:p-6 space-y-4 max-w-5xl">
        {/* 头部 */}
        <div className="md:hidden flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">工作台</h1>
            <p className="text-xs text-ink-3 mt-0.5">
              {dateStr} · {stats.dueSoon.length} 项待办
            </p>
          </div>
          <button
            onClick={confirmLogout}
            title={authEnabled ? '退出登录' : '本地演示模式'}
            className="w-9 h-9 rounded-full bg-brand-soft text-brand text-sm flex items-center justify-center"
          >
            {authEnabled ? '景' : <Icon name="device" className="w-4 h-4" />}
          </button>
        </div>

        {/* 临期提醒 */}
        {stats.dueSoon.length > 0 && (
          <div className="bg-[#FEF3F2] border border-[#FECDCA] rounded-xl p-4">
            <div className="flex items-center gap-2 text-danger text-sm font-medium">
              <Icon name="clock" className="w-4 h-4" />
              临期提醒 · {stats.dueSoon.length} 项
            </div>
            <div className="mt-3 space-y-2">
              {focus.map((c) => {
                const d = daysUntil(c.next_due)
                return (
                  <button key={c.id} onClick={() => onOpenCase(c.id)} className="w-full text-left flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-danger shrink-0" />
                    <span className="text-sm font-medium">{c.client}</span>
                    <span className="text-xs text-ink-2 truncate flex-1">{c.next_action || '待办'}</span>
                    <span className="text-xs text-danger shrink-0">{d === 0 ? '今天' : `${d} 天`}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* 统计 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {grid.map((g) => (
            <div key={g.label} className="bg-white rounded-xl border border-line p-4 shadow-card">
              <div className="text-xs text-ink-2">{g.label}</div>
              <div className="text-2xl font-semibold mt-1 tabular-nums">{g.value}</div>
            </div>
          ))}
        </div>

        {/* 今日关注 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold">今日关注</h2>
            <button onClick={onViewCases} className="text-xs text-brand">
              查看全部 {stats.total} 件
            </button>
          </div>
          <div className="space-y-2">
            {focus.slice(0, 3).map((c) => (
              <button
                key={c.id}
                onClick={() => onOpenCase(c.id)}
                className="w-full text-left bg-white rounded-xl border border-line p-4 shadow-card"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{c.client}</div>
                    <div className="text-xs text-ink-2 mt-0.5">
                      {c.cause} · {c.stage}
                    </div>
                  </div>
                  <span className="text-2xs px-2 py-0.5 rounded bg-brand-soft text-brand shrink-0">
                    {normalizeStage(c.stage)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-2.5 text-xs text-ink-3">
                  <Icon name="clock" className="w-3.5 h-3.5" />
                  {fmtDateTime(c.next_due)} · {c.next_action || '待办'}
                </div>
              </button>
            ))}
            {focus.length === 0 && (
              <div className="bg-white rounded-xl border border-line p-8 text-center text-sm text-ink-3 shadow-card">
                近 7 天没有到期事项
              </div>
            )}
          </div>
        </div>

        {/* 说明 */}
        <div className="bg-white rounded-xl border border-line p-4 text-xs text-ink-2 leading-relaxed shadow-card">
          <div className="font-medium text-ink mb-1">数据在哪里</div>
          案件台账、期限、费用索引保存在云端数据库（元数据，不含当事人隐私原文）；手机号、伤情、
          跟踪记录在你的设备上加密后才写入，服务器只有密文。证据原件与扫描件只存在你的电脑和手机，
          通过点对点加密同步，不经过任何服务器。
          <span className="block mt-1.5 text-ink-3">
            本页共 {data.cases.length} 件案件 · {data.intakes.length} 条接案线索 · {data.timeline.length} 条时间线
          </span>
        </div>
      </div>
    </div>
  )
}
