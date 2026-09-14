export interface ContactEnc {
  enc: string | null
  mask: string
}

export interface CaseRow {
  id: number
  client: string
  cause: string
  stage: string
  stage_norm?: string | null
  next_action?: string | null
  next_due?: string | null
  first_contact?: string | null
  signed_at?: string | null
  detail_mask?: string | null
  detail_enc?: string | null
  has_secret?: boolean
}

export interface IntakeRow {
  id: number
  client: string
  first_contact?: string | null
  signed_at?: string | null
  converted?: boolean
  note_mask?: string | null
  note_enc?: string | null
  phones: ContactEnc[]
}

export interface TimelineRow {
  id: number
  case_id: number | null
  at?: string | null
  content_mask?: string | null
  content_enc?: string | null
}

/**
 * 费用行。字段与 NocoDB「nc_5q_g__次1费用详情表」一一对应：
 *   收支 → direction   分类 → category   时间 → at
 *   开票金额 → amount   个人得金额 → personal   费用详情 → detail(+detail_enc)
 * 委托人一列不入库：费用挂在案件下，委托人即案件当事人。
 */
export interface ExpenseRow {
  id: number
  case_id: number | null
  direction?: string | null
  category?: string | null
  at?: string | null
  amount?: number | null
  personal?: number | null
  detail?: string | null
  detail_enc?: string | null
}

export interface MaterialRow {
  id: number
  case_id: number
  name: string
  kind: string
  storage: 'both' | 'local' | 'cloud'
  updated_at?: string | null
}

/** 案件 ↔ 同步文件夹绑定（PC / 手机两条路径，都可改） */
export interface CaseFolder {
  id: number
  case_id: number
  folder_name?: string | null
  pc_folder?: string | null
  mobile_folder?: string | null
  matched_by?: string | null
  updated_at?: string | null
}

/**
 * 文件索引行（materials 表扩展后）。
 * 只存元数据：文件名、相对路径、大小、分类 —— 绝不存文件内容，原件留在本机。
 */
export interface DocFile {
  id: number
  case_id: number
  name: string
  rel_path?: string | null
  size_bytes?: number | null
  hash?: string | null
  category?: number | null
  category_src?: string | null
  updated_at?: string | null
  indexed_at?: string | null
}

export interface Dataset {
  version: number
  generated_at: string
  crypto: { alg: string; kdf: string; iterations: number; salt: string; verifier?: string | null }
  cases: CaseRow[]
  intakes: IntakeRow[]
  timeline: TimelineRow[]
  expenses: ExpenseRow[]
  materials: MaterialRow[]
}

export type StageNorm = '在办' | '结案' | '解除委托'

/** 把「一审,结案」「解除委托，不委托了」这类原始值归一到三种状态 */
export function normalizeStage(stage?: string | null): StageNorm {
  const s = stage || ''
  if (s.includes('解除委托')) return '解除委托'
  if (s.includes('结案')) return '结案'
  return '在办'
}

/** 距今天数：负数表示已过期。兼容 date（2026-09-14）和 timestamp（2026-09-14T09:00:00） */
export function daysUntil(d?: string | null): number | null {
  if (!d) return null
  // 已带 T 的时间戳直接解析；纯日期补 T00:00:00（本地时区）
  const target = new Date(d.includes('T') ? d : d + 'T00:00:00')
  if (isNaN(target.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

export function fmtDate(d?: string | null): string {
  if (!d) return '—'
  return d.slice(0, 10)
}

/** 日期时间：把 `YYYY-MM-DD` / `YYYY-MM-DDTHH:MM` / `YYYY-MM-DDTHH:MM:SS(.sss)(Z)` 规整成 `YYYY-MM-DD HH:MM` */
export function fmtDateTime(d?: string | null): string {
  if (!d) return '—'
  const [datePart, timePart = ''] = d.split('T')
  if (!timePart) return datePart // 仅日期（旧数据）
  return `${datePart} ${timePart.slice(0, 5)}`
}

/** 新建节点默认时间：今天 09:00（取本地时区，datetime-local 直接吃这个值） */
export function defaultAt(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T09:00`
}

/** 把任意时间字符串规整成 datetime-local 接受的 `YYYY-MM-DDTHH:MM`：
 *  - 旧数据只有日期（如 2026-03-11）→ 补足 09:00
 *  - 带秒/时区（如 2026-03-11T09:00:00.000Z）→ 只截到分钟 */
export function toDateTimeLocal(s: string | null | undefined): string {
  if (!s) return ''
  const [datePart, timePart = ''] = s.split('T')
  const time = timePart ? timePart.slice(0, 5) : '09:00'
  return `${datePart}T${time}`
}

export function fmtMoney(n?: number | null): string {
  if (n === null || n === undefined) return '—'
  return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
