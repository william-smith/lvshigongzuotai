/**
 * 云端 Supabase ↔ NAS 自建库 的双向增量同步。
 *
 * 走两边各自的 PostgREST：`apikey` + `Authorization: Bearer` 都用 **service_role**，
 * 这样才能绕过 RLS 读到全表、也能写入。token 由用户输入、不落盘（有有效期）。
 *
 * 同步策略（保守、不丢数据）：
 *   1. 两边按主键 id 各拉一次全表（数据量小，1800 行级别）；
 *   2. 只在一边的行 → 直接补到另一边；
 *   3. 两边都有 → 内容完全一致就跳过；不同则按更新时间列（updated_at）取新的覆盖旧的；
 *      表里没有 updated_at 的（contacts/timeline/expenses）退化为「非空字段更多的那个」；
 *   4. 判定不了（时间相同、字段数相同）→ 记为冲突，**两边都不动**，列出来由人决定。
 *
 * 全程按表分批 200 行 upsert（on_conflict=id），任何一表报错不影响其他表。
 */

export interface SyncEndpoint {
  /** REST 基址，形如 https://xxx/rest/v1 */
  base: string
  /** service_role token（用户输入，不持久化；建议用 NAS .env 的永久 SERVICE_ROLE_KEY） */
  token: string
  /**
   * 网关 apikey。kong 只做「apikey 是否在白名单」的字符串比对，
   * 真正决定权限的是下面 Bearer 里的 JWT + 库的 RLS（这正是 Supabase 原生模型）。
   * 因此这里固定用**公开的 anon key**（本来就编译进前端），动态 token 走 Bearer 即可，
   * 无需把短期 token 登记进 kong 白名单。
   */
  anonKey?: string
  /**
   * 仅「多租户云端库」一侧需要填：只同步 user_id = 该 uid 的行。
   *
   * 为什么必须有：同步用 service_role，会**绕过 RLS**。云端库是所有律师共用的，
   * 不带上自己的 uid 就会把别人的案件整表拉进你的自建库（隔离穿透）。
   * 自建库是你自己的，全表都是本人的，因此**不要**给它设这个值。
   */
  scopeUid?: string
}

export const SYNC_TABLES = [
  'cases',
  'intakes',
  'contacts',
  'timeline',
  'expenses',
  'materials',
  'vault_meta',
  'case_folders',
] as const

export type SyncTable = (typeof SYNC_TABLES)[number]

/** 各表用于判定「谁更新」的时间列；没有更新时间列的表退化为字段数比较 */
const UPDATED_COL: Record<SyncTable, string | null> = {
  cases: 'updated_at',
  intakes: 'updated_at',
  materials: 'updated_at',
  case_folders: 'updated_at',
  vault_meta: 'updated_at',
  contacts: null,
  timeline: null,
  expenses: null,
}

export interface TableSyncStat {
  table: SyncTable
  /** 只在云端 → 补到 NAS */
  onlyCloud: number
  /** 只在 NAS → 补到云端 */
  onlyNas: number
  /** 云端较新 → 覆盖 NAS */
  cloudNewer: number
  /** NAS 较新 → 覆盖云端 */
  nasNewer: number
  /** 判定不了，两边都保留不动 */
  conflicts: number
  /** 内容一致，无操作 */
  unchanged: number
  error?: string
}

/** 单个字段的两侧取值 */
export interface FieldDiff {
  field: string
  label: string
  cloud: string
  nas: string
}

/** 一条无法自动判定的冲突行（两边都保留未改，需人工取舍） */
export interface ConflictDetail {
  table: SyncTable
  /** 主键 id，界面可直接定位 */
  id: string
  /** 所属案件当事人（cases 表取自身 client；其余表按 case_id 回查） */
  caseName: string
  /** 行自身摘要（案件为「当事人·案由」，其余表取标题/内容片段） */
  label: string
  /** 两边更新时间（无更新时间列的表为空） */
  cloudTime?: string
  nasTime?: string
  /** 逐字段的两侧取值对比 */
  diffs: FieldDiff[]
}

/** 跨表共享：case_id → 案件当事人，供 timeline/expenses/materials 回查案件名 */
export type CaseNameMap = Map<string, string>

/** 一次同步内部的共享上下文 */
export interface SyncShared {
  caseNames: CaseNameMap
  /** 云端侧本人拥有的案件 id（子表按父表归属过滤用） */
  ownedCaseIds?: Set<string>
  /** 云端侧本人拥有的接案线索 id */
  ownedIntakeIds?: Set<string>
}

export interface SyncReport {
  startedAt: number
  finishedAt: number
  stats: TableSyncStat[]
  /** 是否有任一表失败 */
  hasError: boolean
  /** 冲突总数 */
  conflictTotal: number
  /** 冲突明细（哪张表哪条数据冲突） */
  conflicts: ConflictDetail[]
  /** 实际写入行数 */
  written: number
}

type Row = Record<string, unknown>

const PK = 'id'
const CHUNK = 200

/**
 * 带 user_id 列的「根表」——多租户库可按 user_id 精确过滤。
 * 子表（contacts / timeline / expenses / materials / case_folders）没有该列，
 * 只能按父表归属二次过滤（见 filterCloudRows）。
 */
const SCOPED_TABLES = new Set<SyncTable>(['cases', 'intakes', 'vault_meta'])

function headers(ep: SyncEndpoint): Record<string, string> {
  return {
    apikey: ep.anonKey || ep.token,
    Authorization: `Bearer ${ep.token}`,
    'Content-Type': 'application/json',
  }
}

function cleanBase(base: string): string {
  return base.trim().replace(/\/+$/, '')
}

async function fetchAll(ep: SyncEndpoint, table: SyncTable): Promise<Row[]> {
  // 多租户库 + 根表 → 只取归属本人的行
  const scope = ep.scopeUid && SCOPED_TABLES.has(table) ? `&user_id=eq.${ep.scopeUid}` : ''
  const res = await fetch(`${cleanBase(ep.base)}/${table}?select=*${scope}`, { headers: headers(ep) })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    const hint = res.status === 401 ? '（token 无效或已过期，请重新生成）' : ''
    throw new Error(`读取失败 ${res.status}${hint} ${t.slice(0, 800)}`)
  }
  return (await res.json()) as Row[]
}

async function upsert(ep: SyncEndpoint, table: SyncTable, rows: Row[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK)
    const res = await fetch(`${cleanBase(ep.base)}/${table}?on_conflict=id`, {
      method: 'POST',
      headers: { ...headers(ep), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`写入失败 ${res.status} ${t.slice(0, 800)}`)
    }
  }
}

/** 行内容的稳定指纹（键排序后序列化），用于判断两边是否真的不同。
 *  user_id 是「实例本地」字段（各库 auth.uid() 不同），不参与两边比对，
 *  否则同一条数据会因 uid 不同被误判为「两边都改过」→ 冲突。 */
const LOCAL_KEYS = new Set(['user_id'])

function fingerprint(r: Row): string {
  return JSON.stringify(
    Object.keys(r)
      .filter((k) => !LOCAL_KEYS.has(k))
      .sort()
      .map((k) => [k, r[k]]),
  )
}

function filledCount(r: Row): number {
  return Object.entries(r).filter(([k, v]) => !LOCAL_KEYS.has(k) && v !== null && v !== undefined && v !== '')
    .length
}

/** 从一行集合里取一个现成的 user_id 样本（目标库自己的 uid） */
function sampleUid(rows: Row[]): string | null {
  for (const r of rows) {
    const v = r['user_id']
    if (typeof v === 'string' && v) return v
  }
  return null
}

/** 写入前兜底 user_id：缺失/为空时用目标库现有 uid 补上；
 *  service_role 下 auth.uid() 为 null，列默认值救不了，必须显式带值。
 *  目标库没有样本（空表）时只能删键交给默认值——若仍 NOT NULL 会在报错中显示列名。 */
function withOwner(rows: Row[], uid: string | null): Row[] {
  return rows.map((r) => {
    const v = r['user_id']
    if (typeof v === 'string' && v) return r
    if (uid) return { ...r, user_id: uid }
    const rest = { ...r }
    delete rest['user_id']
    return rest
  })
}

/** 字段中文名（界面展示用；未登记的原样显示字段名） */
const FIELD_LABEL: Record<string, string> = {
  client: '委托人/当事人',
  cause: '案由',
  stage: '阶段',
  stage_norm: '阶段(归一)',
  next_action: '下一步动作',
  next_due: '下次期限',
  first_contact: '首次接触',
  signed_at: '签约日',
  converted: '已转案件',
  note: '备注',
  content: '内容',
  at: '时间',
  direction: '收支',
  category: '分类',
  amount: '开票金额',
  personal: '个人得金额',
  detail: '费用详情',
  name: '名称',
  kind: '类型',
  storage: '存储位置',
  path: '路径',
  url: '链接',
  created_at: '创建时间',
  updated_at: '更新时间',
}

/** 密文列后缀：只提示「密文不同」，不打出一长串无法判断的字符串 */
const ENC_SUFFIX = '_enc'

function fieldLabel(k: string): string {
  return FIELD_LABEL[k] ?? k
}

function fmtVal(v: unknown, enc: boolean): string {
  if (v === null || v === undefined || v === '') return '（空）'
  if (enc) return '【密文·两边不一致】'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 60 ? `${s.slice(0, 60)}…` : s
}

/** 案件名：cases 表取「委托人（案由）」；其余表按 case_id 回查案件表 */
function caseLabelOf(row: Row, table: SyncTable, caseNames: CaseNameMap): string {
  if (table === 'cases') {
    const c = typeof row['client'] === 'string' ? String(row['client']).trim() : ''
    const cause = typeof row['cause'] === 'string' ? String(row['cause']).trim() : ''
    return cause ? (c ? `${c}（${cause}）` : cause) : c
  }
  if (table === 'intakes') {
    return typeof row['client'] === 'string' ? String(row['client']).trim() : ''
  }
  const cid = row['case_id']
  if (cid !== null && cid !== undefined) return caseNames.get(String(cid)) ?? `个案 id=${cid}`
  return ''
}

/** 行内摘要：让 cases/intakes 以外的表也能认出是哪条数据 */
function rowSummary(row: Row, table: SyncTable): string {
  if (table === 'cases' || table === 'intakes') return ''
  for (const k of ['name', 'title', 'content', 'content_mask', 'detail', 'note', 'at']) {
    const v = row[k]
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 30)
  }
  const amt = row['amount']
  if (typeof amt === 'number') return `¥${amt}`
  return ''
}

/** 逐字段对比两侧取值（不含 user_id 等本地字段） */
function diffFields(a: Row, b: Row): FieldDiff[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys]
    .filter((k) => !LOCAL_KEYS.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .sort()
    .map((k) => ({
      field: k,
      label: fieldLabel(k),
      cloud: fmtVal(a[k], k.endsWith(ENC_SUFFIX)),
      nas: fmtVal(b[k], k.endsWith(ENC_SUFFIX)),
    }))
}

/** 把案件 row 记进共享表，供后续表按 case_id 回查当事人 */
function rememberCases(rows: Row[], caseNames: CaseNameMap): void {
  for (const r of rows) {
    const id = r['id']
    const c = r['client']
    if (id !== null && id !== undefined && typeof c === 'string' && c.trim()) {
      caseNames.set(String(id), c.trim())
    }
  }
}

/** 谁更新：返回 'a' | 'b' | null（null = 判断不了） */
function whichNewer(a: Row, b: Row, col: string | null): 'a' | 'b' | null {
  if (col) {
    const av = a[col] ? new Date(String(a[col])).getTime() : 0
    const bv = b[col] ? new Date(String(b[col])).getTime() : 0
    if (av > bv) return 'a'
    if (bv > av) return 'b'
    return null
  }
  const an = filledCount(a)
  const bn = filledCount(b)
  if (an > bn) return 'a'
  if (bn > an) return 'b'
  return null
}

/**
 * 云端侧（多租户库）行过滤 —— 隔离的关键一环。
 *
 *  - 根表：已在 fetchAll 里按 user_id 过滤，这里顺便登记本人拥有的 id；
 *  - 子表：没有 user_id 列，按父表（case_id / intake_id）归属过滤。
 *    不做这步的话，别人案件下的时间线/费用行会被拉进来，甚至因主键撞号挂到你的案件上。
 */
function filterCloudRows(
  rows: Row[],
  table: SyncTable,
  scopeUid: string | undefined,
  shared: SyncShared,
): Row[] {
  if (!scopeUid) return rows
  if (table === 'cases') {
    shared.ownedCaseIds = new Set(rows.map((r) => String(r[PK])))
    return rows
  }
  if (table === 'intakes') {
    shared.ownedIntakeIds = new Set(rows.map((r) => String(r[PK])))
    return rows
  }
  if (table === 'vault_meta') return rows
  const ownedC = shared.ownedCaseIds
  const ownedI = shared.ownedIntakeIds
  return rows.filter((r) => {
    const cid = r['case_id']
    if (cid != null && ownedC?.has(String(cid))) return true
    const iid = r['intake_id']
    if (iid != null && ownedI?.has(String(iid))) return true
    return false
  })
}

async function syncTable(
  cloud: SyncEndpoint,
  nas: SyncEndpoint,
  table: SyncTable,
  shared: SyncShared,
): Promise<{ stat: TableSyncStat; written: number; conflictRows: ConflictDetail[] }> {
  const stat: TableSyncStat = {
    table,
    onlyCloud: 0,
    onlyNas: 0,
    cloudNewer: 0,
    nasNewer: 0,
    conflicts: 0,
    unchanged: 0,
  }
  const conflictRows: ConflictDetail[] = []
  const caseNames = shared.caseNames

  const [cRowsAll, nRows] = await Promise.all([fetchAll(cloud, table), fetchAll(nas, table)])
  // 云端若为多租户库：根表已按 user_id 过滤，子表再按父表归属过滤
  const cRows = filterCloudRows(cRowsAll, table, cloud.scopeUid, shared)

  const cMap = new Map<string, Row>()
  for (const r of cRows) cMap.set(String(r[PK]), r)
  const nMap = new Map<string, Row>()
  for (const r of nRows) nMap.set(String(r[PK]), r)
  // 只允许 cases 表登记 id→client 回查表；intakes 也有 client 字段且 id 序列独立，
  // 若不拦截会用同号线索客户名覆盖案件名（如 id=73 案件「杨志三人」被线索「郭永生」盖掉）。
  if (table === 'cases') rememberCases([...cMap.values(), ...nMap.values()], caseNames)

  const ids = new Set<string>([...cMap.keys(), ...nMap.keys()])
  const toCloud: Row[] = []
  const toNas: Row[] = []

  for (const id of ids) {
    const c = cMap.get(id)
    const n = nMap.get(id)
    if (c && !n) {
      toNas.push(c)
      stat.onlyCloud++
    } else if (n && !c) {
      toCloud.push(n)
      stat.onlyNas++
    } else if (c && n) {
      if (fingerprint(c) === fingerprint(n)) {
        stat.unchanged++
        continue
      }
      const w = whichNewer(c, n, UPDATED_COL[table])
      if (w === 'a') {
        toNas.push(c)
        stat.cloudNewer++
      } else if (w === 'b') {
        toCloud.push(n)
        stat.nasNewer++
      } else {
        stat.conflicts++
        const col = UPDATED_COL[table]
        conflictRows.push({
          table,
          id,
          caseName: caseLabelOf(c, table, caseNames) || caseLabelOf(n, table, caseNames),
          label: rowSummary(c, table) || rowSummary(n, table),
          cloudTime: col && c[col] ? String(c[col]) : undefined,
          nasTime: col && n[col] ? String(n[col]) : undefined,
          diffs: diffFields(c, n),
        })
      }
    }
  }

  if (toNas.length) await upsert(nas, table, withOwner(toNas, sampleUid(nRows)))
  // 写回多租户云端时显式带上自己的 uid（service_role 下 auth.uid() 为 null，列默认值救不了）。
  // 仅限有 user_id 列的根表——子表加上该字段会被 PostgREST 以「列不存在」拒绝。
  const cloudUid = SCOPED_TABLES.has(table) ? cloud.scopeUid || sampleUid(cRows) : sampleUid(cRows)
  if (toCloud.length) await upsert(cloud, table, withOwner(toCloud, cloudUid))

  return { stat, written: toNas.length + toCloud.length, conflictRows }
}

/**
 * 执行双向同步。
 * @param onTable 每完成一张表回调一次，用于界面显示进度
 */
export async function runSync(
  cloud: SyncEndpoint,
  nas: SyncEndpoint,
  onTable?: (s: TableSyncStat) => void,
): Promise<SyncReport> {
  const startedAt = Date.now()
  const stats: TableSyncStat[] = []
  const conflicts: ConflictDetail[] = []
  const shared: SyncShared = { caseNames: new Map<string, string>() }
  let written = 0
  let hasError = false

  for (const table of SYNC_TABLES) {
    try {
      const { stat, written: w, conflictRows } = await syncTable(cloud, nas, table, shared)
      stats.push(stat)
      conflicts.push(...conflictRows)
      written += w
      onTable?.(stat)
    } catch (e) {
      hasError = true
      const stat: TableSyncStat = {
        table,
        onlyCloud: 0,
        onlyNas: 0,
        cloudNewer: 0,
        nasNewer: 0,
        conflicts: 0,
        unchanged: 0,
        error: (e as Error).message || '同步失败',
      }
      stats.push(stat)
      onTable?.(stat)
    }
  }

  return {
    startedAt,
    finishedAt: Date.now(),
    stats,
    hasError,
    conflictTotal: stats.reduce((s, x) => s + x.conflicts, 0),
    conflicts,
    written,
  }
}

/** 只探活：确认地址 + token 是否可用（读一条即可） */
export async function probe(ep: SyncEndpoint): Promise<{ ok: boolean; msg: string }> {
  try {
    const res = await fetch(`${cleanBase(ep.base)}/cases?select=id&limit=1`, { headers: headers(ep) })
    if (res.ok) return { ok: true, msg: '连通' }
    return { ok: false, msg: `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, msg: (e as Error).message || '网络不可达' }
  }
}
