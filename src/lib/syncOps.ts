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

import { authedFetch, currentUserId } from './auth'
import { resolveApi } from './apiConfig'

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
  /** 按对端墓碑执行的删除（删除传播，防止已删数据被补回来） */
  deleted: number
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

/** 单行写入的字段级变化（同步明细展示用） */
export interface SyncFieldChange {
  field: string
  label: string
  from: string
  to: string
}

/** 一次同步中每行实际写入的明细：哪个案件、哪条数据、改了什么 */
export interface SyncItemDetail {
  table: SyncTable
  /** 主键 id */
  id: string
  /** 案件/当事人名（cases/intakes 取自身；子表按 case_id 回查） */
  caseName: string
  /** 行摘要（子表的名称/内容片段） */
  label: string
  /** 写入方向 */
  dir: 'toNas' | 'toCloud'
  /** 对端原本没有此行 → 新增；对端有 → 覆盖更新；按对端墓碑删除 → delete */
  kind: 'add' | 'update' | 'delete'
  /** 内容字段变化（排除 user_id/id/时间戳；密文列只提示"密文更新"） */
  changes: SyncFieldChange[]
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
  /** 云端墓碑：key = `${tbl}:${row_id}` → 删除时间 */
  tombCloud?: Map<string, string>
  /** NAS 墓碑：同上 */
  tombNas?: Map<string, string>
  /** 已「复活」（行仍存在/又被改过）需清除的墓碑 key */
  tombStale?: Set<string>
  /** cases 同步后任一侧仍存在的案件 id —— 子表据此判断自己是不是孤儿 */
  aliveCaseIds?: Set<string>
  /** intakes 同步后任一侧仍存在的线索 id */
  aliveIntakeIds?: Set<string>
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
  /** 按对端墓碑执行的删除行数 */
  deleted: number
  /** 每行写入/删除的明细（案件名 + 字段变化），界面默认折叠展示 */
  details: SyncItemDetail[]
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

/** 单页行数：Supabase 云端 PostgREST 默认 db-max-rows=1000，超页会被**静默截断**
 *  （典型症状：双向同步每一轮都「补」同一批行——云端永远"缺"被截掉的那些）。
 *  所以读取必须带 Range 翻页取全；order=id 保证分页稳定（各同步表主键都是 id）。 */
const FETCH_PAGE = 1000

async function fetchAll(ep: SyncEndpoint, table: SyncTable): Promise<Row[]> {
  // 多租户库 + 根表 → 只取归属本人的行
  const scope = ep.scopeUid && SCOPED_TABLES.has(table) ? `&user_id=eq.${ep.scopeUid}` : ''
  const out: Row[] = []
  let from = 0
  for (;;) {
    const res = await fetch(`${cleanBase(ep.base)}/${table}?select=*${scope}&order=id.asc`, {
      headers: { ...headers(ep), Range: `${from}-${from + FETCH_PAGE - 1}` },
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      const hint = res.status === 401 ? '（token 无效或已过期，请重新生成）' : ''
      throw new Error(`读取失败 ${res.status}${hint} ${t.slice(0, 800)}`)
    }
    const batch = (await res.json()) as Row[]
    out.push(...batch)
    if (batch.length < FETCH_PAGE) break // 不足一页 = 已到末尾
    from += FETCH_PAGE
  }
  return out
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

/**
 * 写完后把云端自增序列顶到 max(id)+1，防止 BY DEFAULT 下同步写入的高 id
 * 之后被云端原生 INSERT 自增撞号。仅在云端（多租户）侧调用；非致命（失败只告警）。
 */
async function bumpSeq(ep: SyncEndpoint, table: SyncTable): Promise<void> {
  try {
    const res = await fetch(`${cleanBase(ep.base)}/rpc/sync_bump_seq?p_tbl=${table}`, {
      method: 'POST',
      headers: headers(ep),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      console.warn(`[sync] bumpSeq ${table} 失败 ${res.status} ${t.slice(0, 200)}`)
    }
  } catch (e) {
    console.warn(`[sync] bumpSeq ${table} 异常`, e)
  }
}

/* ========================= 墓碑（删除传播） =========================
 * 同步原本「只补不删」：一端删掉的行，在另一端看来只是"缺这行"，会被补回来（复活）。
 * 墓碑表 sync_tombstones 记录「本库删掉了哪张表的哪一行」，同步据此在对端执行删除。
 * ================================================================== */

/** 墓碑表名（同步元数据表，不作为业务表参与逐行比对） */
export const TOMB_TABLE = 'sync_tombstones'

/** 墓碑键：`${表名}:${行id}` */
function tombKey(tbl: string, rowId: unknown): string {
  return `${tbl}:${String(rowId)}`
}

/**
 * 读取一侧的全部墓碑。**表还没建时返回空 Map**——未执行建表 SQL 的环境
 * 仍能正常同步（只是没有删除传播能力），不会因此报错。
 */
async function fetchTombs(ep: SyncEndpoint): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  try {
    const scope = ep.scopeUid ? `&user_id=eq.${ep.scopeUid}` : ''
    let from = 0
    for (;;) {
      const res = await fetch(
        `${cleanBase(ep.base)}/${TOMB_TABLE}?select=tbl,row_id,deleted_at${scope}&order=id.asc`,
        { headers: { ...headers(ep), Range: `${from}-${from + FETCH_PAGE - 1}` } },
      )
      if (!res.ok) return out
      const rows = (await res.json()) as Array<{ tbl: string; row_id: string; deleted_at: string }>
      for (const r of rows) out.set(tombKey(r.tbl, r.row_id), String(r.deleted_at ?? ''))
      if (rows.length < FETCH_PAGE) break
      from += FETCH_PAGE
    }
  } catch {
    // 表不存在或读不到 → 按「无墓碑」处理
  }
  return out
}

/** 按 id 删除一批行（删除传播用） */
async function deleteRows(ep: SyncEndpoint, table: SyncTable, ids: string[]): Promise<void> {
  if (!ids.length) return
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK)
    const res = await fetch(`${cleanBase(ep.base)}/${table}?id=in.(${batch.join(',')})`, {
      method: 'DELETE',
      headers: headers(ep),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`删除失败 ${res.status} ${t.slice(0, 300)}`)
    }
  }
}

/** 删除一条墓碑（行复活时清理，避免下次同步又把它删掉） */
async function deleteTomb(ep: SyncEndpoint, tbl: string, rowId: string): Promise<void> {
  const scope = ep.scopeUid ? `&user_id=eq.${ep.scopeUid}` : ''
  const res = await fetch(
    `${cleanBase(ep.base)}/${TOMB_TABLE}?tbl=eq.${tbl}&row_id=eq.${encodeURIComponent(rowId)}${scope}`,
    { method: 'DELETE', headers: headers(ep) },
  )
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    console.warn(`[sync] 清理墓碑失败 ${tbl}/${rowId}：${res.status} ${t.slice(0, 200)}`)
  }
}

/** 写入墓碑（把一端的删除记录补到另一端，使两端认知一致） */
async function upsertTombs(
  ep: SyncEndpoint,
  items: Array<{ tbl: string; row_id: string; deleted_at: string }>,
): Promise<void> {
  if (!items.length) return
  const withUid = Boolean(ep.scopeUid)
  const rows = items.map((x) => (withUid ? { ...x, user_id: ep.scopeUid } : x))
  const conflict = withUid ? 'user_id,tbl,row_id' : 'tbl,row_id'
  const res = await fetch(`${cleanBase(ep.base)}/${TOMB_TABLE}?on_conflict=${conflict}`, {
    method: 'POST',
    headers: { ...headers(ep), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    console.warn(`[sync] 同步墓碑失败：${res.status} ${t.slice(0, 200)}`)
  }
}

/**
 * 行的更新时间是否晚于给定时间 —— 用于识别「删了之后又被改过」= 复活。
 * 表没有更新时间列时返回 false（无法证明复活，按墓碑执行删除）。
 */
function newerThan(row: Row, ts: string, col: string | null): boolean {
  if (!col) return false
  const rv = row[col] ? new Date(String(row[col])).getTime() : 0
  const tv = ts ? new Date(ts).getTime() : 0
  return rv > tv
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

/** 写 NAS（单用户库）前剥掉 user_id 列：单用户库所有表都没有该列，
 *  带上会触发 PostgREST 400 PGRST204「Could not find the 'user_id' column」。 */
function stripOwner(rows: Row[]): Row[] {
  return rows.map((r) => {
    if (!('user_id' in r)) return r
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

/** 明细里不参与"内容变化"展示的键：user_id 是本地字段，id 是对齐主键，时间戳不是内容 */
const LOG_SKIP_KEYS = new Set(['user_id', 'id', 'created_at', 'updated_at'])

/** 计算一行写入的内容级变化（fromRow=对端旧值，toRow=写入的新值）。
 *  对端原本没有这一行时 fromRow 传 undefined → 返回空数组（界面标"新增"）。
 *  密文列不展示长串，只标注（旧密文）→（新密文）。 */
function changeList(fromRow: Row | undefined, toRow: Row): SyncFieldChange[] {
  if (!fromRow) return []
  const keys = new Set([...Object.keys(fromRow), ...Object.keys(toRow)])
  const out: SyncFieldChange[] = []
  for (const k of [...keys].sort()) {
    if (LOG_SKIP_KEYS.has(k)) continue
    if (JSON.stringify(fromRow[k]) === JSON.stringify(toRow[k])) continue
    const enc = k.endsWith(ENC_SUFFIX)
    const fmt = (v: unknown): string => {
      const s = fmtVal(v, false)
      return s.length > 40 ? `${s.slice(0, 40)}…` : s
    }
    out.push({
      field: k,
      label: fieldLabel(k),
      from: enc ? '（旧密文）' : fmt(fromRow[k]),
      to: enc ? '（新密文）' : fmt(toRow[k]),
    })
  }
  return out
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
): Promise<{ stat: TableSyncStat; written: number; conflictRows: ConflictDetail[]; details: SyncItemDetail[] }> {
  const stat: TableSyncStat = {
    table,
    onlyCloud: 0,
    onlyNas: 0,
    cloudNewer: 0,
    nasNewer: 0,
    conflicts: 0,
    deleted: 0,
    unchanged: 0,
  }
  const conflictRows: ConflictDetail[] = []
  const details: SyncItemDetail[] = []
  const caseNames = shared.caseNames

  /** 记一条写入明细：src=被写入的（较新）行，fromRow=对端现有旧行（无则 undefined=新增） */
  const mkDetail = (
    dir: 'toNas' | 'toCloud',
    kind: 'add' | 'update' | 'delete',
    src: Row,
    fromRow: Row | undefined,
  ): void => {
    details.push({
      table,
      id: String(src[PK]),
      caseName: caseLabelOf(src, table, caseNames) || (table === 'vault_meta' ? '保险箱' : ''),
      label: table === 'vault_meta' ? '口令校验信息（单向 云→NAS）' : rowSummary(src, table),
      dir,
      kind,
      changes: changeList(fromRow, src),
    })
  }

  // 墓碑：本表相关的删除记录。表未建时两侧都是空 Map，退化为原有「只补不删」行为。
  const tombC = shared.tombCloud ?? new Map<string, string>()
  const tombN = shared.tombNas ?? new Map<string, string>()
  const stale = shared.tombStale ?? new Set<string>()
  /** 按对端墓碑要在「云端」删掉的 id */
  const delCloud: string[] = []
  /** 按对端墓碑要在「NAS」删掉的 id */
  const delNas: string[] = []

  // 子表孤儿保护：父案件/线索若在两端都已不存在（被删除），
  // 子行即使只在一边也不补 —— 否则会复活一堆没人要的时间线/费用/材料。
  const isChildTable =
    table === 'contacts' ||
    table === 'timeline' ||
    table === 'expenses' ||
    table === 'materials' ||
    table === 'case_folders'
  const parentAlive = (row: Row): boolean => {
    if (!isChildTable) return true
    const cid = row['case_id']
    if (cid != null && shared.aliveCaseIds && !shared.aliveCaseIds.has(String(cid))) return false
    const iid = row['intake_id']
    if (iid != null && shared.aliveIntakeIds && !shared.aliveIntakeIds.has(String(iid))) return false
    return true
  }

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
  let toCloud: Row[] = []
  const toNas: Row[] = []

  for (const id of ids) {
    const c = cMap.get(id)
    const n = nMap.get(id)
    const key = tombKey(table, id)
    const tc = tombC.get(key) // 云端曾删除过这行
    const tn = tombN.get(key) // NAS 曾删除过这行

    // 两端都还在 → 墓碑已过期（删了又改/又建），标记为待清理
    if (c && n) {
      if (tc) stale.add(key)
      if (tn) stale.add(key)
    }

    if (c && !n) {
      // 云端有、NAS 没有：先看 NAS 是不是"删过"。
      // NAS 删过 且 云端这行之后没再被改 → 判定为删除，云端也删（而不是补回 NAS）
      if (tn && !newerThan(c, tn, UPDATED_COL[table])) {
        delCloud.push(id)
        mkDetail('toCloud', 'delete', c, undefined)
        continue
      }
      if (!parentAlive(c)) continue // 父案件已不存在 → 不补孤儿
      toNas.push(c)
      stat.onlyCloud++
      mkDetail('toNas', 'add', c, undefined)
    } else if (n && !c) {
      if (tc && !newerThan(n, tc, UPDATED_COL[table])) {
        delNas.push(id)
        mkDetail('toNas', 'delete', n, undefined)
        continue
      }
      if (!parentAlive(n)) continue
      toCloud.push(n)
      stat.onlyNas++
      mkDetail('toCloud', 'add', n, undefined)
    } else if (c && n) {
      if (fingerprint(c) === fingerprint(n)) {
        stat.unchanged++
        continue
      }
      const w = whichNewer(c, n, UPDATED_COL[table])
      if (w === 'a') {
        toNas.push(c)
        stat.cloudNewer++
        mkDetail('toNas', 'update', c, n)
      } else if (w === 'b') {
        toCloud.push(n)
        stat.nasNewer++
        mkDetail('toCloud', 'update', n, c)
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

  // 删除传播：把对端已删除的行在本端删掉（先删，再补对端缺失的行）
  if (delNas.length) await deleteRows(nas, table, delNas)
  if (delCloud.length) await deleteRows(cloud, table, delCloud)
  stat.deleted = delNas.length + delCloud.length

  // 登记父表「存活 id」，供后面同步的子表做孤儿保护
  const aliveIds = (): Set<string> => {
    const alive = new Set<string>()
    for (const id of cMap.keys()) if (!delCloud.includes(id)) alive.add(id)
    for (const id of nMap.keys()) if (!delNas.includes(id)) alive.add(id)
    return alive
  }
  if (table === 'cases') shared.aliveCaseIds = aliveIds()
  if (table === 'intakes') shared.aliveIntakeIds = aliveIds()

  // 写 NAS（单用户库）：所有表都没有 user_id 列，必须剥掉，否则 400 PGRST204。
  // vault_meta 在 NAS 是 id=1 的单行，按云端自增 id 写会插出第二行、破坏单用户不变式 → 强制落到 id=1。
  if (toNas.length) {
    const stripped = stripOwner(toNas)
    const rows = table === 'vault_meta' ? stripped.map((r) => ({ ...r, id: 1 })) : stripped
    await upsert(nas, table, rows)
  }
  // vault_meta 不回写云端：NAS 是单用户库（vault_meta 仅 id=1 一行），若把 NAS 的 id=1
  // 按 user_id 插回多租户云端会造出游离行、破坏 vault 单行使不变式。仅做 云端→NAS 单向同步，
  // 保证在 NAS 上也能用同一保险箱口令解密。其余表正常双向。
  if (table === 'vault_meta') toCloud = []
  // 写回多租户云端时显式带上自己的 uid（service_role 下 auth.uid() 为 null，列默认值救不了）。
  const cloudUid = SCOPED_TABLES.has(table) ? cloud.scopeUid || sampleUid(cRows) : sampleUid(cRows)
  if (toCloud.length) {
    await upsert(cloud, table, withOwner(toCloud, cloudUid))
    await bumpSeq(cloud, table)
  }

  // 明细后处理：vault_meta 单向同步——「补→云」被抑制、并未实际写入，不计入明细；
  // 「补→NAS」实际强制落到 NAS 的 id=1 单行，按覆盖更新记录它与现有行的差异。
  let outDetails = details
  if (table === 'vault_meta') {
    outDetails = []
    const existing = nMap.get('1')
    for (const d of details) {
      if (d.dir === 'toCloud') continue
      d.kind = existing ? 'update' : 'add'
      const src = cMap.get(d.id)
      d.changes = changeList(existing, src ? { ...src, id: 1 } : { id: 1 })
      outDetails.push(d)
    }
  }

  return { stat, written: toNas.length + toCloud.length, conflictRows, details: outDetails }
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
  const details: SyncItemDetail[] = []
  const shared: SyncShared = { caseNames: new Map<string, string>(), tombStale: new Set<string>() }
  // 先读两端墓碑（未建表时返回空 Map，不影响同步本身）
  const [tombCloud, tombNas] = await Promise.all([fetchTombs(cloud), fetchTombs(nas)])
  shared.tombCloud = tombCloud
  shared.tombNas = tombNas
  let written = 0
  let deleted = 0
  let hasError = false

  for (const table of SYNC_TABLES) {
    try {
      const { stat, written: w, conflictRows, details: dRows } = await syncTable(cloud, nas, table, shared)
      stats.push(stat)
      conflicts.push(...conflictRows)
      details.push(...dRows)
      written += w
      deleted += stat.deleted
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
        deleted: 0,
        unchanged: 0,
        error: (e as Error).message || '同步失败',
      }
      stats.push(stat)
      onTable?.(stat)
    }
  }

  // 墓碑收尾：① 清掉已「复活」的墓碑 ② 把一端的删除记录补到另一端，使两端认知一致
  try {
    const stale = shared.tombStale ?? new Set<string>()
    for (const key of stale) {
      const idx = key.indexOf(':')
      if (idx < 0) continue
      const tbl = key.slice(0, idx)
      const rowId = key.slice(idx + 1)
      if (tombCloud.has(key)) await deleteTomb(cloud, tbl, rowId)
      if (tombNas.has(key)) await deleteTomb(nas, tbl, rowId)
    }
    const toNasTombs: Array<{ tbl: string; row_id: string; deleted_at: string }> = []
    const toCloudTombs: Array<{ tbl: string; row_id: string; deleted_at: string }> = []
    for (const [key, ts] of tombCloud) {
      if (tombNas.has(key) || stale.has(key)) continue
      const idx = key.indexOf(':')
      if (idx < 0) continue
      toNasTombs.push({ tbl: key.slice(0, idx), row_id: key.slice(idx + 1), deleted_at: ts })
    }
    for (const [key, ts] of tombNas) {
      if (tombCloud.has(key) || stale.has(key)) continue
      const idx = key.indexOf(':')
      if (idx < 0) continue
      toCloudTombs.push({ tbl: key.slice(0, idx), row_id: key.slice(idx + 1), deleted_at: ts })
    }
    if (toNasTombs.length) await upsertTombs(nas, toNasTombs)
    if (toCloudTombs.length) await upsertTombs(cloud, toCloudTombs)
  } catch (e) {
    console.warn('[sync] 墓碑收尾异常（不影响已完成的同步）', e)
  }

  return {
    startedAt,
    finishedAt: Date.now(),
    stats,
    hasError,
    conflictTotal: stats.reduce((s, x) => s + x.conflicts, 0),
    conflicts,
    written,
    deleted,
    details,
  }
}

/**
 * 删除一行时，在「执行删除的那个后端」记一条墓碑 —— 供双向同步把这次删除传播到对端，
 * 避免下次同步把已删除的数据当成"对端缺失"又补回来（复活）。
 *
 * 设计要点：
 *  - 写到**当前生效的后端**（与删除行为同库），而不是写死云端；
 *  - 云端（多租户）墓碑表有 user_id 列，NAS（单用户）没有 —— 先按带 user_id 试，
 *    报 400 / 提示 user_id 就自动去掉重试，两种库都能用；
 *  - 失败只告警，**不影响删除本身**（墓碑只是同步元数据）；表没建时同样静默跳过。
 */
export async function recordTombstone(table: SyncTable, rowId: number | string): Promise<void> {
  try {
    const b = cleanBase(resolveApi().base)
    if (!b) return
    const uid = currentUserId()
    const body: Record<string, unknown> = { tbl: table, row_id: String(rowId) }
    const post = async (withUid: boolean): Promise<Response> => {
      const payload = withUid && uid ? { ...body, user_id: uid } : { ...body }
      const conflict = withUid && uid ? 'user_id,tbl,row_id' : 'tbl,row_id'
      return authedFetch(`${b}/${TOMB_TABLE}?on_conflict=${conflict}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(payload),
      })
    }
    let res = await post(Boolean(uid))
    if (!res.ok && uid) {
      const t = await res.text().catch(() => '')
      // 单用户库（NAS）没有 user_id 列 → 去掉 user_id 重试
      if (res.status === 400 || /user_id/i.test(t)) res = await post(false)
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      console.warn(`[tombstone] 记录失败 ${table}/${rowId}：${res.status} ${t.slice(0, 200)}`)
    }
  } catch (e) {
    console.warn('[tombstone] 记录异常（不影响删除本身）', e)
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
