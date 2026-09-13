import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { DocPreview } from '../components/DocPreview'
import {
  ALL_CATEGORIES,
  UNCATEGORIZED,
  classifyByFilename,
  fmtSize,
  isPreviewable,
} from '../lib/docCategory'
import {
  clearRoot,
  copyText,
  fsSupported,
  listCaseFiles,
  listSubDirs,
  loadRoot,
  permissionOf,
  pickRoot,
  resolveFileHandle,
  type FsFileHandle,
  type LocalFile,
  type RootBinding,
} from '../lib/fsAccess'
import {
  applyReconcile,
  loadCaseFolders,
  loadDocFiles,
  reconcile,
  saveCaseFolder,
  setFileCategory,
  setFileCategoryBatch,
} from '../lib/docsOps'
import type { CaseFolder, CaseRow, Dataset, DocFile } from '../lib/types'

// ---------------- 本机设置（按设备存，电脑与手机各存各的） ----------------
const K_ROLE = 'lw.docs.role'
const K_ROOT = 'lw.docs.root'
const K_CATS = 'lw.docs.cats'

type Role = 'pc' | 'mobile'

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* 隐私模式忽略 */
  }
}
/** 分类覆盖：caseId|relPath -> category，写云端的同时先落本地，界面立刻生效 */
function loadCats(): Record<string, number> {
  try {
    return JSON.parse(lsGet(K_CATS) || '{}') as Record<string, number>
  } catch {
    return {}
  }
}

function joinPath(root: string, folder: string, role: Role): string {
  if (!root) return ''
  const sep = role === 'pc' ? '\\' : '/'
  return root.replace(/[\\/]+$/, '') + sep + folder
}

/** 文件夹名 → 案件（先精确，再取最长包含匹配，避免两字姓名误伤） */
function matchCase(dirName: string, cases: CaseRow[]): CaseRow | undefined {
  const exact = cases.find((c) => c.client && c.client === dirName)
  if (exact) return exact
  const cands = cases.filter(
    (c) => c.client && c.client.length >= 2 && (dirName.includes(c.client) || c.client.includes(dirName)),
  )
  cands.sort((a, b) => b.client.length - a.client.length)
  return cands[0]
}

interface Row {
  id: number
  name: string
  relPath: string
  size?: number | null
  /** 排序用的时间戳（毫秒）：本机取文件修改时间，云端取索引时间 */
  time: number
  category: number
  manual: boolean
  handle?: FsFileHandle
  onlyLocal: boolean
}

type SortKey = 'name' | 'time' | 'type' | 'size'

/** 云端行的排序时间戳：优先索引时间，退回更新时间 */
function tsOf(c: DocFile): number {
  const t = Date.parse(c.indexed_at ?? c.updated_at ?? '')
  return Number.isNaN(t) ? 0 : t
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > -1 ? name.slice(i + 1).toLowerCase() : ''
}

export function MaterialsView({
  data,
  onOpenCase,
  fixedCaseId,
  compact,
}: {
  data: Dataset
  onOpenCase?: (id: number) => void
  /** 传了就锁定到该案件（案件详情的「文书与证据」页签用），并隐藏案件选择器 */
  fixedCaseId?: number | null
  /** 紧凑模式：不渲染页面标题与外边距，作为页签内容内嵌 */
  compact?: boolean
}) {
  const [role, setRole] = useState<Role>((lsGet(K_ROLE) as Role) || 'pc')
  const [rootPath, setRootPath] = useState(lsGet(K_ROOT) || '')
  const [root, setRoot] = useState<RootBinding | null>(null)
  const [perm, setPerm] = useState<PermissionState | null>(null)
  const [folders, setFolders] = useState<CaseFolder[]>([])
  const [files, setFiles] = useState<DocFile[]>([])
  const [cats, setCats] = useState<Record<string, number>>(loadCats)
  const [caseId, setCaseId] = useState<number | null>(fixedCaseId ?? data.cases[0]?.id ?? null)
  const [showSetup, setShowSetup] = useState(!compact)
  const [localFiles, setLocalFiles] = useState<LocalFile[]>([])
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [search, setSearch] = useState('')
  const [openCats, setOpenCats] = useState<number[]>(ALL_CATEGORIES.map((c) => c.id))
  // 案件下拉搜索
  const [caseOpen, setCaseOpen] = useState(false)
  const [caseQuery, setCaseQuery] = useState('')
  const caseRef = useRef<HTMLDivElement | null>(null)
  // 扫描中止标志：点「停止」置 true，doScan 在各 await 边界轮询；不回滚已写入的索引（增量建索引语义）
  const scanAbort = useRef(false)
  useEffect(() => {
    if (!caseOpen) return
    const onDoc = (e: MouseEvent) => {
      if (caseRef.current && !caseRef.current.contains(e.target as Node)) setCaseOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [caseOpen])
  // 每个分类各记各的排序（默认按名称升序）
  const [sorts, setSorts] = useState<Record<number, { key: SortKey; dir: 'asc' | 'desc' }>>({})
  const [preview, setPreview] = useState<{ name: string; handle: FsFileHandle | null } | null>(null)
  const [editing, setEditing] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)

  const supported = fsSupported()
  const cases = data.cases
  const filteredCases = useMemo(() => {
    const k = caseQuery.trim().toLowerCase()
    if (!k) return cases
    return cases.filter((c) => `${c.client} ${c.cause}`.toLowerCase().includes(k))
  }, [cases, caseQuery])
  const current = cases.find((c) => c.id === caseId) ?? null
  const folderRow = folders.find((f) => f.case_id === caseId) ?? null
  const selCount = current ? [...selected].filter((k) => k.startsWith(`${current.id}|`)).length : 0

  // 切换案件时清空多选，避免跨案件误选
  useEffect(() => {
    setSelected(new Set())
  }, [caseId])

  // 进入/退出「选择模式」：退出时清空选择，回到纯浏览态
  const toggleSelectMode = () => {
    if (selectMode) setSelected(new Set())
    setSelectMode((v) => !v)
  }

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const [fs, fl] = await Promise.all([loadCaseFolders(), loadDocFiles()])
      setFolders(fs)
      setFiles(fl)
    } catch (e) {
      const m = (e as Error).message
      setMsg(/PGRST205|does not exist|42P01|404/i.test(m) ? '云端还没建文书与证据的表，请先在 Supabase 控制台执行 supabase/docs_schema.sql' : m)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    void loadRoot().then(setRoot)
  }, [refresh])

  // 页签里切换案件时跟随
  useEffect(() => {
    if (fixedCaseId != null) setCaseId(fixedCaseId)
  }, [fixedCaseId])

  useEffect(() => {
    setLocalFiles([])
    setUnmatched([])
  }, [caseId])

  // ---------------- 授权 ----------------
  const doAuthorize = async () => {
    const b = await pickRoot()
    if (!b) return
    setRoot(b)
    const p = await permissionOf(b.handle)
    setPerm(p)
    setMsg(p === 'granted' ? `已授权：${b.name}` : '授权未生效，请重新选择目录')
  }

  const doScan = async () => {
    if (!current) return
    scanAbort.current = false
    const aborted = () => scanAbort.current
    setScanning(true)
    setMsg('')
    try {
      if (!root) {
        setMsg('请先点「授权同步根目录」/「重新选择同步根目录」选择本机同步文件夹')
        return
      }
      // 安卓 Edge 等支持目录授权的移动端：与电脑一样用句柄枚举 + 写云端索引 + 本地预览。
      // 路径字符串：PC 用本机设置里手动填的根目录；手机若未填则退回所选目录名（系统不暴露完整路径）。
      const rootForPath = rootPath || root.name
      const p = await permissionOf(root.handle)
      setPerm(p)
      if (p !== 'granted') {
        setMsg('浏览器未授权读取该目录，请点「重新授权」')
        return
      }

      // 顺带把根目录下的文件夹与案件做一次自动对应
      const dirs = await listSubDirs(root.handle, aborted)
      if (aborted()) {
        setMsg('已停止扫描（已完成权限校验）')
        return
      }
      const known = new Set(folders.map((f) => f.folder_name).filter(Boolean) as string[])
      const folderByFolder = new Map(folders.map((f) => [f.folder_name, f]))
      const bound = new Set<number>()
      const rest: string[] = []
      for (const d of dirs) {
        if (aborted()) break
        if (known.has(d.name)) {
          // 已配对的文件夹：若当前角色的完整路径还空着（多半是先在另一台设备配对的），顺手回填，
          // 避免手机端「复制路径」为空、电脑端同理
          const ex = folderByFolder.get(d.name)
          if (ex) {
            if (role === 'pc') {
              if (!ex.pc_folder) {
                await saveCaseFolder({ case_id: ex.case_id, folder_name: d.name, matched_by: ex.matched_by ?? 'manual', pc_folder: joinPath(rootForPath, d.name, 'pc') })
              }
            } else if (!ex.mobile_folder) {
              await saveCaseFolder({ case_id: ex.case_id, folder_name: d.name, matched_by: ex.matched_by ?? 'manual', mobile_folder: joinPath(rootForPath, d.name, 'mobile') })
            }
          }
          continue
        }
        const c = matchCase(d.name, cases)
        // 同一个案件可能被多个文件夹名命中（如「李春华」与「李春华交通事故」），一轮只绑一次
        if (c && !bound.has(c.id)) {
          bound.add(c.id)
          await saveCaseFolder({
            case_id: c.id,
            folder_name: d.name,
            matched_by: 'auto',
            ...(role === 'pc' ? { pc_folder: joinPath(rootForPath, d.name, 'pc') } : { mobile_folder: joinPath(rootForPath, d.name, 'mobile') }),
          })
        } else if (!c) rest.push(d.name)
      }
      setUnmatched(rest)
      const fs2 = await loadCaseFolders()
      setFolders(fs2)

      // 扫当前案件
      const fr = fs2.find((f) => f.case_id === current.id)
      const folderName = fr?.folder_name || current.client
      const list = await listCaseFiles(root.handle, folderName, aborted)
      setLocalFiles(list)
      if (aborted()) {
        setMsg(`已停止扫描：文件枚举已部分完成（已列出 ${list.length} 个文件）`)
        return
      }

      const existing = files.filter((f) => f.case_id === current.id)
      const r = reconcile(current.id, list, existing)
      await applyReconcile(r, aborted)
      if (aborted()) {
        setMsg(`已停止扫描：已写入部分索引（新增 ${r.inserts.length} / 更新 ${r.updates.length}）`)
        return
      }
      await refresh()
      setMsg(
        `扫描完成：${list.length} 个文件` +
          (r.inserts.length ? ` · 新增 ${r.inserts.length}` : '') +
          (r.updates.length ? ` · 更新 ${r.updates.length}` : '') +
          (r.renamed ? ` · 识别重命名 ${r.renamed}` : '') +
          (r.deletes.length ? ` · 移除 ${r.deletes.length}` : '') +
          (rest.length ? ` · ${rest.length} 个文件夹未匹配到案件` : '') +
          (role === 'mobile' && !rootPath ? '（未填根目录路径，已用所选目录名记录，可在本机设置补全完整路径）' : ''),
      )
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setScanning(false)
    }
  }

  // ---------------- 视图模型 ----------------
  const rows: Row[] = useMemo(() => {
    if (!current) return []
    const cloud = files.filter((f) => f.case_id === current.id)
    const byRel = new Map(cloud.filter((f) => f.rel_path).map((f) => [f.rel_path as string, f]))

    const build = (
      relPath: string,
      name: string,
      size: number | null,
      cloudRow?: DocFile,
      handle?: FsFileHandle,
      time?: number | null,
    ): Row => {
      const override = cats[`${current.id}|${relPath}`]
      const manual = cloudRow?.category_src === 'manual' || override !== undefined
      return {
        id: cloudRow?.id ?? -1,
        name,
        relPath,
        size: size ?? cloudRow?.size_bytes ?? null,
        time: time ?? (cloudRow ? tsOf(cloudRow) : 0),
        category: override ?? cloudRow?.category ?? classifyByFilename(name),
        manual,
        handle,
        onlyLocal: !cloudRow,
      }
    }

    if (localFiles.length) {
      const out = localFiles.map((l) => build(l.relPath, l.name, l.size, byRel.get(l.relPath), l.handle, l.lastModified))
      // 云端有、本机这轮没扫到的，标为缺失仍显示（可能是子目录还没扫）
      for (const c of cloud)
        if (c.rel_path && !localFiles.some((l) => l.relPath === c.rel_path)) out.push(build(c.rel_path, c.name, null, c))
      return out
    }
    return cloud.map((c) => build(c.rel_path ?? c.name, c.name, c.size_bytes ?? null, c))
  }, [current, files, localFiles, cats])

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase()
    return kw ? rows.filter((r) => r.name.toLowerCase().includes(kw)) : rows
  }, [rows, search])

  const sortOf = (catId: number) => sorts[catId] ?? { key: 'name' as SortKey, dir: 'asc' as const }

  const grouped = useMemo(() => {
    const m = new Map<number, Row[]>()
    for (const c of ALL_CATEGORIES) m.set(c.id, [])
    for (const r of filtered) {
      const arr = m.get(r.category) ?? m.get(0)!
      arr.push(r)
    }
    // 每个分类按自己的排序规则排
    for (const [catId, arr] of m) {
      const { key, dir } = sorts[catId] ?? { key: 'name' as SortKey, dir: 'asc' as const }
      arr.sort((a, b) => {
        let cmp = 0
        if (key === 'name') cmp = a.name.localeCompare(b.name, 'zh-CN')
        else if (key === 'type') cmp = extOf(a.name).localeCompare(extOf(b.name)) || a.name.localeCompare(b.name, 'zh-CN')
        else if (key === 'size') cmp = (a.size ?? 0) - (b.size ?? 0)
        else cmp = a.time - b.time
        return dir === 'asc' ? cmp : -cmp
      })
    }
    return m
  }, [filtered, sorts])

  // ---------------- 操作 ----------------
  const changeCat = async (r: Row, cat: number) => {
    setMenuFor(null)
    setMenuRect(null)
    const next = { ...cats, [`${current!.id}|${r.relPath}`]: cat }
    setCats(next)
    lsSet(K_CATS, JSON.stringify(next))
    try {
      if (r.id > 0) await setFileCategory(r.id, cat)
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  const bulkCat = async (catId: number, cat: number) => {
    const list = grouped.get(catId) ?? []
    const ids = list.filter((r) => r.id > 0).map((r) => r.id)
    const next = { ...cats }
    for (const r of list) next[`${current!.id}|${r.relPath}`] = cat
    setCats(next)
    lsSet(K_CATS, JSON.stringify(next))
    try {
      if (ids.length) await setFileCategoryBatch(ids, cat)
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  // 把当前案件下「勾选」的文件（跨分类）批量归到某类（只动选中的，不动整组；cat=0 即移回未分类）
  const bulkCatSelected = async (cat: number) => {
    if (!current) return
    const prefix = `${current.id}|`
    const keys = [...selected].filter((k) => k.startsWith(prefix))
    if (!keys.length) return
    const findRow = (relPath: string) =>
      [...grouped.values()].flat().find((x) => x.relPath === relPath)
    const next = { ...cats }
    const cloudIds: number[] = []
    for (const k of keys) {
      const relPath = k.slice(prefix.length)
      next[k] = cat
      const r = findRow(relPath)
      if (r && r.id > 0) cloudIds.push(r.id)
    }
    setCats(next)
    lsSet(K_CATS, JSON.stringify(next))
    setSelected(new Set())
    try {
      if (cloudIds.length) await setFileCategoryBatch(cloudIds, cat)
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  const fullPath = (r: Row): string => {
    const base = role === 'pc' ? folderRow?.pc_folder : folderRow?.mobile_folder
    if (base) {
      const sep = role === 'pc' ? '\\' : '/'
      return base.replace(/[\\/]+$/, '') + sep + r.relPath
    }
    const folderName = folderRow?.folder_name || current?.client || ''
    return joinPath(joinPath(rootPath, folderName, role), r.relPath, role)
  }

  const onRowClick = async (r: Row) => {
    if (isPreviewable(r.name)) {
      // 本轮刚扫描过：直接用内存里的句柄
      if (r.handle) {
        setPreview({ name: r.name, handle: r.handle })
        return
      }
      // 刷新过页面：句柄丢了，但根目录还授权着 → 按相对路径现取
      if (root) {
        const p = await permissionOf(root.handle)
        setPerm(p)
        if (p !== 'granted') {
          setMsg('目录授权已失效，请点「本机设置」→ 重新授权')
          return
        }
        const h = await resolveFileHandle(root.handle, folderRow?.folder_name, r.relPath)
        if (h) {
          setPreview({ name: r.name, handle: h })
          return
        }
        setMsg(`在本机同步目录里找不到「${r.name}」——可能已改名或删除，重新扫描一次即可`)
        return
      }
      setMsg('还没授权同步目录：点「本机设置」→「授权同步目录」，之后点文件名就能直接打开原图')
      return
    }
    // 文档类（word / excel 等）浏览器打不开，给路径到本机打开
    const p = fullPath(r)
    const ok = await copyText(p)
    setMsg(ok ? `已复制路径：${p}` : `路径：${p}`)
  }

  const disclaimer =
    role === 'pc'
      ? supported
        ? '电脑端授权同步目录后，点文件名可在本机直接打开原图（不上传云端）'
        : '当前浏览器不支持本地目录授权，请用 Chrome / Edge 打开；手机端只能看清单与路径'
      : '手机端无法直接读本地文件：点文件名会复制手机路径，用 Verysync / 文件管理器打开'

  return (
    <div className={compact ? 'space-y-3' : 'flex-1 overflow-y-auto pb-20 md:pb-0'}>
      {!compact && (
        <div className="hidden md:flex h-14 items-center px-6 bg-white border-b border-line sticky top-0 z-10 gap-3">
          <h1 className="text-[15px] font-semibold">文书与证据</h1>
          <span className="text-xs text-ink-3">按 8 类归集 · 原件留在本机</span>
          <button
            onClick={() => setEditing(true)}
            className={`ml-auto h-8 px-3 rounded-lg border text-xs hover:bg-canvas ${
              folderRow ? 'border-brand/40 text-brand bg-brand/5' : 'border-line text-ink-2'
            }`}
            title={folderRow ? `已配置：${folderRow.folder_name}` : '配置案件文件夹映射'}
          >
            文件夹路径{folderRow ? ` · ${folderRow.folder_name}` : ''}
          </button>
        </div>
      )}

      <div className={compact ? 'space-y-3' : 'p-4 md:p-6 space-y-4'}>
        {/* 本机设置（角色 / 同步根目录 / 授权）。页签里默认收起，需要时再展开 */}
        {showSetup && (
        <div className="bg-white rounded-xl border border-line shadow-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-ink-3">本机是</span>
            {(['pc', 'mobile'] as Role[]).map((r) => (
              <button
                key={r}
                onClick={() => {
                  setRole(r)
                  lsSet(K_ROLE, r)
                }}
                className={`h-7 px-3 rounded-lg border ${
                  role === r ? 'bg-ink text-white border-ink' : 'bg-white text-ink-2 border-line'
                }`}
              >
                {r === 'pc' ? '电脑' : '手机'}
              </button>
            ))}
            <span className="ml-auto text-2xs text-ink-3">路径按本机分别保存</span>
          </div>
          <div className="flex items-center gap-2">
            <Icon name={role === 'pc' ? 'device' : 'phone'} className="w-4 h-4 text-ink-3 shrink-0" />
            <input
              value={rootPath}
              onChange={(e) => {
                setRootPath(e.target.value)
                lsSet(K_ROOT, e.target.value)
              }}
              placeholder={role === 'pc' ? '同步根目录，如 D:\\Documents\\法法\\同步\\案件' : '手机同步根目录'}
              className="flex-1 h-9 px-3 rounded-lg border border-line text-xs bg-canvas outline-none focus:border-brand"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {supported ? (
              <>
                <button
                  onClick={doAuthorize}
                  className="h-8 px-3 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs flex items-center gap-1.5"
                >
                  <Icon name="cloud" className="w-3.5 h-3.5" />
                  {root ? '重新选择同步根目录' : '授权同步根目录'}
                </button>
                {root && (
                  <span className="text-2xs text-ink-3">
                    已授权：{root.name}
                    {perm && perm !== 'granted' ? '（需重新授权）' : ''}
                  </span>
                )}
                {root && (
                  <button
                    onClick={async () => {
                      await clearRoot()
                      setRoot(null)
                      setPerm(null)
                    }}
                    className="text-2xs text-ink-3 underline"
                  >
                    解除授权
                  </button>
                )}
              </>
            ) : (
              <span className="text-2xs text-ink-3">此浏览器不支持本地目录授权，只能用清单与路径</span>
            )}
          </div>
          <p className="text-2xs text-ink-3 leading-relaxed">{disclaimer}</p>
        </div>
        )}

        {/* 案件选择 + 扫描 */}
        <div className="bg-white rounded-xl border border-line shadow-card p-3 flex flex-wrap items-center gap-2">
          {!compact && (
            <div className="relative w-full md:w-56 md:flex-none" ref={caseRef}>
              <button
                type="button"
                onClick={() => {
                  setCaseOpen((v) => !v)
                  setCaseQuery('')
                }}
                className="h-9 w-full px-2 rounded-lg border border-line text-sm bg-canvas outline-none focus:border-brand text-left truncate flex items-center justify-between gap-1"
              >
                <span className="truncate">{current ? `${current.client} · ${current.cause}` : '选择案件'}</span>
                <Icon name="chevron" className="w-3.5 h-3.5 shrink-0 text-ink-3 rotate-90" />
              </button>
              {caseOpen && (
                <div className="absolute z-30 mt-1 w-full bg-white border border-line rounded-lg shadow-pop overflow-hidden">
                  <div className="p-1.5 border-b border-line">
                    <div className="relative">
                      <Icon name="search" className="w-3.5 h-3.5 text-ink-3 absolute left-2 top-1/2 -translate-y-1/2" />
                      <input
                        autoFocus
                        value={caseQuery}
                        onChange={(e) => setCaseQuery(e.target.value)}
                        placeholder="搜委托人 / 案由"
                        className="w-full h-8 pl-7 pr-2 rounded border border-line text-xs outline-none focus:border-brand"
                      />
                    </div>
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    {filteredCases.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-ink-3">没有匹配的案件</div>
                    ) : (
                      filteredCases.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setCaseId(c.id)
                            setCaseOpen(false)
                          }}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-canvas truncate ${
                            c.id === caseId ? 'bg-canvas text-brand font-medium' : 'text-ink-2'
                          }`}
                        >
                          {c.client} · {c.cause}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="relative flex-1 min-w-[120px]">
            <Icon name="search" className="w-4 h-4 text-ink-3 absolute left-2.5 top-2.5" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜文件名"
              className="w-full h-9 pl-8 pr-3 rounded-lg border border-line text-xs bg-canvas outline-none focus:border-brand"
            />
          </div>
          {scanning ? (
            <button
              onClick={() => {
                scanAbort.current = true
              }}
              className="h-9 px-3 rounded-lg border border-danger text-danger text-xs hover:bg-danger/10"
            >
              停止
            </button>
          ) : (
            <button
              onClick={doScan}
              disabled={!root || !current}
              className="h-9 px-3 rounded-lg bg-ink text-white text-xs disabled:opacity-40"
            >
              扫描本案件
            </button>
          )}
          <button
            onClick={() => setShowSetup((v) => !v)}
            className="h-9 px-3 rounded-lg border border-line text-xs text-ink-2 hover:bg-canvas"
            title="配置本机角色、同步根目录与授权"
          >
            本机设置
          </button>
          <button
            onClick={() => setEditing(true)}
            className={`h-9 px-3 rounded-lg border text-xs hover:bg-canvas ${
              folderRow ? 'border-brand/40 text-brand bg-brand/5' : 'border-line text-ink-2'
            }`}
            title={folderRow ? `已配置：${folderRow.folder_name}` : '配置案件文件夹映射'}
          >
            文件夹路径{folderRow ? ` · ${folderRow.folder_name}` : ''}
          </button>
          <button
            onClick={toggleSelectMode}
            className={`h-9 px-3 rounded-lg border text-xs ${
              selectMode ? 'border-brand bg-brand/5 text-brand' : 'border-line text-ink-2 hover:bg-canvas'
            }`}
            title="进入选择模式后可批量勾选文件归类"
          >
            {selectMode ? '退出多选' : '多选'}
          </button>
          {!compact && (
            <button
              onClick={() => onOpenCase?.(caseId!)}
              disabled={!caseId}
              className="h-9 px-3 rounded-lg border border-line text-xs text-ink-2 hover:bg-canvas disabled:opacity-40"
            >
              案件详情
            </button>
          )}
        </div>

        {msg && <div className="text-xs text-ink-2 bg-white border border-line rounded-lg px-3 py-2">{msg}</div>}

        {folderRow?.folder_name && (
          <div className="text-2xs text-ink-3 px-1">
            对应文件夹：<span className="text-ink-2">{folderRow.folder_name}</span>
            {folderRow.matched_by === 'auto' ? '（自动匹配）' : '（手动指定）'}
          </div>
        )}

        {unmatched.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
            有 {unmatched.length} 个文件夹没匹配到案件：{unmatched.slice(0, 6).join('、')}
            {unmatched.length > 6 ? ' 等' : ''}
            <button onClick={() => setEditing(true)} className="ml-2 underline">
              手动指定
            </button>
          </div>
        )}

        {/* 8 分类树 */}
        <div className="bg-white rounded-xl border border-line shadow-card">
          {ALL_CATEGORIES.map((cat) => {
            const list = grouped.get(cat.id) ?? []
            const open = openCats.includes(cat.id)
            return (
              <div key={cat.id} className="border-b border-line last:border-0">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 bg-canvas/60">
                  <button
                    onClick={() =>
                      setOpenCats((p) => (p.includes(cat.id) ? p.filter((x) => x !== cat.id) : [...p, cat.id]))
                    }
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  >
                    <Icon
                      name="chevron"
                      className={`w-3.5 h-3.5 text-ink-3 transition-transform ${open ? 'rotate-90' : ''}`}
                    />
                    <span className={`w-2 h-2 rounded-full ${cat.dot} shrink-0`} />
                    <span className="text-sm font-medium truncate">{cat.name}</span>
                    <span className="text-2xs text-ink-3 shrink-0">{list.length}</span>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <select
                      value={sortOf(cat.id).key}
                      onChange={(e) => {
                        const key = e.target.value as SortKey
                        setSorts((p) => ({ ...p, [cat.id]: { key, dir: p[cat.id]?.dir ?? 'asc' } }))
                      }}
                      className="h-6 pl-1.5 pr-1 text-2xs rounded border border-line bg-white text-ink-2 outline-none focus:border-brand"
                      title="排序依据"
                    >
                      <option value="name">名称</option>
                      <option value="time">时间</option>
                      <option value="type">类型</option>
                      <option value="size">大小</option>
                    </select>
                    <button
                      onClick={() => {
                        const cur = sortOf(cat.id)
                        setSorts((p) => ({
                          ...p,
                          [cat.id]: { key: cur.key, dir: cur.dir === 'asc' ? 'desc' : 'asc' },
                        }))
                      }}
                      className="h-6 w-6 text-2xs rounded border border-line bg-white text-ink-2 hover:bg-canvas"
                      title={sortOf(cat.id).dir === 'asc' ? '升序，点击改为降序' : '降序，点击改为升序'}
                    >
                      {sortOf(cat.id).dir === 'asc' ? '↑' : '↓'}
                    </button>
                  </div>
                  {cat.id === UNCATEGORIZED.id && list.length > 0 && (
                    <select
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        if (v >= 0) void bulkCat(0, v)
                        e.currentTarget.value = ''
                      }}
                      defaultValue=""
                      className="h-7 text-2xs px-2 rounded border border-line bg-white text-ink-2"
                    >
                      <option value="">全部归到…</option>
                      {ALL_CATEGORIES.filter((c) => c.id !== 0).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {open && (
                  <div>
                    {list.length === 0 ? (
                      <div className="px-4 py-3 text-2xs text-ink-3">暂无</div>
                    ) : (
                      list.map((r) => (
                        <div key={r.relPath} className="group flex items-center gap-2 px-4 py-2.5 border-t border-line/60 hover:bg-canvas">
                          {selectMode && (
                            <input
                              type="checkbox"
                              checked={selected.has(`${current!.id}|${r.relPath}`)}
                              onChange={(e) => {
                                const k = `${current!.id}|${r.relPath}`
                                setSelected((p) => {
                                  const n = new Set(p)
                                  if (e.target.checked) n.add(k)
                                  else n.delete(k)
                                  return n
                                })
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="shrink-0 w-4 h-4 accent-brand cursor-pointer"
                              title="勾选后在底部批量归类"
                            />
                          )}
                          <button
                            onClick={() => void onRowClick(r)}
                            className="flex items-center gap-2 flex-1 min-w-0 text-left"
                            title={r.handle ? '本机打开' : '复制路径'}
                          >
                            <Icon name="file" className="w-4 h-4 text-ink-3 shrink-0" />
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm truncate">{r.name}</span>
                              <span className="block text-2xs text-ink-3 truncate">
                                {fmtSize(r.size)}
                                {r.manual ? ' · 手动归类' : ''}
                                {r.onlyLocal ? ' · 未入索引' : ''}
                              </span>
                            </span>
                          </button>
                          <div className="relative shrink-0">
                            <button
                              onClick={(e) => {
                                if (menuFor === r.relPath) { setMenuFor(null); setMenuRect(null) }
                                else { setMenuFor(r.relPath); setMenuRect(e.currentTarget.getBoundingClientRect()) }
                              }}
                              className="h-7 px-2 rounded text-2xs text-ink-2 border border-line hover:bg-white md:opacity-0 md:group-hover:opacity-100"
                            >
                              归类
                            </button>
                            {menuFor === r.relPath && menuRect && (
                              <>
                                <div
                                  className="fixed inset-0 z-40"
                                  onClick={() => { setMenuFor(null); setMenuRect(null) }}
                                />
                                <div
                                  className="fixed z-50 w-44 bg-white border border-line rounded-lg shadow-pop py-1 max-h-64 overflow-y-auto"
                                  style={{
                                    right: window.innerWidth - menuRect.right,
                                    top:
                                      menuRect.bottom + 320 <= window.innerHeight
                                        ? menuRect.bottom + 4
                                        : Math.max(8, menuRect.top - 320),
                                  }}
                                >
                                {ALL_CATEGORIES.map((c) => (
                                  <button
                                    key={c.id}
                                    onClick={() => void changeCat(r, c.id)}
                                    className={`w-full px-3 py-1.5 text-left text-xs hover:bg-canvas flex items-center gap-2 ${
                                      r.category === c.id ? 'text-brand' : 'text-ink-2'
                                    }`}
                                  >
                                    <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                                    {c.name}
                                  </button>
                                ))}
                              </div>
                              </>)}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* 多选操作悬浮条：选择模式下、选中 ≥1 项时浮出，固定在视口底部（不被长列表滚动裁切） */}
        {selectMode && selected.size > 0 && (
          <div className="fixed left-0 right-0 bottom-0 z-50 md:left-auto md:right-4 md:bottom-4 md:w-auto md:max-w-[95vw]">
            <div className="bg-white border border-line shadow-pop rounded-t-xl md:rounded-xl px-3 py-2.5 flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-ink-1 px-1">已选 {selCount} 项</span>
              <select
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (v >= 0) void bulkCatSelected(v)
                  e.currentTarget.value = ''
                }}
                defaultValue=""
                className="h-8 text-xs px-2 rounded border border-brand bg-brand/5 text-brand font-medium"
                title="把选中的文件批量归类"
              >
                <option value="">归到…</option>
                {ALL_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void bulkCatSelected(0)}
                className="h-8 px-3 rounded text-xs border border-line text-ink-2 hover:bg-canvas"
                title="移回未分类"
              >
                移回未分类
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="h-8 px-3 rounded text-xs border border-line text-ink-2 hover:bg-canvas"
              >
                清空
              </button>
              <button
                onClick={toggleSelectMode}
                className="h-8 px-3 rounded text-xs bg-brand text-white font-medium"
              >
                完成
              </button>
            </div>
          </div>
        )}

        {rows.length === 0 && !busy && (
          <div className="text-center py-10 text-xs text-ink-3">
            还没有文件索引。先选案件，再点「扫描本案件」。
          </div>
        )}
      </div>

      {preview && <DocPreview name={preview.name} handle={preview.handle} onClose={() => setPreview(null)} />}

      {editing && current && (
        <FolderEditor
          caseRow={current}
          folderRow={folderRow}
          role={role}
          rootPath={rootPath}
          onClose={() => setEditing(false)}
          onSaved={async (v) => {
            await saveCaseFolder({ case_id: current.id, ...v, matched_by: 'manual' })
            setEditing(false)
            await refresh()
            setMsg('已保存文件夹路径')
          }}
        />
      )}
    </div>
  )
}

function FolderEditor({
  caseRow,
  folderRow,
  role,
  rootPath,
  onClose,
  onSaved,
}: {
  caseRow: CaseRow
  folderRow: CaseFolder | null
  role: Role
  rootPath: string
  onClose: () => void
  onSaved: (v: { folder_name?: string; pc_folder?: string | null; mobile_folder?: string | null }) => void
}) {
  const [name, setName] = useState(folderRow?.folder_name ?? caseRow.client)
  const [pc, setPc] = useState(folderRow?.pc_folder ?? (role === 'pc' ? joinPath(rootPath, caseRow.client, 'pc') : ''))
  const [mb, setMb] = useState(
    folderRow?.mobile_folder ?? (role === 'mobile' ? joinPath(rootPath, caseRow.client, 'mobile') : ''),
  )
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center" onClick={onClose}>
      <div
        className="w-full md:w-[480px] bg-white rounded-t-2xl md:rounded-xl p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center">
          <h3 className="text-sm font-semibold flex-1">
            文件夹路径 · {caseRow.client}
          </h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-ink-3">
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>
        <label className="block">
          <span className="text-2xs text-ink-3">同步目录里的文件夹名</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full h-9 px-3 rounded-lg border border-line text-sm bg-canvas outline-none focus:border-brand"
          />
        </label>
        <label className="block">
          <span className="text-2xs text-ink-3">电脑端完整路径</span>
          <input
            value={pc}
            onChange={(e) => setPc(e.target.value)}
            placeholder="D:\Documents\法法\同步\案件\委托人"
            className="mt-1 w-full h-9 px-3 rounded-lg border border-line text-xs bg-canvas outline-none focus:border-brand"
          />
        </label>
        <label className="block">
          <span className="text-2xs text-ink-3">手机端完整路径</span>
          <input
            value={mb}
            onChange={(e) => setMb(e.target.value)}
            placeholder="/存储/Verysync/案件/委托人"
            className="mt-1 w-full h-9 px-3 rounded-lg border border-line text-xs bg-canvas outline-none focus:border-brand"
          />
        </label>
        <p className="text-2xs text-ink-3">只改路径，不动硬盘上的任何文件。</p>
        <button
          onClick={() => onSaved({ folder_name: name, pc_folder: pc || null, mobile_folder: mb || null })}
          className="w-full h-10 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm"
        >
          保存
        </button>
      </div>
    </div>
  )
}
