import { useState } from 'react'
import { Icon } from './Icon'
import { runSync, type SyncReport, type TableSyncStat } from '../lib/syncOps'
import { readCustom } from '../lib/apiConfig'
import { currentUserId } from '../lib/auth'

/**
 * 云端公开库 ↔ 自建库 的双向增量同步（仅 role=nas 的账号可见）。
 *
 * token（service_role）**只存在当前页面内存里，不写入 localStorage**——
 * 它有有效期、且是全表读写的钥匙，刷新即清空，避免长期留在浏览器里。
 *
 * 自建库的地址与 anon key 来自本人在「设置→数据源」填写并保存在本机的内容，
 * **不进构建包**——公开产物里不会出现任何人的自建库地址。
 */

const CLOUD_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/+$/, '')

/**
 * 网关 apikey：云端用构建内置的公开 anon key；自建库用本机保存的那条。
 * kong 只比对 apikey 是否在白名单，真正的权限由 Bearer 里的 JWT + 库 RLS 决定，
 * 因此动态签发的短期 token 走 Bearer 就能通过网关，不必登记进白名单。
 */
const CLOUD_ANON = ((import.meta.env.VITE_API_KEY as string | undefined) ?? '').trim()

export function DataSync() {
  const [cloudBase, setCloudBase] = useState(CLOUD_BASE)
  const [cloudToken, setCloudToken] = useState('')
  const [nasBase, setNasBase] = useState(() => readCustom().base)
  const [nasToken, setNasToken] = useState('')
  const [showTokens, setShowTokens] = useState(false)

  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<TableSyncStat[]>([])
  const [report, setReport] = useState<SyncReport | null>(null)
  const [err, setErr] = useState('')

  const bothConfigured = Boolean(cloudBase.trim() && nasBase.trim())

  const start = async () => {
    setErr('')
    if (!cloudBase.trim() || !nasBase.trim()) {
      setErr('两边的接口地址都不能为空')
      return
    }
    if (!cloudToken.trim() || !nasToken.trim()) {
      setErr('请填写两边的 service_role token（同步需要绕过 RLS 的全表读写权限）')
      return
    }
    setRunning(true)
    setLog([])
    setReport(null)
    try {
      const r = await runSync(
        // 云端是所有律师共用的多租户库：必须带上自己的 uid，只同步归属自己的行
        {
          base: cloudBase,
          token: cloudToken.trim(),
          anonKey: CLOUD_ANON || undefined,
          scopeUid: currentUserId() ?? undefined,
        },
        // 自建库是本人独用，全表都是自己的，不做归属过滤
        { base: nasBase, token: nasToken.trim(), anonKey: readCustom().key || undefined },
        (s) => setLog((l) => [...l, s]),
      )
      setReport(r)
    } catch (e) {
      setErr((e as Error).message || '同步失败')
    } finally {
      setRunning(false)
    }
  }

  const rows = report?.stats ?? log

  return (
    <div className="mt-4 rounded-xl border border-line bg-white p-5">
      <div className="flex items-center gap-2 mb-1">
        <Icon name="sync" className="w-4 h-4 text-ink-2" />
        <div className="text-sm font-semibold text-ink">双向同步（云端 ↔ NAS）</div>
      </div>
      <p className="text-xs text-ink-3 mb-4 leading-relaxed">
        按主键逐表比对，缺哪边补哪边，两边都有则以<strong className="text-ink-2">更新时间较新</strong>的为准；
        判断不了的行记为「冲突」，<strong className="text-ink-2">两边都不动</strong>。
        <br />
        网关那道 apikey 已自动用内置的公开 anon key，<strong className="text-ink-2">你只需填 service_role token</strong>。
        token 仅存于当前页面，刷新即清空。
      </p>

      {/* 云端 */}
      <div className="space-y-2">
        <div>
          <div className="text-xs font-medium text-ink-2 mb-1.5">云端 Supabase</div>
          <input
            value={cloudBase}
            onChange={(e) => setCloudBase(e.target.value)}
            placeholder="https://xxx.supabase.co/rest/v1"
            className="w-full h-9 px-3 rounded-lg border border-line bg-canvas text-xs text-ink outline-none focus:bg-white focus:border-brand"
          />
          <input
            type={showTokens ? 'text' : 'password'}
            value={cloudToken}
            onChange={(e) => setCloudToken(e.target.value)}
            placeholder="service_role token（NAS 取 .env 的 SERVICE_ROLE_KEY）"
            autoComplete="off"
            className="mt-1.5 w-full h-9 px-3 rounded-lg border border-line bg-canvas text-xs text-ink outline-none focus:bg-white focus:border-brand font-mono"
          />
        </div>

        {/* NAS */}
        <div>
          <div className="text-xs font-medium text-ink-2 mb-1.5">NAS 自建库</div>
          <input
            value={nasBase}
            onChange={(e) => setNasBase(e.target.value)}
            placeholder="https://你的反代域名/rest/v1"
            className="w-full h-9 px-3 rounded-lg border border-line bg-canvas text-xs text-ink outline-none focus:bg-white focus:border-brand"
          />
          <input
            type={showTokens ? 'text' : 'password'}
            value={nasToken}
            onChange={(e) => setNasToken(e.target.value)}
            placeholder="service_role token（NAS 取 .env 的 SERVICE_ROLE_KEY）"
            autoComplete="off"
            className="mt-1.5 w-full h-9 px-3 rounded-lg border border-line bg-canvas text-xs text-ink outline-none focus:bg-white focus:border-brand font-mono"
          />
        </div>

        <label className="flex items-center gap-2 text-2xs text-ink-3 select-none">
          <input
            type="checkbox"
            checked={showTokens}
            onChange={(e) => setShowTokens(e.target.checked)}
            className="w-3.5 h-3.5 accent-[#1D4ED8]"
          />
          显示 token
        </label>
      </div>

      {!bothConfigured && (
        <div className="mt-3 rounded-lg bg-[#FFFAEB] border border-[#FEDF89] px-3 py-2 text-2xs text-warn leading-relaxed">
          当前构建里没有内置两个后端地址，请在上方手动填写两边接口地址。
        </div>
      )}

      <button
        type="button"
        onClick={start}
        disabled={running}
        className="mt-4 w-full h-10 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
      >
        {running && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
        {running ? `同步中…（${log.length}/8 表）` : '开始双向同步'}
      </button>

      {err && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-danger/6 border border-danger/20 text-xs text-danger">{err}</div>
      )}

      {rows.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium text-ink-2 mb-2">同步结果</div>
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full text-2xs">
              <thead className="bg-canvas text-ink-3">
                <tr>
                  <th className="text-left font-medium px-2.5 py-1.5">表</th>
                  <th className="text-right font-medium px-2 py-1.5">补→NAS</th>
                  <th className="text-right font-medium px-2 py-1.5">补→云</th>
                  <th className="text-right font-medium px-2 py-1.5">云较新</th>
                  <th className="text-right font-medium px-2 py-1.5">NAS较新</th>
                  <th className="text-right font-medium px-2 py-1.5">冲突</th>
                  <th className="text-right font-medium px-2 py-1.5">一致</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.table} className="border-t border-line">
                    <td className="px-2.5 py-1.5 text-ink font-mono">{s.table}</td>
                    {s.error ? (
                      <td colSpan={6} className="px-2 py-1.5 text-right text-danger">
                        {s.error}
                      </td>
                    ) : (
                      <>
                        <td className="px-2 py-1.5 text-right tabular-nums text-ink-2">{s.onlyCloud || ''}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-ink-2">{s.onlyNas || ''}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-ink-2">{s.cloudNewer || ''}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-ink-2">{s.nasNewer || ''}</td>
                        <td
                          className={`px-2 py-1.5 text-right tabular-nums ${s.conflicts ? 'text-warn font-medium' : 'text-ink-2'}`}
                        >
                          {s.conflicts || ''}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-ink-3">{s.unchanged || ''}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report && (
            <div className="mt-2.5 text-2xs text-ink-3 leading-relaxed">
              写入 <span className="text-ink-2 font-medium">{report.written}</span> 行 · 耗时{' '}
              <span className="text-ink-2 font-medium">{((report.finishedAt - report.startedAt) / 1000).toFixed(1)}s</span>
              {report.conflictTotal > 0 && (
                <span className="text-warn">
                  {' '}
                  · 有 <span className="font-medium">{report.conflictTotal}</span> 行无法自动判定，两边均已保留未改
                </span>
              )}
              {report.hasError && <span className="text-danger"> · 部分表失败（见上表）</span>}
            </div>
          )}

          {report && report.conflicts.length > 0 && (
            <div className="mt-2 rounded-lg border border-[#FEDF89] bg-[#FFFAEB] px-3 py-2.5 space-y-2.5">
              <div className="text-2xs font-medium text-warn">
                冲突明细（共 {report.conflicts.length} 行，两边均保留未改，需人工取舍）
              </div>
              {report.conflicts.map((c, i) => {
                const enc = c.diffs.filter((d) => d.field.endsWith('_enc'))
                const plain = c.diffs.filter((d) => !d.field.endsWith('_enc'))
                return (
                  <div
                    key={`${c.table}-${c.id}-${i}`}
                    className="rounded-md bg-white/80 border border-[#FEDF89] px-2.5 py-2 space-y-1"
                  >
                    {/* 第一行：哪张表 · 哪个案子 · 哪条数据 */}
                    <div className="text-2xs text-ink">
                      <span className="font-mono text-ink-3">[{c.table}]</span>{' '}
                      {c.caseName && <strong className="font-semibold">{c.caseName}</strong>}
                      {c.label && <span className="text-ink-2"> · {c.label}</span>}
                      <span className="ml-1 font-mono text-ink-3">id={c.id}</span>
                    </div>

                    {/* 普通字段：字段名一行，云 / NAS 各占一行对齐 */}
                    {plain.map((d) => (
                      <div key={d.field} className="text-2xs leading-snug">
                        <div className="text-ink-2">
                          · {d.label}
                          <span className="text-ink-3">（{d.field}）</span>
                        </div>
                        <div className="pl-3">
                          <span className="text-ink-3">云　</span>
                          <span className="text-ink">{d.cloud}</span>
                        </div>
                        <div className="pl-3">
                          <span className="text-ink-3">NAS</span>
                          <span className="text-ink">{d.nas}</span>
                        </div>
                      </div>
                    ))}

                    {/* 密文字段合并一行，不逐条刷屏 */}
                    {enc.length > 0 && (
                      <div className="text-2xs text-ink-3">
                        · 密文不一致（{enc.map((d) => d.field).join('、')}）：需在原App打开对照或解密后比对
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex items-start gap-2 px-1">
        <Icon name="shield" className="w-3.5 h-3.5 text-ink-3 mt-0.5 shrink-0" />
        <p className="text-[11px] text-ink-3 leading-relaxed">
          NAS 用 <span className="font-mono">/supabase-selfhosted/.env</span> 的{' '}
          <span className="font-mono">service_role_key</span>；云端 token 在 Supabase 控制台{' '}
          <span className="font-mono">Project Settings → API</span> 取 <span className="font-mono">service_role</span>
        </p>
      </div>
    </div>
  )
}
