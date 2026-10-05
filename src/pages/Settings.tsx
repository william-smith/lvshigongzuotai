import { useEffect, useState, type ReactNode } from 'react'
import { Icon, type IconName } from '../components/Icon'
import { authEnabled, changePassword, useAuth } from '../lib/auth'
import { isCloud } from '../lib/data'
import { activeBackend, clearCustom, readCustom, writeCustom } from '../lib/apiConfig'
import { DataSync } from '../components/DataSync'
import { deriveKey, persistKey, verifyKey } from '../lib/crypto'
import { reencryptVault } from '../lib/vault'
import {
  clearLocalToken,
  currentBackend,
  ensureToken,
  revokeToken,
  subscriptionConfigured,
  subscriptionUrl,
} from '../lib/ical'

/** 设置页分组容器：统一的小标题 + 图标 + 描述，下面卡片堆叠 */
function Section({
  icon,
  title,
  desc,
  aside,
  children,
}: {
  icon: IconName
  title: string
  desc?: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mt-8 first:mt-1">
      <div className="flex items-center gap-2.5 px-1">
        <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-brand/10 text-brand">
          <Icon name={icon} className="w-4 h-4" />
        </span>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {desc ? (
        <p className="px-1 mt-1.5 mb-3 text-xs text-ink-3 leading-relaxed">{desc}</p>
      ) : (
        <div className="h-3" />
      )}
      <div className="space-y-4">{children}</div>
    </section>
  )
}

/** 律师信息卡：姓名/律所由每个律师自己填写，存 user_metadata（按账号隔离） */
function ProfileCard() {
  const { profile, saveProfile, email } = useAuth()
  const [name, setName] = useState('')
  const [firm, setFirm] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)

  // profile 是异步加载的：首次到位时回填表单（不覆盖用户已输入的内容）
  useEffect(() => {
    if (profile && !loaded) {
      setName(profile.lawyer_name)
      setFirm(profile.firm_name)
      setLoaded(true)
    }
  }, [profile, loaded])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setErr('请填写律师姓名')
      return
    }
    setBusy(true)
    setErr('')
    setOk(false)
    const r = await saveProfile({ lawyer_name: name, firm_name: firm })
    setBusy(false)
    if (r.ok) setOk(true)
    else setErr(r.error ?? '保存失败，请稍后重试')
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-white p-5">
      <div className="text-sm font-semibold text-ink mb-1">律师信息</div>
      <p className="text-xs text-ink-3 mb-4">
        姓名与律所显示在左侧栏底部，仅保存在你自己的账号下（{email || '未登录'}），其他律师互不可见。
      </p>

      <label className="block text-xs font-medium text-ink-2 mb-1.5">律师姓名</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="如：张三"
        className="w-full h-10 px-3 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
      />

      <label className="block text-xs font-medium text-ink-2 mt-4 mb-1.5">律所名称</label>
      <input
        value={firm}
        onChange={(e) => setFirm(e.target.value)}
        placeholder="如：江苏某某律师事务所"
        className="w-full h-10 px-3 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
      />

      {err && <div className="mt-3 px-3 py-2 rounded-lg bg-danger/6 border border-danger/20 text-xs text-danger">{err}</div>}
      {ok && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
          已保存。
        </div>
      )}

      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="mt-4 w-full h-10 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-medium transition-colors"
      >
        {busy ? '正在保存…' : '保存律师信息'}
      </button>
    </form>
  )
}

/**
 * 自建库配置卡 —— **仅自建库（NAS）模式**出现。
 * 只负责「查看 / 修改 / 清除自建库的地址与密钥」；**数据源切换统一在登录页**，这里不重复。
 * 地址与密钥只保存在本机浏览器。保存后整页刷新，让新地址 / 密钥立即生效。
 */
function BackendCard() {
  const [base, setBase] = useState('')
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const c = readCustom()
    setBase(c.base)
    setKey(c.key)
  }, [])

  function saveCustom() {
    writeCustom({ base: base.trim(), key: key.trim() })
    setSaved(true)
    // 刷新后新地址 / 密钥才生效（各数据模块在顶层解析一次）
    window.setTimeout(() => window.location.reload(), 900)
  }

  /** 清除自建库配置 → 生效后端自动回到云端公开库 */
  function forget() {
    clearCustom()
    window.location.reload()
  }

  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <label className="block text-xs font-medium text-ink-2 mb-1.5">自建库 REST 地址</label>
      <input
        value={base}
        onChange={(e) => setBase(e.target.value)}
        placeholder="https://你的反代域名/rest/v1"
        className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
      />

      <label className="block text-xs font-medium text-ink-2 mt-4 mb-1.5">自建库 anon key</label>
      <div className="relative">
        <input
          type={showKey ? 'text' : 'password'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
          className="w-full rounded-lg border border-line px-3 py-2 pr-9 text-sm font-mono outline-none focus:border-brand"
        />
        <button
          type="button"
          onClick={() => setShowKey((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-ink-3 hover:text-ink-2"
          aria-label={showKey ? '隐藏 anon key' : '显示 anon key'}
        >
          <Icon name={showKey ? 'eye-off' : 'eye'} className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-2 mt-4">
        <button
          type="button"
          onClick={saveCustom}
          className="px-3.5 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:opacity-90"
        >
          {saved ? '已保存' : '保存'}
        </button>
        <button
          type="button"
          onClick={forget}
          className="px-3.5 py-2 rounded-lg border border-line text-sm text-ink-2 hover:bg-canvas"
        >
          清除并回到云端
        </button>
      </div>
    </div>
  )
}

/**
 * 日历订阅卡 —— 跟随当前登录的数据源（云端 → CF Function；自建库 → NAS RPC）。
 * 生成一枚订阅密钥（明文只存本机），拼出 .ics 订阅 URL，添加到各平台日历 App
 * 即可收到案件节点到期提醒与提前提醒。源已在登录页选定，这里不再单独切云端/NAS。
 */
function CalendarCard() {
  const backend = currentBackend() // 'cloud' | 'nas'：跟随登录源
  const [token, setToken] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const srcName = backend === 'nas' ? '自建库（国内）' : '云端公开库'
  // 自建库订阅地址来自构建变量 VITE_NAS_CAL_BASE；未配置时禁用生成并给出提示
  const ready = subscriptionConfigured(backend)
  // 底端一行使用提示：说明这条订阅读的到底是哪一侧的数据
  const srcHint =
    backend === 'nas'
      ? '数据来源：本订阅直接读取自建库（NAS）里的案件节点，与云端无关。'
      : '数据来源：本订阅读取云端公开库；云端与自建库双向同步后，内容与 NAS 端一致。'

  useEffect(() => {
    try {
      const existing = localStorage.getItem(`lw.ical.key.v1.${backend}`)
      if (existing) {
        setToken(existing)
        setUrl(subscriptionConfigured(backend) ? subscriptionUrl(existing, backend) : '')
      }
    } catch {
      /* ignore */
    }
  }, [backend])

  async function generateOrRefresh() {
    setBusy(true)
    setErr('')
    try {
      // 「重新生成」= 真换新：先吊销本机这条旧密钥并清掉本地，再生成一条新的。
      // 各设备的链接相互独立，这里只轮换本机这条；另一台设备生成的链接不受影响。
      if (token) {
        try {
          await revokeToken(token, backend)
        } catch {
          /* 吊销失败也继续换新（旧条仍可用「吊销」处理） */
        }
        clearLocalToken(backend)
      }
      const t = await ensureToken(backend)
      if (!t) {
        setErr('未能生成订阅密钥，请重试')
        return
      }
      setToken(t)
      setUrl(subscriptionConfigured(backend) ? subscriptionUrl(t, backend) : '')
    } catch (e) {
      // ensureToken 抛出的都是带原因的明确错误（超时 / 401 登录过期 / 服务端拒绝）
      setErr((e as Error).message || '生成失败，请重试')
    } finally {
      setBusy(false) // 无论成败都复位，绝不停留在「处理中」
    }
  }

  function copy() {
    if (!url) return
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => setErr('复制失败，请手动长按 URL 复制'))
  }

  async function revoke() {
    if (!token) return
    setBusy(true)
    setErr('')
    try {
      await revokeToken(token, backend)
    } catch {
      /* 吊销失败也本地清掉，避免卡死 */
    }
    clearLocalToken(backend)
    setBusy(false)
    setToken(null)
    setUrl('')
  }

  // Section 已提供标题「日历订阅」+ 图标 + 描述，卡内不重复标题；
  // 卡片容器与其他设置模块一致（白底描边圆角）。
  return (
    <div className="rounded-xl border border-line bg-white p-5">
      {/* 顶部：当前数据源徽章 + 多设备规则一句话 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-2xs px-2 py-1 rounded-full bg-brand/10 text-brand shrink-0">{srcName}</span>
        <span className="text-2xs text-ink-3">手机、电脑可各自生成一条链接，同时有效、互不影响</span>
      </div>

      {!ready ? (
        <div className="rounded-lg border border-dashed border-line bg-canvas px-3 py-4 mb-3 text-xs text-ink-3 leading-relaxed">
          未配置自建库日历地址（构建变量 <span className="font-mono">VITE_NAS_CAL_BASE</span>
          ），本模式下暂不能生成订阅链接。云端公开库不受影响。
        </div>
      ) : url ? (
        <div className="rounded-lg border border-line bg-canvas p-3 mb-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-2xs font-medium text-ink-2">订阅链接</span>
            <span className="text-2xs text-ink-3">含密钥 · 请勿外泄</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 text-2xs font-mono text-ink-2 truncate select-all" title={url}>
              {url}
            </code>
            <button
              type="button"
              onClick={copy}
              className={`shrink-0 h-7 px-2.5 rounded-md text-2xs border transition-colors ${
                copied
                  ? 'border-brand/40 bg-brand/10 text-brand'
                  : 'border-line bg-white text-ink-2 hover:bg-canvas'
              }`}
            >
              {copied ? '已复制' : '复制'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={generateOrRefresh}
          disabled={busy || !ready}
          className="px-3.5 h-9 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-medium transition-colors"
        >
          {busy ? '处理中…' : url ? '重新生成' : '生成订阅链接'}
        </button>
        {url && (
          <button
            type="button"
            onClick={revoke}
            disabled={busy}
            className="px-3.5 h-9 rounded-lg border border-line text-sm text-danger hover:bg-[#FEF2F2] transition-colors"
          >
            吊销
          </button>
        )}
      </div>

      {err && <div className="mt-3 px-3 py-2 rounded-lg bg-danger/6 border border-danger/20 text-xs text-danger">{err}</div>}

      {/* 说明注释：添加方式 + 提醒规则 + 数据来源；不用标题、不单独高亮某个 App */}
      <p className="mt-4 border-t border-line pt-3 text-2xs text-ink-3 leading-relaxed">
        添加到日历：安卓用 ICSx⁵（安装后点「＋」粘贴上面的链接），iPhone 在 设置 → 日历 → 账户 → 添加账户 → 其他 → 添加订阅日历 粘贴链接。
        未设置「到期提醒」的案件会在节点时间准时提醒；「重新生成」和「吊销」只影响本机这条链接，另一台设备不受影响。
        {srcHint}
      </p>
    </div>
  )
}

export function Settings() {
  const { email } = useAuth()
  const onNas = activeBackend() === 'custom'
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)

  // —— 修改保险箱口令（敏感字段加密口令）——
  const [vOld, setVOld] = useState('')
  const [vNew, setVNew] = useState('')
  const [vConfirm, setVConfirm] = useState('')
  const [vShow, setVShow] = useState(false)
  const [vRemember, setVRemember] = useState(() => {
    try {
      return !!localStorage.getItem('lw.key.persist')
    } catch {
      return false
    }
  })
  const [vBusy, setVBusy] = useState(false)
  const [vErr, setVErr] = useState('')
  const [vOk, setVOk] = useState(false)
  const [vDone, setVDone] = useState(0)
  const [vTotal, setVTotal] = useState(0)

  const changeVault = async (e: React.FormEvent) => {
    e.preventDefault()
    setVErr('')
    setVOk(false)
    if (vNew.length < 6) {
      setVErr('新口令至少 6 位')
      return
    }
    if (vNew !== vConfirm) {
      setVErr('两次输入的新口令不一致')
      return
    }
    if (vOld === vNew) {
      setVErr('新口令不能与原口令相同')
      return
    }
    setVBusy(true)
    try {
      const oldKey = await deriveKey(vOld)
      const okOld = await verifyKey(oldKey)
      if (!okOld) {
        setVErr('原口令不正确')
        setVBusy(false)
        return
      }
      const newKey = await deriveKey(vNew)
      const res = await reencryptVault(oldKey, newKey, (p) => {
        setVDone(p.done)
        setVTotal(p.total)
      })
      if (res.failed > 0) {
        setVErr(
          `部分记录改密失败（成功 ${res.reencrypted} 条，失败 ${res.failed} 条）。请保持页面打开，再次点击「保存新口令」即可重试剩余记录。`,
        )
        setVBusy(false)
        return
      }
      // 持久化新密钥，随后重载让内存中的密文与云端一致
      await persistKey(newKey, vRemember)
      setVOk(true)
      setTimeout(() => window.location.reload(), 1200)
    } catch (e2) {
      setVErr((e2 as Error).message || '改密失败，请稍后重试')
      setVBusy(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setOk(false)
    if (pw.length < 6) {
      setErr('密码至少 6 位')
      return
    }
    if (pw !== confirm) {
      setErr('两次输入的密码不一致')
      return
    }
    setBusy(true)
    try {
      const r = await changePassword(pw)
      if (r.ok) {
        setOk(true)
        setPw('')
        setConfirm('')
      } else {
        setErr(r.error || '修改失败')
      }
    } catch {
      setErr('网络异常，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* 移动端顶栏 */}
      <div className="md:hidden sticky top-0 z-20 bg-white border-b border-line">
        <div className="h-12 flex items-center gap-2 px-2">
          <Icon name="settings" className="w-5 h-5 text-ink-2" />
          <span className="text-sm font-semibold text-ink">设置</span>
        </div>
      </div>

      <div className="max-w-[560px] mx-auto px-5 py-6 md:py-10">
        <h1 className="text-lg font-semibold text-ink">设置</h1>
        <p className="mt-1 text-xs text-ink-3">管理账户与加密设置。</p>

        {/* 账户 */}
        <Section
          icon="user"
          title="账户"
          aside={
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-canvas text-2xs text-ink-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {email || '未登录'}
              {/* 当前生效数据源：登录/数据/日历订阅都跟着它走 */}
              <span
                className={`px-1.5 py-0.5 rounded text-2xs font-medium ${
                  onNas ? 'bg-amber-100 text-amber-700' : 'bg-brand/10 text-brand'
                }`}
              >
                {onNas ? '自建库' : '云端'}
              </span>
            </span>
          }
        >
          {authEnabled && <ProfileCard />}
          {authEnabled ? (
            <form onSubmit={submit} className="rounded-xl border border-line bg-white p-5">
              <div className="text-sm font-semibold text-ink mb-1">修改登录密码</div>
              <p className="text-xs text-ink-3 mb-4">修改后，其他已登录的设备需要重新登录。</p>

              <label className="block text-xs font-medium text-ink-2 mb-1.5">新密码</label>
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  placeholder="至少 6 位"
                  className="w-full h-10 px-3 pr-10 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-ink-3 hover:text-ink-2"
                  aria-label={show ? '隐藏密码' : '显示密码'}
                >
                  <Icon name={show ? 'eye-off' : 'eye'} className="w-4 h-4" />
                </button>
              </div>

              <label className="block text-xs font-medium text-ink-2 mt-4 mb-1.5">确认新密码</label>
              <input
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="再次输入新密码"
                className="w-full h-10 px-3 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
              />

              {err && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-danger/6 border border-danger/20 text-xs text-danger">{err}</div>
              )}
              {ok && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
                  密码已修改成功，下次登录请使用新密码。
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="mt-5 w-full h-10 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
              >
                {busy && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                {busy ? '正在保存…' : '保存新密码'}
              </button>
            </form>
          ) : (
            <div className="rounded-xl border border-line bg-white p-5">
              <div className="text-sm font-semibold text-ink mb-1">修改登录密码</div>
              <p className="text-xs text-ink-3 leading-relaxed">
                当前为本地演示模式，无需登录、没有密码可改。接入云端（Supabase）后即可在此修改登录密码。
              </p>
            </div>
          )}
        </Section>

        {/*
          数据源：入口对所有登录用户开放，否则会形成死循环——
          入口只在 role=nas 时显示，而 role=nas 又要先填了自建库才成立。
          判定见 isNasRole()：服务端打了 nas 角色，或本人填了自己的自建库（填了即算）。
        */}
        {/* 自建库模式专属：自建库配置 + 云端↔NAS 同步（云端模式不显示） */}
        {isCloud && onNas && (
          <Section
            icon="cloud"
            title="自建库配置"
            desc="你正在使用自建库（国内）作为数据源。这里可修改 / 清除它的地址与密钥（只保存在本机浏览器）。要切换数据源，请退出登录后在登录页选择。"
          >
            <BackendCard />
            <DataSync />
          </Section>
        )}

        {/* 日历订阅（需登录：云端/自建库均按后端隔离） */}
        {isCloud && (
          <Section
            icon="calendar"
            title="日历订阅"
            desc="生成专属订阅链接，在日历 App 里订阅后即可收到案件节点到期提醒；来源跟随你登录的数据源。"
          >
            <CalendarCard />
          </Section>
        )}

        {/* 安全 */}
        <Section icon="lock" title="安全" desc="敏感字段加密口令与账号安全说明。">
          {isCloud ? (
            <form onSubmit={changeVault} className="rounded-xl border border-line bg-white p-5">
              <div className="flex items-center gap-2 mb-1">
                <Icon name="lock" className="w-4 h-4 text-ink-2" />
                <div className="text-sm font-semibold text-ink">修改保险箱口令</div>
              </div>
              <p className="text-xs text-ink-3 leading-relaxed mb-4">
                此口令用于加密案件里的手机号、伤情、跟踪记录等敏感字段。修改时会在本机用旧口令解密、再用新口令重新加密后写回，
                <span className="text-ink-2">口令与明文永远不会离开你的设备</span>。
              </p>

              <label className="block text-xs font-medium text-ink-2 mb-1.5">原口令</label>
              <input
                type={vShow ? 'text' : 'password'}
                autoComplete="current-password"
                value={vOld}
                onChange={(e) => setVOld(e.target.value)}
                placeholder="当前保险箱口令"
                className="w-full h-10 px-3 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
              />

              <label className="block text-xs font-medium text-ink-2 mt-4 mb-1.5">新口令</label>
              <div className="relative">
                <input
                  type={vShow ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={vNew}
                  onChange={(e) => setVNew(e.target.value)}
                  placeholder="至少 6 位"
                  className="w-full h-10 px-3 pr-10 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
                />
                <button
                  type="button"
                  onClick={() => setVShow((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-ink-3 hover:text-ink-2"
                  aria-label={vShow ? '隐藏口令' : '显示口令'}
                >
                  <Icon name={vShow ? 'eye-off' : 'eye'} className="w-4 h-4" />
                </button>
              </div>

              <label className="block text-xs font-medium text-ink-2 mt-4 mb-1.5">确认新口令</label>
              <input
                type={vShow ? 'text' : 'password'}
                autoComplete="new-password"
                value={vConfirm}
                onChange={(e) => setVConfirm(e.target.value)}
                placeholder="再次输入新口令"
                className="w-full h-10 px-3 rounded-lg border border-line bg-white text-sm text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition"
              />

              <label className="flex items-center gap-2 mt-4 text-xs text-ink-2 select-none">
                <input
                  type="checkbox"
                  checked={vRemember}
                  onChange={(e) => setVRemember(e.target.checked)}
                  className="w-4 h-4 accent-[#1D4ED8]"
                />
                在这台设备记住 30 天（仅个人设备勾选）
              </label>

              {vErr && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-danger/6 border border-danger/20 text-xs text-danger leading-relaxed">
                  {vErr}
                </div>
              )}
              {vOk && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
                  口令已修改成功，正在重新载入…
                </div>
              )}

              {vTotal > 0 && vBusy && (
                <div className="mt-3">
                  <div className="h-1.5 rounded-full bg-canvas overflow-hidden">
                    <div
                      className="h-full bg-brand transition-all duration-200"
                      style={{ width: `${Math.round((vDone / vTotal) * 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 text-2xs text-ink-3">
                    正在重新加密第 {vDone}/{vTotal} 条…
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={vBusy}
                className="mt-5 w-full h-10 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
              >
                {vBusy && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                {vBusy ? '正在重新加密…' : '保存新口令'}
              </button>
            </form>
          ) : (
            <div className="rounded-xl border border-line bg-white p-5">
              <div className="text-sm font-semibold text-ink mb-1">修改保险箱口令</div>
              <p className="text-xs text-ink-3 leading-relaxed">
                当前为本地演示数据，没有保险箱口令，无需修改。接入云端（Supabase）后即可在此修改。
              </p>
            </div>
          )}

          <div className="px-1 flex items-start gap-2 text-ink-3">
            <Icon name="shield" className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <p className="text-[11px] leading-relaxed">
              登录密码只用于进入工作台（Supabase Auth）。案件里的手机号、伤情等敏感字段由本地保险库口令加密，与登录密码互不相干。
            </p>
          </div>
        </Section>
      </div>
    </div>
  )
}
